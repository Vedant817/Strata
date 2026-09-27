import { and, desc, eq, sql } from 'drizzle-orm';
import { readyDb } from '../db';
import { highlights, posts } from '../db/schema';
import { nanoid } from '../ids';

/**
 * Reader highlights.
 *
 * The table has existed since the first migration with no code behind it.
 * Highlights are a reader act with no social consequence: nobody is told, no
 * count is shown publicly, and the only place they surface is a writer's
 * "what got highlighted" list, aggregated to the block and never to the
 * person. That is the difference between a highlight and applause.
 *
 * Keyed by `u:<userId>` or `a:<anonId>` like every other reader memory, so
 * highlighting never asks for an account, and claiming keeps them.
 */
export function highlightKeyFor(authorId: string | null, anonId: string): string {
  return authorId ? `u:${authorId}` : `a:${anonId}`;
}

export async function toggleHighlight(args: {
  postId: string;
  blockId: string;
  text: string;
  key: string;
  userId: string | null;
}): Promise<boolean> {
  const database = await readyDb();
  const existing = await database
    .select({ id: highlights.id })
    .from(highlights)
    .where(
      and(
        eq(highlights.postId, args.postId),
        eq(highlights.blockId, args.blockId),
        sql`(${highlights.userId} = ${args.userId} or ${highlights.anonId} = ${args.key})`,
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    await database.delete(highlights).where(eq(highlights.id, existing[0]!.id));
    return false;
  }
  await database.insert(highlights).values({
    id: nanoid(),
    postId: args.postId,
    blockId: args.blockId,
    userId: args.userId,
    anonId: args.key,
    text: args.text.replace(/\s+/g, ' ').trim().slice(0, 600),
  });
  return true;
}

export interface Hotspot {
  blockId: string;
  text: string;
  readers: number;
}

/** Aggregated per block, never per person. */
export async function getHighlights(postId: string, limit = 10): Promise<Hotspot[]> {  const database = await readyDb();
  const rows = await database
    .select({
      blockId: highlights.blockId,
      text: sql<string>`max(${highlights.text})`,
      readers: sql<number>`count(distinct coalesce(${highlights.userId}, ${highlights.anonId}))`,
    })
    .from(highlights)
    .where(eq(highlights.postId, postId))
    .groupBy(highlights.blockId)
    .orderBy(desc(sql`count(distinct coalesce(${highlights.userId}, ${highlights.anonId}))`))
    .limit(limit);
  return rows.map((r) => ({ blockId: r.blockId, text: r.text, readers: Number(r.readers) }));
}

export interface ReaderHighlight {
  postSlug: string;
  postTitle: string;
  text: string;
  createdAt: number;
}

export async function getMyHighlights(
  anonId: string,
  userId: string | null,
  limit = 50,
): Promise<ReaderHighlight[]> {
  const database = await readyDb();
  const key = `a:${anonId}`;
  const who = userId
    ? sql`(${highlights.userId} = ${userId} or ${highlights.anonId} = ${key})`
    : sql`${highlights.anonId} = ${key}`;
  return database
    .select({
      postSlug: posts.slug,
      postTitle: posts.title,
      text: highlights.text,
      createdAt: highlights.createdAt,
    })
    .from(highlights)
    .innerJoin(posts, eq(highlights.postId, posts.id))
    .where(who)
    .orderBy(desc(highlights.createdAt))
    .limit(limit);
}
