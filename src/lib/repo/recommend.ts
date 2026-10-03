import { and, desc, eq, inArray, notInArray, or, sql } from 'drizzle-orm';
import { readyDb } from '../db';
import { posts, postVersions, readReceipts } from '../db/schema';
import { pickThree, type Recommendation } from '../recommend';

/**
 * Three unread posts that fit the reader's just-demonstrated state.
 *
 * Selected explicitly rather than via `listPosts`, whose projection is
 * smaller than its advertised type — reading `id` off that would be
 * undefined at runtime while type-checking happily.
 */
export async function recommendAfterRead(
  anonId: string,
  userId: string | null,
  excludePostId?: string,
): Promise<Recommendation[]> {
  const database = await readyDb();
  const who = userId
    ? or(eq(readReceipts.anonId, anonId), eq(readReceipts.userId, userId))
    : eq(readReceipts.anonId, anonId);

  const readRows = await database
    .select({ postId: readReceipts.postId })
    .from(readReceipts)
    .where(who);
  const readIds = new Set(readRows.map((r) => r.postId));
  if (excludePostId) readIds.add(excludePostId);

  const versionCount = sql<number>`(select count(*) from post_versions where post_versions.post_id = ${posts.id})`;
  const readingMinutes = sql<number>`max(1, round((length(${postVersions.body}) / 4.6) / 220))`;

  const rows = await database
    .select({
      id: posts.id,
      slug: posts.slug,
      title: posts.title,
      dek: posts.dek,
      readingMinutes,
      versionCount,
    })
    .from(posts)
    .innerJoin(postVersions, eq(posts.currentVersionId, postVersions.id))
    .where(
      and(
        eq(posts.visibility, 'public'),
        inArray(posts.status, ['budding', 'evergreen']),
        readIds.size > 0 ? notInArray(posts.id, [...readIds]) : sql`1=1`,
      ),
    )
    .orderBy(desc(posts.publishedAt));

  return pickThree(
    rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      dek: r.dek,
      readingMinutes: Number(r.readingMinutes) || 1,
      versionCount: Number(r.versionCount) || 1,
    })),
  );
}
