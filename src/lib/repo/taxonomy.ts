import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { readyDb } from '../db';
import {
  annotations,
  postLinks,
  posts,
  readingListItems,
  readingLists,
  series,
  topics,
  users,
} from '../db/schema';
import type { Post } from '../db/schema';

const versionCount = sql<number>`(select count(*) from post_versions where post_versions.post_id = ${posts.id})`;
const annotationTotal = sql<number>`(
  select count(*) from ${annotations}
  where ${annotations.postId} = ${posts.id}
    and ${annotations.status} = 'visible' and ${annotations.isPrivate} = 0
)`;
/**
 * Reading time, as a correlated subquery against the post's current version.
 *
 * Written as a subquery rather than a join so it can be dropped into any
 * select that has `posts` in scope. An earlier version joined `post_versions`
 * and read `post_versions.body` directly, which failed in the two queries that
 * did not need the join. `v` is the only table inside the subquery, so there is
 * nothing for the outer reference to be ambiguous with.
 */
const readingMinutes = sql<number>`(
  select max(1, round((length(v.body) / 4.6) / 220))
  from post_versions v
  where v.id = posts.current_version_id
)`;

const baseSelect = {
  id: posts.id,
  slug: posts.slug,
  title: posts.title,
  dek: posts.dek,
  status: posts.status,
  publishedAt: posts.publishedAt,
  updatedAt: posts.updatedAt,
  createdAt: posts.createdAt,
  lastReviewedAt: posts.lastReviewedAt,
  topicId: posts.topicId,
  authorId: posts.authorId,
  annotationTotal,
  versionCount,
  readingMinutes,
  authorHandle: users.handle,
  authorName: users.displayName,
  topicName: topics.name,
};

export type PostCard = Awaited<ReturnType<typeof listAll>>[number];

export async function listAll(options: { includeSeedlings?: boolean } = {}) {
  const database = await readyDb();
  const statuses = options.includeSeedlings
    ? (['seedling', 'budding', 'evergreen', 'archived'] as const)
    : (['seedling', 'budding', 'evergreen'] as const);
  return database
    .select(baseSelect)
    .from(posts)
    .innerJoin(users, eq(posts.authorId, users.id))
    .leftJoin(topics, eq(posts.topicId, topics.id))
    .where(and(inArray(posts.status, [...statuses]), eq(posts.visibility, 'public')))
    .orderBy(desc(posts.publishedAt));
}

export async function listTopics() {
  const database = await readyDb();
  const rows = await database
    .select({
      id: topics.id,
      slug: topics.slug,
      name: topics.name,
      blurb: topics.blurb,
      total: sql<number>`(
        select count(*) from posts
        where posts.topic_id = "topics"."id" and posts.visibility = 'public'
      )`,
    })
    .from(topics)
    .orderBy(asc(topics.name));
  return rows;
}

export async function listAuthors() {
  const database = await readyDb();
  const rows = await database
    .select({
      id: users.id,
      handle: users.handle,
      displayName: users.displayName,
      bio: users.bio,
      // Qualified by hand: Drizzle renders an interpolated column as a bare
      // quoted name ("id"), which is ambiguous inside a subquery that also has
      // a `posts` in scope. SQLite refuses to guess.
      total: sql<number>`(
        select count(*) from posts
        where posts.author_id = "users"."id" and posts.visibility = 'public'
      )`,
      revisions: sql<number>`(
        select count(*) from post_versions pv
        join posts p on p.current_version_id = pv.id
        where p.author_id = "users"."id"
      )`,
    })
    .from(users)
    .where(sql`${users.role} in ('author', 'editor')`)
    .orderBy(asc(users.displayName));
  return rows;
}

export async function getAuthor(handle: string) {
  const database = await readyDb();
  const rows = await database
    .select()
    .from(users)
    .where(eq(users.handle, handle))
    .limit(1);
  return rows[0] ?? null;
}

export interface ListWithItems {
  id: string;
  slug: string;
  title: string;
  description: string;
  ownerHandle: string;
  items: Array<{
    ordinal: number;
    note: string;
    post: {
      slug: string;
      title: string;
      dek: string;
      status: Post['status'];
      publishedAt: number | null;
      readingMinutes: number;
      authorName: string;
    };
  }>;
}

