/**
 * Post repository: reading, versioning, and the materialised block index.
 *
 * Every query funnels through `readyDb()` so migrations are guaranteed to have
 * run. Diffs are always computed from stored versions and never persisted —
 * a stored diff is a diff that will be wrong after the next schema change.
 */

import { and, asc, count, desc, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import { readyDb } from '../db';
import {
  annotations,
  blocks,
  postLinks,
  postVersions,
  posts,
  readEvents,
  readReceipts,
  topics,
  users,
} from '../db/schema';
import {
  blockToPlainText,
  countWords,
  headingPaths,
  parseBody,
  serializeBody,
  type Block,
} from '../blocks';
import { diffBlocks, type DiffEntry } from '../diff';
import { nanoid } from '../ids';
import { rebuildSearchIndex } from './search';

export type PostWithMeta = typeof posts.$inferSelect & {
  authorHandle: string;
  authorName: string;
  topicName: string | null;
  versionCount: number;
  annotationTotal: number;
  readingMinutes: number;
};

export interface PostWithBody extends PostWithMeta {
  version: typeof postVersions.$inferSelect;
  blocks: Block[];
}

const annotationTotal = sql<number>`(
  select count(*) from ${annotations}
  where ${annotations.postId} = ${posts.id}
    and ${annotations.status} = 'visible'
    and ${annotations.isPrivate} = 0
)`;

const versionCount = sql<number>`(
  select count(*) from ${postVersions} where ${postVersions.postId} = ${posts.id}
)`;

const minutes = sql<number>`max(1, round((length(${postVersions.body}) / 4.6) / 220))`;

const baseSelect = {
  authorHandle: users.handle,
  authorName: users.displayName,
  topicName: topics.name,
  versionCount,
  annotationTotal,
  readingMinutes: minutes,
};

export async function getPostBySlug(slug: string): Promise<PostWithBody | null> {
  const database = await readyDb();
  const rows = await database
    .select({ post: posts, version: postVersions, ...baseSelect })
    .from(posts)
    .innerJoin(users, eq(posts.authorId, users.id))
    .leftJoin(topics, eq(posts.topicId, topics.id))
    .innerJoin(postVersions, eq(posts.currentVersionId, postVersions.id))
    .where(eq(posts.slug, slug))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { ...row.post, ...row, blocks: parseBody(row.version.body) };
}

export async function getPostById(id: string): Promise<PostWithBody | null> {
  const database = await readyDb();
  const rows = await database
    .select({ post: posts, version: postVersions, ...baseSelect })
    .from(posts)
    .innerJoin(users, eq(posts.authorId, users.id))
    .leftJoin(topics, eq(posts.topicId, topics.id))
    .innerJoin(postVersions, eq(posts.currentVersionId, postVersions.id))
    .where(eq(posts.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { ...row.post, ...row, blocks: parseBody(row.version.body) };
}

export interface ListOptions {
  status?: Array<typeof posts.$inferSelect['status']>;
  topicId?: string;
  authorId?: string;
  limit?: number;
  offset?: number;
  includeUnpublished?: boolean;
}

export async function listPosts(options: ListOptions = {}): Promise<PostWithMeta[]> {
  const database = await readyDb();
  const { limit = 50, offset = 0 } = options;
  const statuses = options.status ?? ['seedling', 'budding', 'evergreen'];

  const conditions = [inArray(posts.status, statuses), eq(posts.visibility, 'public')];
  if (options.topicId) conditions.push(eq(posts.topicId, options.topicId));
  if (options.authorId) conditions.push(eq(posts.authorId, options.authorId));

  const rows = await database
    .select(baseSelect)
    .from(posts)
    .innerJoin(users, eq(posts.authorId, users.id))
    .leftJoin(topics, eq(posts.topicId, topics.id))
    .innerJoin(postVersions, eq(posts.currentVersionId, postVersions.id))
    .where(and(...conditions))
    .orderBy(desc(posts.publishedAt), desc(posts.updatedAt))
    .limit(limit)
    .offset(offset);
  return rows as PostWithMeta[];
}

export async function countPosts(options: ListOptions = {}): Promise<number> {
  const database = await readyDb();
  const statuses = options.status ?? ['seedling', 'budding', 'evergreen'];
  const conditions = [inArray(posts.status, statuses), eq(posts.visibility, 'public')];
  if (options.topicId) conditions.push(eq(posts.topicId, options.topicId));
  if (options.authorId) conditions.push(eq(posts.authorId, options.authorId));
  const [row] = await database
    .select({ n: count() })
    .from(posts)
    .where(and(...conditions));
  return row?.n ?? 0;
}

export async function getVersions(postId: string) {
  const database = await readyDb();
  return database
    .select()
    .from(postVersions)
    .where(eq(postVersions.postId, postId))
    .orderBy(desc(postVersions.versionNumber));
}

export async function getVersionByNumber(postId: string, versionNumber: number) {
  const database = await readyDb();
  const rows = await database
    .select()
    .from(postVersions)
    .where(and(eq(postVersions.postId, postId), eq(postVersions.versionNumber, versionNumber)))
    .limit(1);
  return rows[0] ?? null;
}

/** The version immediately before `versionNumber`, used as the diff base. */
export async function getPreviousVersion(postId: string, versionNumber: number) {
  const database = await readyDb();
  const rows = await database
    .select()
    .from(postVersions)
    .where(and(eq(postVersions.postId, postId), lt(postVersions.versionNumber, versionNumber)))
    .orderBy(desc(postVersions.versionNumber))
    .limit(1);
  return rows[0] ?? null;
}

export interface RevisionView {
  current: typeof postVersions.$inferSelect;
  compared: typeof postVersions.$inferSelect | null;
  diff: DiffEntry[];
}

export async function getRevisionView(
  postId: string,
  versionNumber?: number,
): Promise<RevisionView | null> {
  const target = versionNumber
    ? await getVersionByNumber(postId, versionNumber)
    : (await getPostById(postId))?.version ?? null;
  if (!target) return null;

  const previous = await getPreviousVersion(postId, target.versionNumber);
  return {
    current: target,
    compared: previous,
    diff: previous ? diffBlocks(parseBody(previous.body), parseBody(target.body)) : [],
  };
}

export async function getAdjacent(postId: string) {
  const database = await readyDb();
  const post = await getPostById(postId);
  if (!post?.publishedAt) return { newer: null, older: null };

  const [newer] = await database
    .select({ slug: posts.slug, title: posts.title })
    .from(posts)
    .where(
      and(
        eq(posts.authorId, post.authorId),
        eq(posts.visibility, 'public'),
        ne(posts.id, postId),
        sql`${posts.publishedAt} > ${post.publishedAt}`,
      ),
    )
    .orderBy(asc(posts.publishedAt))
    .limit(1);

  const [older] = await database
    .select({ slug: posts.slug, title: posts.title })
    .from(posts)
    .where(
      and(
        eq(posts.authorId, post.authorId),
        eq(posts.visibility, 'public'),
        ne(posts.id, postId),
        sql`${posts.publishedAt} < ${post.publishedAt}`,
      ),
    )
    .orderBy(desc(posts.publishedAt))
    .limit(1);

  return { newer: newer ?? null, older: older ?? null };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

/** Materialise the searchable/diffable block index for one version. */
async function materialize(versionId: string, postId: string, doc: Block[]): Promise<void> {
  const database = await readyDb();
  const paths = headingPaths(doc);
  const rows = doc.map((block, ordinal) => ({
    id: nanoid(),
    postId,
    versionId,
    blockId: block.id,
    ordinal,
    type: block.type,
    layer: block.layer,
    text: blockToPlainText(block),
    headingPath: paths.get(block.id) ?? '',
    wordCount: countWords(blockToPlainText(block)),
  }));
  if (rows.length === 0) return;
  await database.insert(blocks).values(rows);
}

export interface CreatePostInput {
  slug: string;
  title: string;
  dek?: string;
  authorId: string;
  body: Block[];
  status?: typeof posts.$inferSelect['status'];
  topicId?: string;
  seriesId?: string;
  publishedAt?: number;
  seoDescription?: string;
  /** Where this post lived before it was imported, so inbound links keep
   *  resolving to something truthful. */
  originalUrl?: string;
  changeSummary?: string;
  isMajor?: boolean;
  forkedFromId?: string;
}

export async function createPost(input: CreatePostInput) {
  const database = await readyDb();
  const now = Date.now();
  const postId = nanoid();
  const versionId = nanoid();
  const status = input.status ?? 'seedling';
  const isPublic = status !== 'seedling' || Boolean(input.publishedAt);

  await database.insert(posts).values({
    id: postId,
    slug: input.slug,
    title: input.title,
    dek: input.dek ?? '',
    authorId: input.authorId,
    status,
    visibility: isPublic ? 'public' : 'unlisted',
    currentVersionId: versionId,
    publishedAt: input.publishedAt ?? (isPublic ? now : null),
    createdAt: now,
    updatedAt: now,
    lastReviewedAt: now,
    topicId: input.topicId ?? null,
    seriesId: input.seriesId ?? null,
    seoDescription: input.seoDescription ?? input.dek ?? '',
    forkedFromId: input.forkedFromId ?? null,
    originalUrl: input.originalUrl ?? null,
  });

  await database.insert(postVersions).values({
    id: versionId,
    postId,
    versionNumber: 1,
    body: serializeBody(input.body),
    changeSummary: input.changeSummary ?? 'First published version.',
    authorId: input.authorId,
    createdAt: now,
    isMajor: input.isMajor ?? true,
  });

  await materialize(versionId, postId, input.body);

  if (input.forkedFromId) {
    await database
      .insert(postLinks)
      .values({ fromPostId: postId, toPostId: input.forkedFromId, type: 'fork_of' })
      .onConflictDoNothing();
  }

  // The search index is a projection of the current version, so it refreshes
  // on every publish rather than on a timer that can serve stale results.
  await rebuildSearchIndex();

  return { postId, versionId };
}

export interface RevisionInput {
  postId: string;
  authorId: string;
  body: Block[];
  changeSummary: string;
  isMajor?: boolean;
  /** Optional lifecycle transition applied alongside the revision. */
  status?: typeof posts.$inferSelect['status'];
}

export async function publishRevision(input: RevisionInput) {
  const database = await readyDb();
  const versions = await getVersions(input.postId);
  const nextNumber = (versions[0]?.versionNumber ?? 0) + 1;
  const versionId = nanoid();
  const now = Date.now();

  await database.insert(postVersions).values({
    id: versionId,
    postId: input.postId,
    versionNumber: nextNumber,
    body: serializeBody(input.body),
    changeSummary: input.changeSummary,
    authorId: input.authorId,
    createdAt: now,
    isMajor: input.isMajor ?? false,
  });

  await materialize(versionId, input.postId, input.body);

  const existing = await getPostById(input.postId);
  const firstPublish = !existing?.publishedAt;

  await database
    .update(posts)
    .set({
      currentVersionId: versionId,
      updatedAt: now,
      lastReviewedAt: input.status ? now : existing?.lastReviewedAt ?? now,
      status: input.status ?? existing?.status ?? 'seedling',
      visibility: firstPublish ? 'public' : (existing?.visibility ?? 'public'),
      publishedAt: firstPublish ? now : existing?.publishedAt,
    })
    .where(eq(posts.id, input.postId));

  await rebuildSearchIndex();

  return { versionId, versionNumber: nextNumber };
}

/**
 * The maintenance heartbeat: the author looked at this post and it still
 * stands (optionally graduating it a lifecycle state). Staleness is a nudge,
 * never a shame badge — but a nudge needs a way to be answered, and this is
 * it. Separate from publishing a revision because "still true" is the most
 * common and most valuable review outcome, and it should not require inventing
 * a change.
 */
export async function markReviewed(
  postId: string,
  authorId: string,
  status?: typeof posts.$inferSelect['status'],
): Promise<boolean> {
  const database = await readyDb();
  const [own] = await database
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.id, postId), eq(posts.authorId, authorId)))
    .limit(1);
  if (!own) return false;
  await database
    .update(posts)
    .set({ lastReviewedAt: Date.now(), updatedAt: Date.now(), ...(status ? { status } : {}) })
    .where(eq(posts.id, postId));
  return true;
}

/**
 * Fork a post into your own seedling.
 *
 * The fork starts as a copy of the ancestor's current blocks with fresh ids —
 * shared ids would tangle the two posts' annotation anchors — and inherits
 * the ancestor's outbound links, so lineage compounds rather than resets. The
 * `fork_of` edge makes the chain traversable in both directions.
 */
export async function forkPost(postId: string, authorId: string) {
  const database = await readyDb();
  const ancestor = await getPostById(postId);
  if (!ancestor || ancestor.visibility !== 'public' || !ancestor.publishedAt) {
    return { ok: false as const, error: 'That post cannot be forked.' };
  }
  const body = ancestor.blocks.map((b) => ({ ...b, id: nanoid() }));
  const slug = `${ancestor.slug}-fork-${nanoid().slice(0, 6)}`;

  const created = await createPost({
    slug,
    title: `Fork of ${ancestor.title}`,
    dek: ancestor.dek,
    authorId,
    body,
    status: 'seedling',
    changeSummary: `Forked from "${ancestor.title}".`,
    forkedFromId: ancestor.id,
  });

  const outbound = await database
    .select()
    .from(postLinks)
    .where(eq(postLinks.fromPostId, ancestor.id));
  for (const link of outbound) {
    if (link.toPostId === ancestor.id) continue;
    // A fork_of edge names *this* fork's ancestor, not the grandparent's —
    // the new post gets exactly one, pointing at the post it was cut from.
    if (link.type === 'fork_of') continue;
    await addLink(created.postId, link.toPostId, link.type);
  }
  return { ok: true as const, postId: created.postId, slug };
}

/* -------------------------------------------------------------------------- */
/* Reader memory                                                              */
/* -------------------------------------------------------------------------- */

export async function getLastReceipt(anonId: string, postId: string) {
  const database = await readyDb();
  const rows = await database
    .select({
      versionId: readReceipts.versionId,
      versionNumber: postVersions.versionNumber,
      readAt: readReceipts.readAt,
    })
    .from(readReceipts)
    .innerJoin(postVersions, eq(readReceipts.versionId, postVersions.id))
    .where(and(eq(readReceipts.postId, postId), eq(readReceipts.anonId, anonId)))
    .orderBy(desc(readReceipts.readAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function recordRead(args: {
  postId: string;
  versionId: string;
  anonId: string;
  userId?: string | null;
}) {
  const database = await readyDb();
  const now = Date.now();
  const existing = await getLastReceipt(args.anonId, args.postId);
  if (existing?.versionId === args.versionId && now - existing.readAt < 20 * 60 * 1000) return;

  await database
    .insert(readReceipts)
    .values({ id: nanoid(), postId: args.postId, versionId: args.versionId, anonId: args.anonId, userId: args.userId ?? null, readAt: now });

  // The impression is the denominator for every drop-off number a writer ever
  // sees. Without it recorded on the server, the reach beacon below has
  // nothing to be a fraction of.
  await database.insert(readEvents).values({
    id: nanoid(),
    postId: args.postId,
    blockId: null,
    userId: args.userId ?? null,
    anonId: args.anonId,
    event: 'impression',
    createdAt: now,
  });
}

/** One row per block the reader actually reached, batched by the client. */
export async function recordReach(args: {
  postId: string;
  anonId: string;
  userId?: string | null;
  blockIds: string[];
}) {
  if (args.blockIds.length === 0) return 0;
  const database = await readyDb();
  const now = Date.now();
  const rows = args.blockIds.slice(0, 400).map((blockId) => ({
    id: nanoid(),
    postId: args.postId,
    blockId,
    userId: args.userId ?? null,
    anonId: args.anonId,
    event: 'reached' as const,
    positionRatio: null,
    createdAt: now,
  }));
  await database.insert(readEvents).values(rows);
  return rows.length;
}

export async function recordEvent(args: {
  postId: string;
  blockId?: string | null;
  anonId: string;
  userId?: string | null;
  event: 'impression' | 'dwell' | 'reached' | 'highlight' | 'ask' | 'rewind';
  dwellMs?: number;
  positionRatio?: number;
}) {
  const database = await readyDb();
  await database.insert(readEvents).values({
    id: nanoid(),
    postId: args.postId,
    blockId: args.blockId ?? null,
    anonId: args.anonId,
    userId: args.userId ?? null,
    event: args.event,
    dwellMs: args.dwellMs ?? null,
    positionRatio: args.positionRatio ?? null,
    createdAt: Date.now(),
  });
}

export async function incrementViews(postId: string) {
  const database = await readyDb();
  await database
    .update(posts)
    .set({ viewCount: sql`${posts.viewCount} + 1` })
    .where(eq(posts.id, postId));
}

/** Forget everything we know about an anonymous reader. Exercise-able privacy. */
export async function forgetReader(anonId: string) {
  const database = await readyDb();
  await database.delete(readReceipts).where(eq(readReceipts.anonId, anonId));
  await database.delete(readEvents).where(eq(readEvents.anonId, anonId));
}

/* -------------------------------------------------------------------------- */
/* Graph                                                                      */
/* -------------------------------------------------------------------------- */

export interface LinkedPost {
  slug: string;
  title: string;
  dek: string;
  type: 'cites' | 'extends' | 'contradicts' | 'fork_of' | 'mentions';
  direction: 'out' | 'in';
  publishedAt: number | null;
}

export async function getLinks(postId: string): Promise<LinkedPost[]> {
  const database = await readyDb();
  const outRows = await database
    .select({
      slug: posts.slug,
      title: posts.title,
      dek: posts.dek,
      type: postLinks.type,
      publishedAt: posts.publishedAt,
    })
    .from(postLinks)
    .innerJoin(posts, eq(postLinks.toPostId, posts.id))
    .where(eq(postLinks.fromPostId, postId));

  const inRows = await database
    .select({
      slug: posts.slug,
      title: posts.title,
      dek: posts.dek,
      type: postLinks.type,
      publishedAt: posts.publishedAt,
    })
    .from(postLinks)
    .innerJoin(posts, eq(postLinks.fromPostId, posts.id))
    .where(eq(postLinks.toPostId, postId));

  return [
    ...outRows.map((r) => ({ ...r, direction: 'out' as const })),
    ...inRows.map((r) => ({ ...r, direction: 'in' as const })),
  ];
}

export async function addLink(fromPostId: string, toPostId: string, type: 'cites' | 'extends' | 'contradicts' | 'mentions') {
  const database = await readyDb();
  await database.insert(postLinks).values({ fromPostId, toPostId, type }).onConflictDoNothing();
}

export interface LinkSuggestion {
  postId: string;
  slug: string;
  title: string;
  dek: string;
  shared: string[];
  /** TF-IDF overlap weight. Internal ranking only — never shown, because a
   *  number would imply a confidence the heuristic does not have. */
  score?: number;
}

/**
 * Back-catalog linking suggestions.
 *
 * A writer with ten posts cannot hold all pairwise connections in their head,
 * so old posts stay unlinked and the graph stays thin where it should be
 * dense. For each owned post, take significant terms from its title and dek,
 * match them against the post index, and exclude the post itself plus
 * everything already linked in either direction. What remains is a short list
 * of "did you mean to connect these?" — the writer still decides the type or
 * dismisses it, because only the writer knows whether shared vocabulary means
 * a real relationship or a coincidence.
 */
export async function suggestLinks(postId: string, authorId: string, limit = 5): Promise<LinkSuggestion[]> {
  const database = await readyDb();
  const { parseBody } = await import('../blocks');
  const { blockToPlainText } = await import('../blocks');

  const [own] = await database
    .select({ id: posts.id, body: postVersions.body })
    .from(posts)
    .innerJoin(postVersions, eq(posts.currentVersionId, postVersions.id))
    .where(and(eq(posts.id, postId), eq(posts.authorId, authorId)))
    .limit(1);
  if (!own) return [];

  /* Distinctive terms, not just frequent ones. "System" appears everywhere
     and suggests everything; "eviction" appears here and almost nowhere else,
     so a post containing it is probably actually related. Term frequency in
     this post times inverse frequency across the corpus, top eight. At five
     posts the corpus fits in memory without thinking about it. */
  const STOP = new Set(
    'about above after again against always among another around because become before behind being below between both during every first from further had having here however into itself just like made make many might more most much never often only other ought same should since some such than that their them then there these through under until want were what when where which while with within without would your this have will there their said each which how the and for are but not you all any can had her was one our out day get has him his how man new now old see two way who boy did its let put say she too use'.split(
      ' ',
    ),
  );
  const wordOf = (text: string) =>
    (text.toLowerCase().match(/[a-z][a-z'-]{4,}/g) ?? []).filter((w) => !STOP.has(w));

  const ownText = parseBody(own.body).map((b) => blockToPlainText(b)).join(' ');
  const ownCounts = new Map<string, number>();
  for (const w of wordOf(ownText)) ownCounts.set(w, (ownCounts.get(w) ?? 0) + 1);

  const others = await database
    .select({ slug: posts.slug, body: postVersions.body })
    .from(posts)
    .innerJoin(postVersions, eq(posts.currentVersionId, postVersions.id))
    .where(and(eq(posts.visibility, 'public'), sql`${posts.publishedAt} is not null`));
  const docFreq = new Map<string, number>();
  const bodies = new Map<string, string>();
  for (const o of others) {
    const text = parseBody(o.body).map((b) => blockToPlainText(b)).join(' ');
    bodies.set(o.slug, text);
    for (const w of new Set(wordOf(text))) docFreq.set(w, (docFreq.get(w) ?? 0) + 1);
  }

  const N = Math.max(1, others.length);
  const idf = new Map<string, number>();
  for (const [w, tf] of ownCounts) {
    void tf;
    idf.set(w, Math.log(1 + N / (docFreq.get(w) ?? 1)));
  }
  // Distinctive terms first, for display. But matching requires only weight:
  // one very distinctive shared word ("eviction", "p99") is a stronger signal
  // than three generic ones, and demanding two shared *distinctive* terms is
  // nearly contradictory — distinctive means rare elsewhere.
  const ranked = [...ownCounts.entries()]
    .map(([w, tf]) => ({ w, weight: tf * (idf.get(w) ?? 0) }))
    .sort((a, b) => b.weight - a.weight);
  const display = ranked.slice(0, 8).map((s) => s.w);
  const weights = new Map(ranked.map((s) => [s.w, s.weight]));
  if (display.length < 2) return [];

  const outIds = await database
    .select({ id: postLinks.toPostId })
    .from(postLinks)
    .where(eq(postLinks.fromPostId, postId));
  const inIds = await database
    .select({ id: postLinks.fromPostId })
    .from(postLinks)
    .where(eq(postLinks.toPostId, postId));
  const linkedSlugs = new Set<string>();
  for (const r of [...outIds, ...inIds]) {
    const [p] = await database.select({ slug: posts.slug }).from(posts).where(eq(posts.id, r.id)).limit(1);
    if (p) linkedSlugs.add(p.slug);
  }

  const [self] = await database.select({ slug: posts.slug }).from(posts).where(eq(posts.id, postId)).limit(1);
  const out: LinkSuggestion[] = [];
  for (const o of others) {
    if (o.slug === self?.slug || linkedSlugs.has(o.slug)) continue;
    const words = wordOf(bodies.get(o.slug) ?? '');
    const shared = [...new Set(words.filter((w) => weights.has(w)))];
    const score = shared.reduce((n, w) => n + (weights.get(w) ?? 0), 0);
    // Roughly two average terms, or one very distinctive one. Below this the
    // "suggestions" are coincidences wearing a trench coat.
    if (score < 2.0) continue;
    shared.sort((a, b) => (weights.get(b) ?? 0) - (weights.get(a) ?? 0));
    const [meta] = await database
      .select({ id: posts.id, title: posts.title, dek: posts.dek })
      .from(posts)
      .where(eq(posts.slug, o.slug))
      .limit(1);
    if (!meta) continue;
    out.push({ postId: meta.id, slug: o.slug, title: meta.title, dek: meta.dek, shared: shared.slice(0, 4), score });
    if (out.length >= limit * 2) break;
  }
  out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return out.slice(0, limit);
}

export async function getLineage(postId: string) {
  const database = await readyDb();
  const ancestors: Array<{ depth: number; slug: string; title: string; dek: string }> = [];

  let cursor: string | null = postId;
  let depth = 0;
  while (cursor && depth < 12) {
    const parentRows = await database
      .select({ forkedFromId: posts.forkedFromId })
      .from(posts)
      .where(eq(posts.id, cursor))
      .limit(1);
    const parentId: string | null = parentRows[0]?.forkedFromId ?? null;
    if (!parentId) break;
    const parentRows2 = await database
      .select({ slug: posts.slug, title: posts.title, dek: posts.dek })
      .from(posts)
      .where(eq(posts.id, parentId))
      .limit(1);
    const parent = parentRows2[0];
    if (!parent) break;
    depth += 1;
    ancestors.unshift({ depth, slug: parent.slug, title: parent.title, dek: parent.dek });
    cursor = parentId;
  }

  const descendants = await database
    .select({ slug: posts.slug, title: posts.title, dek: posts.dek, id: posts.id })
    .from(posts)
    .where(eq(posts.forkedFromId, postId))
    .limit(20);

  return { ancestors, descendants };
}

/* -------------------------------------------------------------------------- */
/* Derived reading metrics                                                     */
/* -------------------------------------------------------------------------- */

export interface ReadingStats {
  blocks: Array<{ blockId: string; ordinal: number; reached: number; impressions: number }>;
  impressions: number;
  /** Cohort size. Below the suppression floor nothing is shown to writers. */
  cohort: number;
}

export async function getReadingStats(postId: string): Promise<ReadingStats> {
  const database = await readyDb();
  const rows = await database
    .select({
      blockId: blocks.blockId,
      ordinal: blocks.ordinal,
      reached: sql<number>`sum(case when ${readEvents.event} = 'reached' then 1 else 0 end)`,
      impressions: sql<number>`sum(case when ${readEvents.event} = 'impression' then 1 else 0 end)`,
    })
    .from(blocks)
    .leftJoin(
      readEvents,
      and(eq(readEvents.postId, postId), eq(readEvents.blockId, blocks.blockId)),
    )
    .where(
      and(
        eq(blocks.postId, postId),
        sql`${blocks.versionId} = (select current_version_id from ${posts} where id = ${postId})`,
      ),
    )
    .groupBy(blocks.blockId, blocks.ordinal)
    .orderBy(asc(blocks.ordinal));

  const [{ total }] = await database
    .select({ total: count() })
    .from(readEvents)
    .where(and(eq(readEvents.postId, postId), eq(readEvents.event, 'impression')));

  const [{ cohort }] = await database
    .select({ cohort: sql<number>`count(distinct ${readEvents.anonId})` })
    .from(readEvents)
    .where(eq(readEvents.postId, postId));

  return { blocks: rows, impressions: total ?? 0, cohort: cohort ?? 0 };
}
