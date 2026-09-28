import { and, desc, eq, sql } from 'drizzle-orm';
import { readyDb } from '../db';
import { annotations, asks, blocks, posts, readEvents } from '../db/schema';
import { getHighlights } from './highlights';
import { blockToPlainText, parseBody } from '../blocks';

/**
 * Empathy analytics, v1: where did readers think, and where did thinking break?
 *
 * Not a scroll heatmap. Those are creepy, frequently wrong about the problem,
 * and they point the writer at the wrong fix. Three honest signals instead:
 *
 *   - per-block reach, as a drop-off curve, in aggregate
 *   - highlight hotspots, which sentences readers marked
 *   - confusion, which is *unanswered* Ask questions and reader disagreement
 *
 * The suppression floor from §1.3 is enforced here rather than described in a
 * policy document: below COHORT_FLOOR readers the view refuses to render
 * numbers at all, and says how many more are needed. A curve drawn from three
 * people is not information about comprehension, it is noise with an axis.
 */

export const COHORT_FLOOR = 20;

export interface BlockReach {
  blockId: string;
  ordinal: number;
  headingPath: string;
  type: string;
  preview: string;
  reached: number;
  /** Reach as a share of the post's first block, so the curve is readable. */
  relative: number;
}

export interface Hotspot {
  blockId: string;
  text: string;
  /** How many distinct readers highlighted this span. */
  readers: number;
}

export interface ConfusionSignal {
  blockId: string;
  kind: 'unanswered_ask' | 'disagreement' | 'correction';
  count: number;
  /** The reader question, for asks. */
  question?: string;
}

export interface EmpathyReport {
  postId: string;
  slug: string;
  title: string;
  /** Distinct readers. Below COHORT_FLOOR the rest is withheld. */
  cohort: number;
  impressions: number;
  suppressed: boolean;
  blocks: BlockReach[];
  hotspots: Hotspot[];
  confusion: ConfusionSignal[];
  /** The block where the largest share of readers stopped, if any. */
  dropOff: { blockId: string; preview: string; share: number } | null;
}

