import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { readyDb } from '../db/index';
import {
  notifications,
  notificationMutes,
  posts,
  users,
  type Notification,
  type NotificationKind,
} from '../db/schema';

/**
 * The inbox.
 *
 * Two design points worth stating, because both look like extra work and are
 * not:
 *
 * 1. **Delivery is anonymous-first.** A reader who never claimed a handle is
 *    still most of the people who write notes, so an inbox addressed by
 *    `user_id` would be empty for almost everyone. `anonKey` is the primary
 *    address; `userId` fills in on claim.
 *
 * 2. **It is a table, not an email.** Notifications for a reader on a
 *    first-party, no-tracking site are unreadable over SMTP without
 *    reintroducing the tracking this product exists to avoid. Mail is for
 *    ownership and billing; this is for the reading loop.
 */

export type InboxEntry = Notification & { postSlug: string | null; href: string };

/** Where a notification should take you. Anchors deep-link straight to the note. */
function hrefFor(postSlug: string | null, annotationId: string | null): string {
  const post = postSlug ? `/w/${postSlug}` : '/';
  return annotationId ? `${post}#note-${annotationId}` : post;
}

/**
 * Address keys an identity can be reached at, most specific first.
 *
 * A claimed reader is stored under their user id even when the browser has an
 * anon id, and a reader with no anon id at all — an author-only note, or
 * someone who cleared cookies — falls back to their user id. The list is
 * de-duplicated and never contains NULL, because `anon_key IN (…, NULL)` never
 * matches anything and would silently make those readers unreachable.
 */
function addresses(userId: string | null, anonKey: string): string[] {
  return [...new Set([anonKey, userId].filter((v): v is string => Boolean(v)))];
}

/** Silenced kinds for this identity; anonymous readers have muted nothing. */
async function mutedKinds(userId: string | null): Promise<NotificationKind[]> {
  if (!userId) return [];
  const database = await readyDb();
  const rows = await database
    .select({ kind: notificationMutes.kind })
    .from(notificationMutes)
    .where(eq(notificationMutes.userId, userId));
  return rows.map((r) => r.kind);
}

/**
 * `NOT IN ()` is a syntax error, so an empty mute list has to compile away to
 * no constraint at all rather than to something that hides the whole inbox.
 * `and()` drops the undefined branch.
 */
function muteFilter(muted: NotificationKind[]) {
  if (!muted.length) return undefined;
  const list = muted.map((k) => sql`${k}`);
  return sql`${notifications.kind} not in (${sql.join(list, sql`, `)})`;
}

export async function listInbox(
  anonKey: string,
  userId: string | null,
  limit = 50,
): Promise<InboxEntry[]> {
  const database = await readyDb();
  const muted = await mutedKinds(userId);
  const rows = await database
    .select({
      n: notifications,
      // Joined, not stored: a slug captured at notify time goes stale the first
      // time the writer retitles the piece.
      postSlug: posts.slug,
    })
    .from(notifications)
    .leftJoin(posts, eq(notifications.postId, posts.id))
    .where(
      and(
        inArray(notifications.anonKey, addresses(userId, anonKey)),
        muteFilter(muted),
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    ...r.n,
    postSlug: r.postSlug,
    href: hrefFor(r.postSlug, r.n.annotationId),
  }));
}

export async function unreadCount(anonKey: string, userId: string | null): Promise<number> {
  const database = await readyDb();
  const muted = await mutedKinds(userId);
  const rows = await database
    .select({ c: sql<number>`count(*)` })
    .from(notifications)
    .where(
      and(
        inArray(notifications.anonKey, addresses(userId, anonKey)),
        isNull(notifications.readAt),
        muteFilter(muted),
      ),
    );
  return Number(rows[0]?.c ?? 0);
}

export async function markAllRead(anonKey: string, userId: string | null): Promise<void> {
  const database = await readyDb();
  await database
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        inArray(notifications.anonKey, addresses(userId, anonKey)),
        isNull(notifications.readAt),
      ),
    );
}

export async function notify(input: {
  kind: NotificationKind;
  /** Skip entirely when this recipient muted the kind. */
  userId: string | null;
  anonKey: string | null;
  subject: string;
  postId?: string | null;
  annotationId?: string | null;
}): Promise<void> {
  // Never notify yourself. A writer replying to their own note is not news.
  // The address falls back to the user id so a reader with no anon id — an
  // author-only note, or a cleared cookie — is still reachable.
  const key = input.anonKey ?? input.userId;
  if (!key) return;
  if (input.userId && key === input.userId && input.anonKey === input.userId) return;

  const database = await readyDb();

  if (input.userId) {
    const muted = await database
      .select({ kind: notificationMutes.kind })
      .from(notificationMutes)
      .where(
        and(
          eq(notificationMutes.userId, input.userId),
          eq(notificationMutes.kind, input.kind),
        ),
      );
    if (muted.length) return;
  }

  await database
    .insert(notifications)
    .values({
      id: crypto.randomUUID(),
      userId: input.userId,
      anonKey: key,
      kind: input.kind,
      subject: input.subject,
      postId: input.postId ?? null,
      annotationId: input.annotationId ?? null,
    })
    // A duplicate is the expected outcome of a double-submitted form, not an
    // error worth failing the reader's request over.
    .onConflictDoNothing();
}

/**
 * Silence, or un-silence, one kind. Requires a claimed handle: there is nothing
 * durable to attach a mute to for a browser that clears its cookie, and a mute
 * that evaporates is worse than no mute at all — it teaches the reader the
 * setting does not work.
 */
export async function setMuted(
  userId: string | null,
  kind: NotificationKind,
  muted: boolean,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!userId) {
    return {
      ok: false,
      message: 'Claim a handle to change what you hear about.',
    };
  }
  const database = await readyDb();
  if (muted) {
    await database
      .insert(notificationMutes)
      .values({ userId, kind })
      .onConflictDoNothing();
  } else {
    await database
      .delete(notificationMutes)
      .where(and(eq(notificationMutes.userId, userId), eq(notificationMutes.kind, kind)));
  }
  return { ok: true };
}

export async function listMutes(userId: string | null): Promise<NotificationKind[]> {
  return mutedKinds(userId);
}

/**
 * Turn `@handle` in a note body into mention notifications.
 *
 * Length-capped and capped at three mentions: a note that mentions thirty people
 * is a directory listing, and delivering thirty inbox lines for one paragraph is
 * how you get an inbox nobody opens.
 */
export async function notifyMentions(input: {
  body: string;
  postId: string;
  annotationId: string;
  fromUserId: string | null;
  fromAnonKey: string | null;
  fromName: string;
}): Promise<void> {
  const handles = [...input.body.matchAll(/(^|[^\w`])@([a-z0-9_.-]{2,32})/gi)]
    .map((m) => m[2].toLowerCase())
    .filter((h, i, a) => a.indexOf(h) === i)
    .slice(0, 3);
  if (!handles.length) return;

  const database = await readyDb();
  const rows = await database
    .select({ id: users.id, handle: users.handle, displayName: users.displayName })
    .from(users)
    .where(inArray(users.handle, handles));

  for (const row of rows) {
    // A person's user id doubles as their inbox key. Nothing here needs to be
    // read back: a mention is addressed by who was named, not by who sent it.
    await notify({
      kind: 'mention',
      userId: row.id,
      anonKey: row.id,
      subject: `${input.fromName} mentioned you in a note`,
      postId: input.postId,
      annotationId: input.annotationId,
    });
  }
}