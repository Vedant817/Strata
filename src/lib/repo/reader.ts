import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { readyDb } from '../db';
import { annotations, posts, postVersions, readReceipts, topics } from '../db/schema';

export interface ReadEntry {
  slug: string;
  title: string;
  versionNumber: number;
  currentVersionNumber: number;
  behind: boolean;
  readAt: number;
}

export interface ReaderNote {
  id: string;
  postSlug: string;
  postTitle: string;
  kind: string;
  body: string;
  createdAt: number;
}

/**
 * Your reading memory, keyed by whoever this browser is.
 *
 * No account, no gate: the page reads the same anonymous receipts the "changed
 * since you read it" banner reads. A claimed handle merges both keys so
 * nothing is lost at the moment of claiming — the same promise the margin
 * notes already keep. Topics come from what was actually read, not from a
 * form, because interest stated on a form is aspiration and interest revealed
 * by reading is data.
 */
export async function getReaderMemory(anonId: string, userId: string | null) {
  const database = await readyDb();
  const who = userId
    ? or(eq(readReceipts.anonId, anonId), eq(readReceipts.userId, userId))
    : eq(readReceipts.anonId, anonId);

  const reads = await database
    .select({
      postId: readReceipts.postId,
      versionId: readReceipts.versionId,
      readAt: readReceipts.readAt,
      slug: posts.slug,
      title: posts.title,
    })
    .from(readReceipts)
    .innerJoin(posts, eq(readReceipts.postId, posts.id))
    .where(who)
    .orderBy(desc(readReceipts.readAt))
    .limit(50);

  // One row per post: the latest read. A reader who opened v3 then v5 saw v5.
  const latest = new Map<string, (typeof reads)[number]>();
  for (const r of reads) {
    if (!latest.has(r.postId)) latest.set(r.postId, r);
  }

  const entries: ReadEntry[] = [];
  for (const r of latest.values()) {
    const [version] = await database
      .select({ versionNumber: postVersions.versionNumber })
      .from(postVersions)
      .where(eq(postVersions.id, r.versionId))
      .limit(1);
    const [current] = await database
      .select({ n: postVersions.versionNumber })
      .from(postVersions)
      .where(eq(postVersions.postId, r.postId))
      .orderBy(desc(postVersions.versionNumber))
      .limit(1);
    entries.push({
      slug: r.slug,
      title: r.title,
      versionNumber: version?.versionNumber ?? 1,
      currentVersionNumber: current?.n ?? 1,
      behind: (current?.n ?? 1) > (version?.versionNumber ?? 1),
      readAt: r.readAt,
    });
  }

  const noteWho = userId
    ? or(eq(annotations.anonId, anonId), eq(annotations.authorId, userId))
    : and(eq(annotations.anonId, anonId), isNull(annotations.authorId));
  const noteRows = await database
    .select({
      id: annotations.id,
      kind: annotations.kind,
      body: annotations.body,
      createdAt: annotations.createdAt,
      postSlug: posts.slug,
      postTitle: posts.title,
    })
    .from(annotations)
    .innerJoin(posts, eq(annotations.postId, posts.id))
    .where(and(eq(annotations.status, 'visible'), noteWho))
    .orderBy(desc(annotations.createdAt))
    .limit(50);

  const topicRows = await database
    .select({ name: topics.name, slug: topics.slug })
    .from(topics)
    .innerJoin(posts, eq(posts.topicId, topics.id))
    .innerJoin(readReceipts, eq(readReceipts.postId, posts.id))
    .where(who)
    .groupBy(topics.id)
    .orderBy(desc(sql`count(*)`))
    .limit(10);

  return {
    entries,
    notes: noteRows as ReaderNote[],
    topics: topicRows,
  };
}