export async function getEmpathyReport(postId: string): Promise<EmpathyReport | null> {
  const database = await readyDb();
  const [post] = await database
    .select({ id: posts.id, slug: posts.slug, title: posts.title, authorId: posts.authorId })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);
  if (!post) return null;

  const [version] = await database
    .select({ body: sql<string>`pv.body` })
    .from(sql`post_versions pv`)
    .where(sql`pv.id = (select current_version_id from posts where id = ${postId})`)
    .limit(1);

  const doc = version ? parseBody(version.body) : [];

  const blockRows = await database
    .select({ blockId: blocks.blockId, ordinal: blocks.ordinal })
    .from(blocks)
    .where(
      and(
        eq(blocks.postId, postId),
        sql`${blocks.versionId} = (select current_version_id from posts where id = ${postId})`,
      ),
    )
    .orderBy(blocks.ordinal);

  /* Aggregated separately and joined in JS, not as a correlated subquery in the
     select list. The correlated form silently reported the post's total for
     every block — the inner `read_events.block_id` reference shadowed the outer
     `blocks.block_id`, so the whole curve read as a flat line. Verified against
     raw per-block counts; grouping first cannot alias. */
  const reachRows = await database
    .select({
      blockId: readEvents.blockId,
      readers: sql<number>`count(distinct ${readEvents.anonId})`,
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
  const reachByBlock = new Map(
    reachRows.map((r) => [r.blockId as string, Number(r.readers)]),
  );
  const rows = blockRows.map((b) => ({
    blockId: b.blockId,
    ordinal: b.ordinal,
    reached: reachByBlock.get(b.blockId) ?? 0,
  }));

  const [cohortRow] = await database
    .select({ n: sql<number>`count(distinct ${readEvents.anonId})` })
    .from(readEvents)
    .where(eq(readEvents.postId, postId));
  const [impressionRow] = await database
    .select({ n: sql<number>`count(*)` })
    .from(readEvents)
    .where(and(eq(readEvents.postId, postId), eq(readEvents.event, 'impression')));

  const cohort = Number(cohortRow?.n ?? 0);
  const suppressed = cohort < COHORT_FLOOR;

  const byId = new Map(doc.map((b) => [b.id, b]));
  const peak = Math.max(1, ...rows.map((r) => Number(r.reached)));
  const blockReach: BlockReach[] = rows.map((r) => {
    const block = byId.get(r.blockId);
    const text = block ? blockToPlainText(block) : '';
    return {
      blockId: r.blockId,
      ordinal: r.ordinal,
      headingPath: '',
      type: block?.type ?? 'paragraph',
      preview: text.replace(/\s+/g, ' ').trim().slice(0, 120),
      reached: Number(r.reached),
      relative: Number(r.reached) / peak,
    };
  });

  /* The drop-off is the first meaningful fall in the curve — not the last
     block, which is simply where the post ends.
     Restricted to prose on purpose: readers "falling off" at a code block or a
     figure is an artefact of what the eye does with a wall of source, not a
     comprehension signal, and telling a writer their argument died at a class
     declaration would be worse than saying nothing. */
  const PROSE = new Set(['paragraph', 'quote', 'tldr', 'list', 'callout', 'primer', 'heading']);
  let dropOff: EmpathyReport['dropOff'] = null;
  for (let i = 1; i < blockReach.length; i++) {
    const prev = blockReach[i - 1]!;
    const cur = blockReach[i]!;
    if (prev.reached <= 0) continue;
    if (!PROSE.has(prev.type)) continue;
    const fall = (prev.reached - cur.reached) / prev.reached;
    if (fall >= 0.25 && prev.reached >= 3) {
      // Name the paragraph they *finished*, not the one they hit.
      dropOff = { blockId: prev.blockId, preview: prev.preview, share: fall };
      break;
    }
  }

  const hotspots: Hotspot[] = [];
  const confusion: ConfusionSignal[] = [];

  if (!suppressed) {
    // Highlights come from the `highlights` table, which is where they are
    // actually written. The previous query read `read_events` filtered to
    // `event = 'highlight'` — an event nothing has ever emitted, so the "what
    // got highlighted" panel was permanently empty while claiming to be real.
    // Aggregated per block, never per person.
    const hl = await getHighlights(postId, 5);
    for (const h of hl) {
      const block = byId.get(h.blockId);
      hotspots.push({
        blockId: h.blockId,
        text: h.text || (block ? blockToPlainText(block) : '').replace(/\s+/g, ' ').trim().slice(0, 180),
        readers: h.readers,
      });
    }

    // Confusion: questions this post could not answer, plus reader-vs-reader
    // disagreement and corrections. These are the rows that say what to write.
    const openAsks = await database
      .select({ question: asks.question, count: sql<number>`count(*)` })
      .from(asks)
      .where(and(eq(asks.postId, postId), eq(asks.answer, '')))
      .groupBy(asks.question)
      .orderBy(desc(sql`count(*)`))
      .limit(5);
    for (const a of openAsks) {
      confusion.push({
        blockId: '',
        kind: 'unanswered_ask',
        count: Number(a.count),
        question: a.question,
      });
    }

    const noteKinds = await database
      .select({ kind: annotations.kind, count: sql<number>`count(*)` })
      .from(annotations)
      .where(and(eq(annotations.postId, postId), eq(annotations.status, 'visible')))
      .groupBy(annotations.kind);
    for (const k of noteKinds) {
      if (k.kind === 'disagreement' || k.kind === 'correction') {
        confusion.push({
          blockId: '',
          kind: k.kind === 'disagreement' ? 'disagreement' : 'correction',
          count: Number(k.count),
        });
      }
    }
    confusion.sort((a, b) => b.count - a.count);
  }

  return {
    postId,
    slug: post.slug,
    title: post.title,
    cohort,
    impressions: Number(impressionRow?.n ?? 0),
    suppressed,
    blocks: suppressed ? [] : blockReach,
    hotspots,
    confusion: confusion.slice(0, 10),
    dropOff,
  };
}
