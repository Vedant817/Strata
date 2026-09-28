import { and, desc, eq, sql } from 'drizzle-orm';
import { readyDb } from '../db';
import { posts, postVersions, revisionSubscriptions, users } from '../db/schema';
import { nanoid } from '../ids';

/**
 * Revision subscriptions: the maintenance flywheel.
 *
 * The thesis of the product is that a post is not finished when it is
 * published, it is maintained — and a maintained post only earns its second
 * life if the people who read the first version find out that it changed. So
 * this is the loop closing: a reader subscribes to a post with just an email,
 * and when a *major* revision lands they hear about it, once.
 *
 * Two deliberate constraints:
 *
 * 1. Only major revisions notify. A typo fix is not news, and a subscriber
 *    who learns to ignore the email stops reading it, which kills the channel
 *    for the one update that mattered.
 * 2. One send per version. Idempotency lives in the data — each row remembers
 *    the version it was last told about — so re-running the send, or two
 *    instances running it at once, cannot double-email.
 */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export function isEmail(v: string): boolean {
  return v.length > 3 && v.length <= 320 && EMAIL_RE.test(v);
}

export async function subscribe(postId: string, email: string): Promise<void> {
  const database = await readyDb();
  await database
    .insert(revisionSubscriptions)
    .values({ id: nanoid(), postId, email: email.trim().toLowerCase() })
    .onConflictDoNothing();
}

export async function unsubscribe(postId: string, email: string): Promise<void> {
  const database = await readyDb();
  await database
    .delete(revisionSubscriptions)
    .where(
      and(
        eq(revisionSubscriptions.postId, postId),
        eq(revisionSubscriptions.email, email.trim().toLowerCase()),
      ),
    );
}

export async function getSubscribers(postId: string): Promise<string[]> {
  const database = await readyDb();
  const rows = await database
    .select({ email: revisionSubscriptions.email })
    .from(revisionSubscriptions)
    .where(eq(revisionSubscriptions.postId, postId));
  return rows.map((r) => r.email);
}

export interface RevisionNotice {
  postId: string;
  slug: string;
  title: string;
  authorName: string;
  versionId: string;
  versionNumber: number;
  changeSummary: string;
  createdAt: number;
  emails: string[];
}

/**
 * Posts whose *current* version is a recent major revision, and whose
 * subscribers have not been told about it yet.
 *
 * The current-version filter is the important one: revise a post three times
 * and notify once, on the version readers are actually looking at. The
 * `notified_version_id` guard then makes this re-runnable.
 */
export async function pendingNotices(sinceMs: number): Promise<RevisionNotice[]> {
  const database = await readyDb();
  const rows = await database
    .select({
      postId: posts.id,
      slug: posts.slug,
      title: posts.title,
      authorName: users.displayName,
      versionNumber: postVersions.versionNumber,
      versionId: postVersions.id,
      changeSummary: postVersions.changeSummary,
      createdAt: postVersions.createdAt,
      email: revisionSubscriptions.email,
      notifiedVersionId: revisionSubscriptions.notifiedVersionId,
    })
    .from(revisionSubscriptions)
    .innerJoin(posts, eq(revisionSubscriptions.postId, posts.id))
    .innerJoin(users, eq(posts.authorId, users.id))
    .innerJoin(postVersions, eq(posts.currentVersionId, postVersions.id))
    .where(
      and(
        eq(posts.visibility, 'public'),
        eq(postVersions.isMajor, true),
        sql`${postVersions.versionNumber} > 1`,
        sql`${postVersions.createdAt} >= ${sinceMs}`,
        // Not yet told about this exact version.
        sql`(${revisionSubscriptions.notifiedVersionId} is null or ${revisionSubscriptions.notifiedVersionId} != ${postVersions.id})`,
      ),
    )
    .orderBy(desc(postVersions.createdAt));

  // Collapse per-subscriber rows into one notice carrying all its emails.
  const byPost = new Map<string, RevisionNotice>();
  for (const r of rows) {
    const existing = byPost.get(r.postId);
    if (existing) {
      existing.emails.push(r.email);
      continue;
    }
    byPost.set(r.postId, {
      postId: r.postId,
      slug: r.slug,
      title: r.title,
      authorName: r.authorName,
      versionId: r.versionId,
      versionNumber: r.versionNumber,
      changeSummary: r.changeSummary,
      createdAt: r.createdAt,
      emails: [r.email],
    });
  }
  return [...byPost.values()];
}
/**
 * Mark everyone on a post as told about a version. Called only after a
 * successful send, so a mailer outage retries next run instead of silently
 * consuming the notice.
 */
export async function markNotified(postId: string, versionId: string): Promise<number> {
  const database = await readyDb();
  const result = await database
    .update(revisionSubscriptions)
    .set({ notifiedVersionId: versionId })
    .where(
      and(
        eq(revisionSubscriptions.postId, postId),
        sql`(${revisionSubscriptions.notifiedVersionId} is null or ${revisionSubscriptions.notifiedVersionId} != ${versionId})`,
      ),
    );
  return result.rowsAffected ?? 0;
}
