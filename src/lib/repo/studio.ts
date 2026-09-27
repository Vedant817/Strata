import { and, desc, eq, sql } from 'drizzle-orm';
import { readyDb } from '../db';
import { annotations, asks, captureItems, posts, postVersions } from '../db/schema';
import { nanoid } from '../ids';
import { createPost } from './posts';

export type CaptureState = 'inbox' | 'seed' | 'draft' | 'discarded';
export type CaptureSource = 'share' | 'voice' | 'screenshot' | 'scratchpad' | 'clip';

/**
 * Writer Studio, v1: the capture inbox, staleness, and empathy.
 *
 * The plan's observation is that writing apps optimize publishing and almost
 * none solve *noticing*. So the loop starts before any editor: a fragment
 * lands in the inbox in seconds, graduates to a seedling when it earns it,
 * and the posts that need attention — stale, questioned, or losing readers
 * at the same paragraph — say so in one place. The block editor, synthesis
 * and voice profiling are later; a capture that rots in a table is worse
 * than no capture at all, so the inbox ships with its full lifecycle first.
 */

export async function listCaptures(authorId: string, state?: CaptureState) {
  const database = await readyDb();
  const conditions = [eq(captureItems.authorId, authorId)];
  if (state) conditions.push(eq(captureItems.state, state));
  return database
    .select()
    .from(captureItems)
    .where(and(...conditions))
    .orderBy(desc(captureItems.capturedAt))
    .limit(100);
}

export async function addCapture(authorId: string, body: string, source: CaptureSource = 'scratchpad') {
  const clean = body.trim().slice(0, 4000);
  if (!clean) return { ok: false as const, error: 'A capture needs some text.' };
  const database = await readyDb();
  const id = nanoid();
  await database.insert(captureItems).values({ id, authorId, body: clean, source });
  return { ok: true as const, id };
}

export async function setCaptureState(id: string, authorId: string, state: CaptureState) {
  const database = await readyDb();
  const rows = await database
    .update(captureItems)
    .set({ state })
    .where(and(eq(captureItems.id, id), eq(captureItems.authorId, authorId)))
    .returning({ id: captureItems.id });
  return rows.length > 0;
}

/** A fragment earns a post: seedling, first paragraph pre-filled, linked back. */
export async function promoteCapture(id: string, authorId: string) {
  const database = await readyDb();
  const [item] = await database
    .select()
    .from(captureItems)
    .where(and(eq(captureItems.id, id), eq(captureItems.authorId, authorId)))
    .limit(1);
  if (!item || item.state === 'discarded') return { ok: false as const, error: 'That capture is gone.' };
  if (item.promotedPostId) return { ok: true as const, postId: item.promotedPostId };

  const firstLine = item.body.split('\n')[0]!.trim().slice(0, 90) || 'Untitled seedling';
  const slugBase = firstLine
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const slug = `${slugBase || 'seedling'}-${nanoid().slice(0, 6)}`;

  const created = await createPost({
    slug,
    title: firstLine,
    authorId,
    body: [{ id: nanoid(), type: 'paragraph', text: item.body, layer: 'core' }],
    status: 'seedling',
    changeSummary: `Grown from a captured fragment.`,
  });

  await database
    .update(captureItems)
    .set({ state: 'draft', promotedPostId: created.postId })
    .where(eq(captureItems.id, id));
  return { ok: true as const, postId: created.postId };
}

export interface PostHealth {
  id: string;
  slug: string;
  title: string;
  status: typeof posts.$inferSelect['status'];
  versionCount: number;
  notes: number;
  openAsks: number;
  lastReviewedAt: number | null;
  staleDays: number | null;
}

/** Every post this author owns, with the three signals that say "look at me":
 *  unanswered reader questions, margin activity, and days since review. */
export async function myPostHealth(authorId: string): Promise<PostHealth[]> {
  const database = await readyDb();
  const own = await database
    .select({
      id: posts.id,
      slug: posts.slug,
      title: posts.title,
      status: posts.status,
      lastReviewedAt: posts.lastReviewedAt,
    })
    .from(posts)
    .where(eq(posts.authorId, authorId))
    .orderBy(desc(posts.updatedAt));

  const out: PostHealth[] = [];
  for (const p of own) {
    const [versions] = await database
      .select({ n: sql<number>`count(*)` })
      .from(postVersions)
      .where(eq(postVersions.postId, p.id));
    const [noteRows] = await database
      .select({ n: sql<number>`count(*)` })
      .from(annotations)
      .where(and(eq(annotations.postId, p.id), eq(annotations.status, 'visible')));
    const [askRows] = await database
      .select({ n: sql<number>`count(*)` })
      .from(asks)
      .where(and(eq(asks.postId, p.id), eq(asks.answer, '')));
    const staleDays = p.lastReviewedAt ? Math.floor((Date.now() - p.lastReviewedAt) / 86_400_000) : null;
    out.push({
      ...p,
      versionCount: Number(versions?.n ?? 0),
      notes: Number(noteRows?.n ?? 0),
      openAsks: Number(askRows?.n ?? 0),
      staleDays,
    });
  }
  // Most neglected first: unanswered questions, then stalest review.
  return out.sort((a, b) => b.openAsks - a.openAsks || (b.staleDays ?? 0) - (a.staleDays ?? 0));
}

/** Questions readers asked that this post could not answer. */
export async function getOpenAsks(postId: string, authorId: string) {
  const database = await readyDb();
  const [own] = await database.select({ id: posts.id }).from(posts).where(and(eq(posts.id, postId), eq(posts.authorId, authorId))).limit(1);
  if (!own) return [];
  return database
    .select({ id: asks.id, question: asks.question, createdAt: asks.createdAt })
    .from(asks)
    .where(and(eq(asks.postId, postId), eq(asks.answer, '')))
    .orderBy(desc(asks.createdAt))
    .limit(20);
}
