import { getLinks } from './repo/posts';
import { readyDb } from './db/index';
import { posts, topics } from './db/schema';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

/**
 * A published, non-archived piece. Synthesis is about what a reader can
 * actually reach, so a seedling has nothing to contribute to a digest.
 */
const PUBLISHED_STATUSES = ['budding', 'evergreen'] as const;

/** Version count, computed the same way the rest of the site does. */
const versionCount = sql<number>`(select count(*) from post_versions where post_versions.post_id = ${posts.id})`;
import { getOpenAsks } from './repo/studio';
import type { SynthesisGroup } from './repo/studio';

/**
 * Multi-format synthesis of the canon.
 *
 * Everything here is deterministic and derived from data the site already holds:
 * topics, link graph, revision history, and the questions readers actually asked
 * that the post did not answer. No model is called.
 *
 * That is a deliberate constraint, not a shortcut. Synthesis runs over the whole
 * canon, so a model-backed version would be the most expensive thing in the
 * product to trigger and would produce different words every time it ran — which
 * makes it useless as a *published* artefact. A synthesis a writer can cite and a
 * reader can compare against last quarter's has to be reproducible.
 *
 * If a writer wants prose, they already have the tool for it: Ask, per post,
 * with citations, budgeted. Synthesis answers the different question of "what
 * does the shape of everything I have written say", and that is a data problem.
 */

export interface CanonPost {
  id: string;
  slug: string;
  title: string;
  dek: string;
  topicName: string | null;
  publishedAt: number | null;
  updatedAt: number;
  versionCount: number;
}

export type FormatId = 'digest' | 'path' | 'gaps' | 'revisions';

export interface FormatResult {
  id: FormatId;
  label: string;
  /** One sentence on what this format is for, shown above the output. */
  blurb: string;
  /** Plain-text body, so it can be copied, mailed, or pasted anywhere. */
  text: string;
  /** What would make this format better. Empty when there is nothing to say. */
  caveats: string[];
}

/**
 * Pull the canon into one shape so the formats never re-query.
 *
 * Selected explicitly rather than reusing `listPosts`, whose projection is
 * tuned for listing UI and returns only six derived columns — its declared type
 * advertises more than the query actually selects, so reading `id` or `dek` off
 * it yields undefined at runtime while type-checking happily.
 */
export async function loadCanon(): Promise<CanonPost[]> {
  const database = await readyDb();
  const rows = await database
    .select({
      id: posts.id,
      slug: posts.slug,
      title: posts.title,
      dek: posts.dek,
      publishedAt: posts.publishedAt,
      updatedAt: posts.updatedAt,
      versionCount: versionCount,
      topicName: topics.name,
    })
    .from(posts)
    .leftJoin(topics, eq(posts.topicId, topics.id))
    .where(and(eq(posts.visibility, 'public'), inArray(posts.status, PUBLISHED_STATUSES)))
    .orderBy(desc(posts.publishedAt));

  return rows.map((p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    dek: p.dek,
    topicName: p.topicName ?? null,
    publishedAt: p.publishedAt,
    updatedAt: p.updatedAt,
    versionCount: p.versionCount,
  }));
}

