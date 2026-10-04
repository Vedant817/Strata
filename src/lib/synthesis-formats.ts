import { getLinks } from './repo/posts';
import { readyDb } from './db/index';
import { blocks, posts, postVersions, topics } from './db/schema';
import { countWords } from './blocks';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

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

export type FormatId =
  | 'digest'
  | 'path'
  | 'gaps'
  | 'revisions'
  | 'cards'
  | 'thread'
  | 'shape';

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

/* ------------------------------------------------------------------- cards */

interface CanonBlock {
  postSlug: string;
  type: string;
  layer: string;
  text: string;
  wordCount: number;
}

/**
 * The current version's blocks for every post, in document order.
 *
 * `currentVersionId`, not "the newest version": a draft in progress is not what
 * the writer published, and a synthesis built from a draft would change every
 * time they saved.
 */
async function loadBlocks(canon: CanonPost[]): Promise<CanonBlock[]> {
  if (canon.length === 0) return [];
  const database = await readyDb();

  const rows = await database
    .select({
      postSlug: posts.slug,
      type: blocks.type,
      layer: blocks.layer,
      text: blocks.text,
      wordCount: blocks.wordCount,
    })
    .from(blocks)
    .innerJoin(posts, eq(blocks.postId, posts.id))
    .innerJoin(postVersions, eq(blocks.versionId, postVersions.id))
    .where(
      and(
        inArray(posts.slug, canon.map((p) => p.slug)),
        sql`${posts.currentVersionId} = ${postVersions.id}`,
      ),
    )
    .orderBy(asc(posts.slug), asc(blocks.ordinal));

  return rows.map((r) => ({
    postSlug: r.postSlug,
    type: r.type,
    layer: r.layer,
    text: r.text,
    /* `wordCount` is written when a version is published. Anything that reached
       the database another way — an import, a row written before the column
       existed — carries 0, and a "where the work is" format that reports those
       posts as empty is worse than one that counts the text it is already
       holding. Counted from the text rather than trusted. */
    wordCount: Number(r.wordCount) || countWords(r.text),
  }));
}

/** Trim to a sentence or two. A card is a recall prompt, not an excerpt. */
function firstSentences(text: string, max = 240): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  return stop > 60 ? cut.slice(0, stop + 1) : `${cut.replace(/\s+\S*$/, '')}…`;
}

/**
 * Flashcards, built only from sentences the writer wrote.
 *
 * The temptation with a "generate flashcards" feature is a model. This format
 * refuses for the reason the module header gives: a published synthesis has to
 * be reproducible, and a card the writer did not write is a quiz about the tool's
 * reading of their work rather than about their work.
 *
 * So the sources are the block types that already *are* recall material, in the
 * writer's own words:
 *
 *   - `primer` — a glossary term and the definition given for it. The best card
 *     in any publication, and it was already written.
 *   - `tldr` — the post's own one-paragraph answer.
 *   - `heading` followed by prose — ask for the section, answer with its opening.
 *   - `quote` — the pull quote, as a thing worth recalling.
 *
 * Ordered by post then block, so the deck is identical between runs.
 */
