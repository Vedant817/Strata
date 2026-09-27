import { and, eq, isNotNull } from 'drizzle-orm';
import { readyDb } from '../db';
import { annotations, posts, postVersions, readReceipts } from '../db/schema';

/**
 * The thesis test, computed rather than asserted.
 *
 * §10.8 sets four kill criteria and says to write them down before the data is
 * flattering, so that the decision is not made by sunk cost. This module is
 * that decision procedure in code: every number it returns is shown on
 * `/thesis` next to the criterion it judges, including "not enough data",
 * which is itself an honest answer for a young publication.
 *
 * Reads are `read_receipts` — one row per reader per post per version, which
 * is the closest thing the schema has to "a read". Block-level reach events
 * would inflate the denominator by an order of magnitude and flatter every
 * rate built on it.
 */

export interface ThesisMetrics {
  posts: number;
  reads: number;
  /** Share of reads arriving 12+ months after publication. Criterion 1. */
  halfLifeShare: number;
  halfLifeReads: number;
  /** Share of posts revised within 60 days of publishing. Criterion 2. */
  revisedShare: number;
  revised: number;
  /** Annotations per 100 reads. Criterion 3 fires below 0.5 (1 per 200). */
  annotationsPerHundred: number;
  annotationCount: number;
  /** Share of readers seen on days 30+ days apart. Criterion 4. */
  returnShare: number;
  returningReaders: number;
  readers: number;
  /** Below this many reads every rate is noise, matching the cohort rule. */
  enoughData: boolean;
}

const DAY = 86_400_000;

export async function getThesisMetrics(): Promise<ThesisMetrics> {
  const database = await readyDb();

  const postRows = await database
    .select({ id: posts.id, publishedAt: posts.publishedAt })
    .from(posts)
    .where(and(eq(posts.visibility, 'public'), isNotNull(posts.publishedAt)));

  const versionRows = await database
    .select({
      postId: postVersions.postId,
      versionNumber: postVersions.versionNumber,
      createdAt: postVersions.createdAt,
    })
    .from(postVersions);

  const versionsByPost = new Map<string, { n: number; createdAt: number }[]>();
  for (const v of versionRows) {
    const list = versionsByPost.get(v.postId) ?? [];
    list.push({ n: v.versionNumber, createdAt: v.createdAt });
    versionsByPost.set(v.postId, list);
  }

  let revised = 0;
  for (const p of postRows) {
    if (!p.publishedAt) continue;
    const early = (versionsByPost.get(p.id) ?? []).some(
      (v) => v.n > 1 && v.createdAt <= p.publishedAt! + 60 * DAY,
    );
    if (early) revised++;
  }

  const readRows = await database
    .select({
      postId: readReceipts.postId,
      anonId: readReceipts.anonId,
      userId: readReceipts.userId,
      readAt: readReceipts.readAt,
    })
    .from(readReceipts);
  const publishedAt = new Map(postRows.map((p) => [p.id, p.publishedAt ?? 0]));

  const reads = readRows.length;
  const late = readRows.filter((r) => r.readAt >= (publishedAt.get(r.postId) ?? 0) + 365 * DAY).length;

  const noteRows = await database
    .select({ id: annotations.id })
    .from(annotations)
    .where(and(eq(annotations.status, 'visible'), eq(annotations.isPrivate, false)));

  const byReader = new Map<string, { first: number; last: number }>();
  for (const r of readRows) {
    const key = r.userId ?? r.anonId ?? 'unknown';
    const slot = byReader.get(key) ?? { first: r.readAt, last: r.readAt };
    slot.first = Math.min(slot.first, r.readAt);
    slot.last = Math.max(slot.last, r.readAt);
    byReader.set(key, slot);
  }
  const readers = byReader.size;
  const returning = [...byReader.values()].filter((s) => s.last - s.first >= 30 * DAY).length;

  return {
    posts: postRows.length,
    reads,
    halfLifeShare: reads === 0 ? 0 : late / reads,
    halfLifeReads: late,
    revisedShare: postRows.length === 0 ? 0 : revised / postRows.length,
    revised,
    annotationsPerHundred: reads === 0 ? 0 : (noteRows.length / reads) * 100,
    annotationCount: noteRows.length,
    returnShare: readers === 0 ? 0 : returning / readers,
    returningReaders: returning,
    readers,
    enoughData: reads >= 20,
  };
}

/** The four kill criteria with their live verdicts. `null` means unjudgeable. */
export function judgeThesis(m: ThesisMetrics): Array<{
  criterion: string;
  target: string;
  value: string;
  verdict: 'passing' | 'failing' | 'unknown';
}> {
  if (!m.enoughData) {
    return [
      {
        criterion: 'Post half-life beats a conventional blog',
        target: 'Meaningful share of reads at 12+ months',
        value: `${m.reads} reads so far — too few to judge`,
        verdict: 'unknown',
      },
      {
        criterion: '30% of posts revised within 60 days',
        target: '≥ 30%',
        value: `${m.reads} reads so far — too few to judge`,
        verdict: 'unknown',
      },
      {
        criterion: 'Marginalia loop forming',
        target: '≥ 1 annotation per 200 reads',
        value: `${m.reads} reads so far — too few to judge`,
        verdict: 'unknown',
      },
      {
        criterion: 'Memory compounding',
        target: '≥ 20% 30-day return',
        value: `${m.reads} reads so far — too few to judge`,
        verdict: 'unknown',
      },
    ];
  }
  return [
    {
      criterion: 'Post half-life beats a conventional blog',
      target: 'Meaningful share of reads at 12+ months',
      value: `${(m.halfLifeShare * 100).toFixed(1)}% of reads (${m.halfLifeReads}/${m.reads})`,
      verdict: m.halfLifeShare > 0.05 ? 'passing' : 'failing',
    },
    {
      criterion: '30% of posts revised within 60 days',
      target: '≥ 30%',
      value: `${(m.revisedShare * 100).toFixed(1)}% (${m.revised}/${m.posts} posts)`,
      verdict: m.revisedShare >= 0.3 ? 'passing' : 'failing',
    },
    {
      criterion: 'Marginalia loop forming',
      target: '≥ 1 annotation per 200 reads',
      value: `${m.annotationsPerHundred.toFixed(2)} per 100 reads (${m.annotationCount} notes)`,
      verdict: m.annotationsPerHundred >= 0.5 ? 'passing' : 'failing',
    },
    {
      criterion: 'Memory compounding',
      target: '≥ 20% 30-day return',
      value: `${(m.returnShare * 100).toFixed(1)}% (${m.returningReaders}/${m.readers} readers)`,
      verdict: m.returnShare >= 0.2 ? 'passing' : 'failing',
    },
  ];
}