/** Grouped by topic, newest first inside each group. */
function digest(canon: CanonPost[]): FormatResult {
  const byTopic = new Map<string, CanonPost[]>();
  for (const p of canon) {
    const key = p.topicName ?? 'Unfiled';
    if (!byTopic.has(key)) byTopic.set(key, []);
    byTopic.get(key)!.push(p);
  }

  const lines: string[] = [`# What is published`, ''];
  const caveats: string[] = [];

  if (canon.length === 0) {
    return {
      id: 'digest',
      label: 'Topic digest',
      blurb: 'Everything published, grouped by topic.',
      text: 'Nothing is published yet.',
      caveats: ['A digest of nothing is not a digest. Publish something first.'],
    };
  }

  for (const [topic, items] of [...byTopic].sort((a, b) => a[0].localeCompare(b[0]))) {
    items.sort((a, b) => dateOf(b) - dateOf(a));
    lines.push(`## ${topic} (${items.length})`, '');
    for (const p of items) {
      const when = p.publishedAt ? new Date(p.publishedAt).toISOString().slice(0, 10) : 'unpublished';
      lines.push(`- [${p.title}](/w/${p.slug}) — ${when}`);
    }
    lines.push('');
  }

  const biggest = [...byTopic].sort((a, b) => b[1].length - a[1].length)[0];
  const smallest = [...byTopic].sort((a, b) => a[1].length - b[1].length)[0];
  if (byTopic.size > 1 && smallest && smallest[1].length === 0) {
    caveats.push(`"${smallest[0]}" has no posts but still appears as a topic.`);
  }
  if (biggest && byTopic.size > 1) {
    const share = Math.round((biggest[1].length / canon.length) * 100);
    if (share >= 70) {
      caveats.push(
        `${share}% of the canon is "${biggest[0]}". A reader following one thread is getting almost the whole publication.`,
      );
    }
  }

  return {
    id: 'digest',
    label: 'Topic digest',
    blurb: 'Everything published, grouped by topic, newest first.',
    text: lines.join('\n'),
    caveats,
  };
}

/**
 * An ordered path for someone who has read nothing.
 *
 * Ordered by the link graph, not by date: a newcomer needs the piece that other
 * pieces depend on before the pieces that depend on it. Edges are followed from
 * `cites`/`extends`/`fork_of` and `contradicts` is treated as an aside rather
 * than a prerequisite, because a disagreement is only legible once you hold the
 * claim it disagrees with.
 */
async function readingPath(canon: CanonPost[]): Promise<FormatResult> {
  const bySlug = new Map(canon.map((p) => [p.slug, p]));
  /** slug of a post -> slugs it points a reader to */
  const dependents = new Map<string, string[]>();
  const caveats: string[] = [];

  for (const p of canon) {
    for (const link of await getLinks(p.id)) {
      /* `contradicts` is an aside, not a prerequisite: a disagreement is only
         legible once you hold the claim it disagrees with. Same for a fork,
         which stands alone by design. */
      if (link.direction !== 'out') continue;
      if (link.type === 'contradicts' || link.type === 'fork_of') continue;
      if (!bySlug.has(link.slug)) continue;
      if (!dependents.has(p.slug)) dependents.set(p.slug, []);
      const list = dependents.get(p.slug)!;
      if (!list.includes(link.slug)) list.push(link.slug);
    }
  }

  /* Kahn's algorithm over slugs. A piece with in-degree zero cites nothing
     anyone here reads, which is the correct opening move. Ties break oldest
     first, because a path that opens with the newest post is a feed, not a
     path. */
  const indegree = new Map<string, number>(canon.map((p) => [p.slug, 0]));
  for (const [, targets] of dependents) {
    for (const t of targets) indegree.set(t, (indegree.get(t) ?? 0) + 1);
  }

  const queue = canon
    .filter((p) => (indegree.get(p.slug) ?? 0) === 0)
    .sort((a, b) => dateOf(a) - dateOf(b));
  const ordered: CanonPost[] = [];
  const seen = new Set<string>();

  while (queue.length) {
    const next = queue.shift()!;
    if (seen.has(next.slug)) continue;
    seen.add(next.slug);
    ordered.push(next);
    for (const target of dependents.get(next.slug) ?? []) {
      indegree.set(target, (indegree.get(target) ?? 0) - 1);
      if ((indegree.get(target) ?? 0) === 0) {
        const post = bySlug.get(target);
        if (post && !seen.has(target)) queue.push(post);
      }
    }
  }

  // Anything left is in a cycle, which a reader cannot enter from outside.
  const orphans = canon.filter((p) => !seen.has(p.slug));
  if (orphans.length) {
    caveats.push(
      `${orphans.length} post${orphans.length === 1 ? '' : 's'} form a cycle in the link graph and cannot be ordered. Link a post that cites them to break it.`,
    );
  }

  const lines = ['# A reading path', ''];
  if (!ordered.length) {
    lines.push('No posts to order yet.');
  }
  ordered.forEach((p, i) => {
    lines.push(`${i + 1}. [${p.title}](/w/${p.slug})`);
    if (p.dek) lines.push(`   ${p.dek}`);
  });

  const unlinked = canon.filter((p) => !dependents.has(p.id) && !(dependents.get(p.id) ?? []).length);
  if (canon.length > 1 && unlinked.length === canon.length) {
    caveats.push('No posts cite each other, so this is just the canon in date order.');
  }

  return {
    id: 'path',
    label: 'Reading path',
    blurb: 'A newcomer order, from the link graph rather than the calendar.',
    text: lines.join('\n'),
    caveats,
  };
}