function cards(canon: CanonPost[], all: CanonBlock[]): FormatResult {
  const lines: string[] = [];
  const caveats: string[] = [];
  const byPost = new Map<string, CanonBlock[]>();
  for (const b of all) {
    if (!byPost.has(b.postSlug)) byPost.set(b.postSlug, []);
    byPost.get(b.postSlug)!.push(b);
  }

  const emit = (p: CanonPost, q: string, a: string, source: string) => {
    if (!q.trim() || !a.trim()) return;
    lines.push(`## ${q}`, '', a, '', `— [${p.title}](/w/${p.slug}) · ${source}`, '');
  };

  for (const p of canon) {
    const post = byPost.get(p.slug) ?? [];
    for (let i = 0; i < post.length; i++) {
      const b = post[i]!;
      if (b.type === 'primer') {
        // `text` arrives as "term - context", which is what the renderer receives.
        const [term, ...rest] = b.text.split(' - ');
        if (term?.trim() && rest.length) {
          emit(p, `What is ${term.trim()}?`, firstSentences(rest.join(' - ')), 'primer');
        }
      }
      if (b.type === 'tldr') {
        emit(p, `${p.title} — in one paragraph`, firstSentences(b.text, 300), 'summary');
      }
      if (b.type === 'heading') {
        const next = post[i + 1];
        if (next && (next.type === 'paragraph' || next.type === 'list')) {
          emit(p, b.text.trim(), firstSentences(next.text), 'section');
        }
      }
      if (b.type === 'quote' && b.text.trim()) {
        emit(p, 'A line worth keeping', firstSentences(b.text, 200), 'quote');
      }
    }
  }

  const count = lines.filter((l) => l.startsWith('## ')).length;
  if (count === 0) {
    lines.push(
      'No cards could be built from the canon.',
      '',
      'Cards come from primer blocks, tldr summaries, headings and pull quotes.',
      'A post of nothing but paragraphs has nothing here worth recalling.',
    );
  } else {
    const missing = canon.filter((p) => !byPost.has(p.slug)).length;
    if (missing > 0) caveats.push(`${missing} posts had no blocks in their current version.`);
  }

  return {
    id: 'cards',
    label: 'Flashcards',
    blurb: 'A recall deck from your own sentences: glossary terms, summaries, section openings.',
    text: lines.join('\n').trim(),
    caveats,
  };
}

/* ------------------------------------------------------------------ thread */

/**
 * The thread: what the canon argues, in the order it argued it.
 *
 * Distinct from the reading path, which is the single longest chain through the
 * link graph and so one route through the work. This is every post in publication
 * order with what it leaned on, which makes the *sequence* legible: what came
 * first, which piece arrived to answer an earlier one, and where the line goes
 * quiet. The difference between a map of the roads and a walk.
 */
async function thread(canon: CanonPost[]): Promise<FormatResult> {
  const bySlug = new Map(canon.map((p) => [p.slug, p]));
  const ordered = [...canon].sort((a, b) => dateOf(a) - dateOf(b));
  const lines: string[] = [];
  const caveats: string[] = [];

  const citations = new Map<string, string[]>();
  for (const p of canon) {
    const out: string[] = [];
    for (const link of await getLinks(p.id)) {
      if (link.direction !== 'out') continue;
      if (link.type === 'contradicts' || link.type === 'fork_of') continue;
      if (!bySlug.has(link.slug) || link.slug === p.slug) continue;
      if (!out.includes(link.slug)) out.push(link.slug);
    }
    citations.set(p.slug, out);
  }

  let previous: number | null = null;
  let longestGap = 0;
  for (const p of ordered) {
    const when = dateOf(p);
    if (previous !== null) {
      const gap = Math.round((when - previous) / 86_400_000);
      if (gap > longestGap) longestGap = gap;
    }
    previous = when;

    lines.push(`### ${new Date(when).toISOString().slice(0, 10)} — [${p.title}](/w/${p.slug})`);
    if (p.dek) lines.push('', firstSentences(p.dek, 200));
    const cites = citations.get(p.slug) ?? [];
    if (cites.length === 1) {
      lines.push('', `Building on: [${bySlug.get(cites[0]!)!.title}](/w/${cites[0]})`);
    } else if (cites.length > 1) {
      lines.push('', `Building on: ${cites.map((s) => `[${bySlug.get(s)!.title}](/w/${s})`).join(', ')}`);
    } else {
      lines.push('', 'Leans on nothing else here — an opening move.');
    }
    lines.push('');
  }

  const openings = canon.filter((p) => (citations.get(p.slug) ?? []).length === 0).length;
  if (openings > 1) {
    caveats.push(
      `${openings} posts lean on nothing else in the canon. A thread with that many openings is a shelf, not an argument.`,
    );
  }
  if (longestGap > 90) caveats.push(`Longest silence between two posts: ${longestGap} days.`);

  lines.push(`${ordered.length} posts, ${openings} of them opening moves.`);

  return {
    id: 'thread',
    label: 'Thread outline',
    blurb: 'Every post in publication order with what it leaned on — the argument as a sequence.',
    text: lines.join('\n').trim(),
    caveats,
  };
}

/* ------------------------------------------------------------------- shape */

/** A text histogram. Plain text on purpose: this format gets pasted somewhere. */
function bar(value: number, max: number, width = 28): string {
  if (max <= 0 || value <= 0) return '·'.repeat(width);
  const filled = Math.max(1, Math.min(width, Math.round((value / max) * width)));
  return '█'.repeat(filled) + '·'.repeat(width - filled);
}

