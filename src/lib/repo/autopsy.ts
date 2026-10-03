import { and, eq, sql } from 'drizzle-orm';
import { readyDb } from '../db';
import { asks, posts, readEvents } from '../db/schema';
import { autopsyFromVersionBody, type AutopsyReport } from '../autopsy';
import { COHORT_FLOOR } from './empathy';

/**
 * Load the inputs Draft Autopsy needs and run it.
 *
 * Asks and reach are aggregated, never per-reader. The skip-rate half of the
 * long-section finding is withheld below the same cohort floor empathy uses,
 * so a curve drawn from three people cannot become a percentage in a sentence
 * a writer might quote.
 */
export async function getAutopsy(postId: string): Promise<AutopsyReport | null> {
  const database = await readyDb();
  const [post] = await database
    .select({ id: posts.id })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);
  if (!post) return null;

  const [version] = await database
    .select({ body: sql<string>`pv.body` })
    .from(sql`post_versions pv`)
    .where(sql`pv.id = (select current_version_id from posts where id = ${postId})`)
    .limit(1);

  const askRows = await database
    .select({ question: asks.question, blockId: asks.blockId, anonId: asks.anonId, askedById: asks.askedById })
    .from(asks)
    .where(eq(asks.postId, postId));

  const [cohortRow] = await database
    .select({ n: sql<number>`count(distinct ${readEvents.anonId})` })
    .from(readEvents)
    .where(eq(readEvents.postId, postId));

  const reachRows = await database
    .select({
      blockId: readEvents.blockId,
      reached: sql<number>`count(distinct ${readEvents.anonId})`,
    })
    .from(readEvents)
    .where(
      and(
        eq(readEvents.postId, postId),
        eq(readEvents.event, 'reached'),
        sql`${readEvents.blockId} is not null`,
      ),
    )
    .groupBy(readEvents.blockId);

  return autopsyFromVersionBody(version?.body, {
    asks: askRows.map((r) => ({
      question: r.question,
      blockId: r.blockId,
      asker: r.askedById ?? r.anonId ?? null,
    })),
    reach: reachRows.map((r) => ({ blockId: r.blockId as string, reached: Number(r.reached) })),
    cohort: Number(cohortRow?.n ?? 0),
    cohortFloor: COHORT_FLOOR,
  });
}