/**
 * What readers asked that the post did not answer.
 *
 * This is the format worth the most: it is the only one built from reader
 * behaviour rather than the writer's own arrangement of their work, so it is the
 * one that can tell the writer something they did not already know.
 */
async function gaps(canon: CanonPost[], authorId: string): Promise<FormatResult> {
  const rows: { slug: string; title: string; question: string }[] = [];
  for (const p of canon) {
    const open = await getOpenAsks(p.id, authorId);
    for (const a of open) rows.push({ slug: p.slug, title: p.title, question: a.question });
  }

  const lines = ['# What readers could not find', ''];
  const caveats: string[] = [];

  if (!rows.length) {
    lines.push('Nothing outstanding.');
    caveats.push(
      'This is only as good as Ask uptake. If readers are not asking questions, an empty list here means no signal, not no gaps.',
    );
  } else {
    /* Grouped by the words readers actually used, so twenty phrasings of one
       missing idea become one line rather than twenty. */
    const byQuestion = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = r.question.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
      if (!byQuestion.has(key)) byQuestion.set(key, []);
      byQuestion.get(key)!.push(r);
    }
    const sorted = [...byQuestion.values()].sort((a, b) => b.length - a.length);
    for (const group of sorted) {
      lines.push(`## ${group[0]!.question}`);
      for (const r of group) lines.push(`- [${r.title}](/w/${r.slug})`);
      if (group.length > 1) lines.push(`  ${group.length} readers asked this.`);
      lines.push('');
    }
  }

  return {
    id: 'gaps',
    label: 'Unanswered questions',
    blurb: 'What readers asked and the article did not cover.',
    text: lines.join('\n'),
    caveats,
  };
}

/** What changed, and how often. The thesis is revision, so this is the receipt. */
function revisions(canon: CanonPost[]): FormatResult {
  const revised = canon.filter((p) => p.versionCount > 1).sort((a, b) => b.versionCount - a.versionCount);
  const lines = ['# Revision log', ''];
  const caveats: string[] = [];

  if (!revised.length) {
    lines.push('Nothing has been revised.');
    caveats.push(
      'A publication that has never corrected itself is either very new or not reading its notes.',
    );
  } else {
    for (const p of revised) {
      const when = p.updatedAt ? new Date(p.updatedAt).toISOString().slice(0, 10) : 'unknown';
      lines.push(`- [${p.title}](/w/${p.slug}) — ${p.versionCount} versions, last ${when}`);
    }
    lines.push('');
    lines.push(`${revised.length} of ${canon.length} posts have been revised.`);
  }

  return {
    id: 'revisions',
    label: 'Revision log',
    blurb: 'Which pieces you have corrected, and how often.',
    text: lines.join('\n'),
    caveats,
  };
}

export async function buildAllFormats(authorId: string): Promise<FormatResult[]> {
  const canon = await loadCanon();
  return [
    digest(canon),
    await readingPath(canon),
    await gaps(canon, authorId),
    revisions(canon),
  ];
}

function dateOf(p: CanonPost): number {
  return (p.publishedAt ?? p.updatedAt ?? 0);
}

export type { SynthesisGroup };