/**
 * Where the work actually is.
 *
 * The other formats list things. This one is a picture: words under each topic,
 * how much of it sits above or below the fold at Read depth, and how deeply the
 * canon has been revised. A writer with 40,000 words and 3% revised learns
 * something from that which no list of titles tells them.
 *
 * Bars are proportional to the largest row, so they compare with each other
 * rather than against an arbitrary scale.
 */
function shape(canon: CanonPost[], all: CanonBlock[]): FormatResult {
  const lines: string[] = [];
  const caveats: string[] = [];

  const wordsByPost = new Map<string, number>();
  const byLayer = new Map<string, number>();
  let totalWords = 0;
  for (const b of all) {
    totalWords += b.wordCount;
    wordsByPost.set(b.postSlug, (wordsByPost.get(b.postSlug) ?? 0) + b.wordCount);
    byLayer.set(b.layer, (byLayer.get(b.layer) ?? 0) + b.wordCount);
  }

  const byTopic = new Map<string, { words: number; posts: number }>();
  for (const p of canon) {
    const key = p.topicName ?? 'Unfiled';
    const row = byTopic.get(key) ?? { words: 0, posts: 0 };
    row.words += wordsByPost.get(p.slug) ?? 0;
    row.posts += 1;
    byTopic.set(key, row);
  }

  const topicRows = [...byTopic.entries()].sort((a, b) => b[1].words - a[1].words);
  const maxTopic = topicRows[0]?.[1].words ?? 0;

  lines.push('# Effort by topic', '');
  for (const [name, row] of topicRows) {
    lines.push(`${bar(row.words, maxTopic)} ${row.words.toLocaleString('en-GB')}w  ${name} (${row.posts})`);
  }
  lines.push('');

  lines.push('# Depth layers', '');
  const layerOrder = ['core', 'understand', 'master'];
  const layerNames: Record<string, string> = {
    core: 'core      (always shown)',
    understand: 'understand (skim depth)',
    master: 'master    (Read depth)',
  };
  const maxLayer = Math.max(...layerOrder.map((l) => byLayer.get(l) ?? 0), 1);
  for (const layer of layerOrder) {
    const words = byLayer.get(layer) ?? 0;
    const share = totalWords > 0 ? Math.round((words / totalWords) * 100) : 0;
    lines.push(`${bar(words, maxLayer)} ${String(share).padStart(3)}%  ${layerNames[layer]}`);
  }
  lines.push('');

  lines.push('# Revision depth', '');
  const revised = canon.filter((p) => p.versionCount > 1).length;
  const maxVersions = Math.max(...canon.map((p) => p.versionCount), 1);
  for (const p of [...canon].sort((a, b) => b.versionCount - a.versionCount).slice(0, 8)) {
    lines.push(`${bar(p.versionCount, maxVersions)} v${p.versionCount}  ${p.title}`);
  }
  lines.push('');

  const revisedPct = canon.length > 0 ? Math.round((revised / canon.length) * 100) : 0;
  lines.push(
    `${canon.length} posts, ${totalWords.toLocaleString('en-GB')} words, ${revised} revised (${revisedPct}%).`,
  );

  if (revised === 0 && canon.length > 0) {
    caveats.push('Nothing has been revised. A post never corrected is a draft that got published.');
  }
  if (all.length === 0) caveats.push('No blocks were found, so every bar is empty.');

  return {
    id: 'shape',
    label: 'Where the work is',
    blurb: 'Words by topic, by depth layer, and how much of it has been corrected.',
    text: lines.join('\n').trim(),
    caveats,
  };
}

export async function buildAllFormats(authorId: string): Promise<FormatResult[]> {
  const canon = await loadCanon();
  const all = await loadBlocks(canon);
  return [
    digest(canon),
    await readingPath(canon),
    await gaps(canon, authorId),
    revisions(canon),
    cards(canon, all),
    await thread(canon),
    shape(canon, all),
  ];
}

function dateOf(p: CanonPost): number {
  return (p.publishedAt ?? p.updatedAt ?? 0);
}

export type { SynthesisGroup };