export async function listReadingLists(): Promise<ListWithItems[]> {
  const database = await readyDb();
  const lists = await database
    .select({
      id: readingLists.id,
      slug: readingLists.slug,
      title: readingLists.title,
      description: readingLists.description,
      ownerHandle: users.handle,
    })
    .from(readingLists)
    .innerJoin(users, eq(readingLists.ownerId, users.id))
    .where(eq(readingLists.isPublic, true))
    .orderBy(readingLists.createdAt);

  const out: ListWithItems[] = [];
  for (const list of lists) {
    const rows = await database
      .select({
        ordinal: readingListItems.ordinal,
        note: readingListItems.note,
        slug: posts.slug,
        title: posts.title,
        dek: posts.dek,
        status: posts.status,
        publishedAt: posts.publishedAt,
        readingMinutes: readingMinutes,
        authorName: users.displayName,
      })
      .from(readingListItems)
      .innerJoin(posts, eq(readingListItems.postId, posts.id))
      .innerJoin(users, eq(posts.authorId, users.id))
      .where(eq(readingListItems.listId, list.id))
      .orderBy(readingListItems.ordinal);

    const items = rows.map((r) => ({
      ordinal: r.ordinal,
      note: r.note,
      post: {
        slug: r.slug,
        title: r.title,
        dek: r.dek,
        status: r.status,
        publishedAt: r.publishedAt,
        readingMinutes: Number(r.readingMinutes ?? 1),
        authorName: r.authorName,
      },
    }));
    out.push({ ...list, items });
  }
  return out;
}

export async function getReadingList(slug: string): Promise<ListWithItems | null> {
  const all = await listReadingLists();
  return all.find((l) => l.slug === slug) ?? null;
}

/**
 * The whole graph: every post as a node, every declared link as an edge.
 *
 * Modelled from the start even though nothing rendered it until Phase 5, because
 * retrofitting a graph onto a pile of posts is the expensive way round.
 */
export interface GraphNode {
  id: string;
  slug: string;
  title: string;
  status: Post['status'];
  authorHandle: string;
  authorName: string;
  publishedAt: number | null;
  versionCount: number;
  forks: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: 'cites' | 'extends' | 'contradicts' | 'fork_of' | 'mentions';
  /** Resolved for rendering; both ends are real post ids. */
  fromIndex: number;
  toIndex: number;
}

export async function getGraph(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const database = await readyDb();
  const postRows = await database
    .select({
      id: posts.id,
      slug: posts.slug,
      title: posts.title,
      status: posts.status,
      publishedAt: posts.publishedAt,
      authorHandle: users.handle,
      authorName: users.displayName,
      versionCount,
      forkedFromId: posts.forkedFromId,
    })
    .from(posts)
    .innerJoin(users, eq(posts.authorId, users.id))
    .where(eq(posts.visibility, 'public'))
    .orderBy(asc(posts.publishedAt));

  const linkRows = await database.select().from(postLinks);

  // Index by publication order, which is what the timeline axis means.
  const nodes: GraphNode[] = postRows.map((p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    status: p.status,
    authorHandle: p.authorHandle,
    authorName: p.authorName,
    publishedAt: p.publishedAt,
    versionCount: Number(p.versionCount ?? 1),
    forks: p.forkedFromId ? 1 : 0,
  }));

  const index = new Map(nodes.map((n, i) => [n.id, i]));

  const edges: GraphEdge[] = [];
  for (const l of linkRows) {
    const from = index.get(l.fromPostId);
    const to = index.get(l.toPostId);
    if (from === undefined || to === undefined) continue;
    edges.push({ from: l.fromPostId, to: l.toPostId, type: l.type, fromIndex: from, toIndex: to });
  }

  // Fork lineage counts too — a fork is an edge with credit attached.
  for (const n of nodes) {
    const parent = postRows.find((p) => p.id === n.id)?.forkedFromId;
    if (!parent) continue;
    const to = index.get(parent);
    if (to === undefined) continue;
    edges.push({ from: n.id, to: parent, type: 'fork_of', fromIndex: index.get(n.id)!, toIndex: to });
  }

  return { nodes, edges };
}

export async function getSeries() {
  const database = await readyDb();
  return database.select().from(series);
}

/** Status counts, for the front page. */
export async function getStatusCounts() {
  const database = await readyDb();
  const rows = await database
    .select({ status: posts.status, n: count() })
    .from(posts)
    .where(eq(posts.visibility, 'public'))
    .groupBy(posts.status);
  const out: Record<string, number> = { seedling: 0, budding: 0, evergreen: 0, archived: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}

/**
 * The thesis test. Share of a post's reads arriving at least 12 months after
 * publication. A conventional blog's post half-life is close to zero; if ours
 * is not materially better, the thesis is wrong (PLAN.md §10.8).
 */
export async function getHalfLife(postId: string, months = 12) {
  const database = await readyDb();
  const post = await database
    .select({ publishedAt: posts.publishedAt })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);
  const publishedAt = post[0]?.publishedAt;
  if (!publishedAt) return { total: 0, late: 0, share: 0 };

  const cutoff = publishedAt + months * 30 * 86_400_000;
  const rows = await database
    .select({
      total: sql<number>`count(*)`,
      late: sql<number>`sum(case when created_at >= ${cutoff} then 1 else 0 end)`,
    })
    .from(sql`read_events`)
    .where(eq(sql`read_events.post_id`, postId));
  const total = Number(rows[0]?.total ?? 0);
  const late = Number(rows[0]?.late ?? 0);
  return { total, late, share: total === 0 ? 0 : late / total };
}
