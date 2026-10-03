/**
 * The argument stress-tester (PLAN.md §8, v3).
 *
 * Ask answers a reader's question against an article. This is the adversarial
 * version: it takes the *article's own* strongest claim and tries to break it,
 * then reports only what it can ground in the text.
 *
 * Three properties make it honest rather than a demo, and all three are why the
 * machinery reuses Ask instead of being written fresh:
 *
 *  1. **Grounded or absent.** Every objection must quote a block of the post.
 *     There is no ungrounded mode. A model that cannot find a passage returns
 *     null and the caller says the argument survived, which is the correct
 *     output — an unfalsifiable claim is one this tool refuses to pretend to
 *     have refuted.
 *  2. **Extractive first, model as upgrade.** If no key is affordable or every
 *     model abstains, the reader still gets the claim paired with the passage it
 *     came from. The feature never depends on a provider being up, because the
 *     handoff's rule for this codebase is that a model is an upgrade and never a
 *     dependency.
 *  3. **It costs the reader's quota, metered by Ask's own limits.** Per-author
 *     budgets and the circuit breaker in `ai/ask.ts` and `ai/budget.ts` are
 *     already correct, and duplicating them would mean two cost caps, one of
 *     which nobody remembers to update.
 */

import { sql } from 'drizzle-orm';
import { readyDb } from '../db/index';
import { answerFromAnyModel, type AskPreference } from '../ai/ask';
import { askCacheKey, checkAskQuota, readAskCache, writeAskCache } from '../ai/ask-limit';

/** One claim the stress-tester pulled out of the post, and what it found. */
export interface StressClaim {
  /** The block the claim was drawn from, for citation. */
  blockId: string;
  /** The sentence under test, verbatim. */
  quote: string;
  /** The objection, or null when nothing could be grounded against it. */
  objection: string | null;
  /** True when the objection came from a model rather than the extractive pair. */
  fromModel: boolean;
  /** Which model answered, e.g. "openrouter / llama-3.3-70b:free". */
  modelLabel: string | null;
  /**
   * Why there is no objection. Kept separate from `objection === null` so the
   * UI can distinguish "the model declined" from "no key was configured", which
   * are very different things to tell a reader about their own article.
   */
  note: 'answered' | 'no-key' | 'abstained' | 'rate-limited';
}

export interface StressResult {
  claims: StressClaim[];
  mode: 'extractive' | 'model' | 'rate-limited';
  latencyMs: number;
  /** True when served from cache rather than re-run. */
  cached?: boolean;
  error?: string;
}

/**
 * Pick the sentences most worth attacking.
 *
 * Not a summary and not "the first N paragraphs". The candidates are sentences
 * that make a checkable claim — a number, a superlative, a causal "because",
 * an imperative — because those are the ones a reader can act on being wrong
 * about. A post with no such sentence yields no claims and the caller says the
 * argument was not falsifiable as written, which is itself useful feedback for a
 * writer.
 *
 * Deliberately lexical, not a model call: claim extraction decides *what* gets
 * attacked, and a model making that choice would be the least auditable part of
 * the pipeline.
 */
const CLAIM_MARKERS = [
  /\b\d+(\.\d+)?\s*(%|ms|s|kb|mb|gb|qps|rps|x)\b/i, // a measured quantity
  /\b(always|never|all|none|every|no one|nobody|must|cannot|can't|only)\b/i, // an absolute
  /\b(because|therefore|so that|which means|the reason)\b/i, // a causal claim
  /\b(should|must|need to|have to|ought to)\b/i, // a prescription
  /\b(faster|slower|cheaper|better|worse|safe|unsafe|proven|guaranteed)\b/i, // a comparison
];

function isCandidate(sentence: string): boolean {
  // Long enough to contain a claim with room to spare, short enough to quote.
  if (sentence.length < 40 || sentence.length > 400) return false;
  return CLAIM_MARKERS.some((re) => re.test(sentence));
}

/** Split into sentences without a dependency, and without splitting on "e.g.". */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z"'(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Find the block a sentence came from, so the citation points at something
 * clickable rather than at a fragment floating in the response.
 *
 * FTS rather than a scan: matching every block in the article on every candidate
 * would be O(claims x blocks) string comparisons, and the block table is the
 * largest thing in this database.
 */
async function locateBlock(
  postId: string,
  quote: string,
): Promise<{ blockId: string; passage: string } | null> {
  const database = await readyDb();
  // The first few content words are enough to identify a sentence in one post,
  // and quoting the whole sentence in a MATCH would be brittle: FTS tokenises on
  // its own terms and a long phrase becomes an AND of everything in it.
  const words = quote
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 6);
  if (words.length === 0) return null;

  const query = words.map((w) => `"${w}"`).join(' OR ');
  const rows = await database.all<{ block_id: string; passage: string }>(sql`
    SELECT block_id AS block_id,
      snippet(block_fts, 0, '', '', '…', 48) AS passage
    FROM block_fts
    WHERE post_id = ${postId} AND block_fts MATCH ${query}
    ORDER BY rank
    LIMIT 3
  `);
  if (rows.length === 0) return null;

  // Prefer the block that actually contains most of the quote, so the citation
  // is the sentence's real home rather than whichever block shared a word.
  const needle = quote.toLowerCase().replace(/\s+/g, ' ').slice(0, 60);
  let best = rows[0]!;
  let bestScore = -1;
  for (const row of rows) {
    const text = blockPlainText(row.block_id);
    const score = needle && text.toLowerCase().includes(needle.slice(0, 40)) ? 1 : 0;
    if (score > bestScore) {
      best = row;
      bestScore = score;
    }
  }
  return { blockId: best.block_id, passage: best.passage };
}

/* A tiny memo of block text, so `locateBlock` does not re-read every candidate
   from the database. Filled per run by `stressTest`. */
let blockCache: Map<string, string> | null = null;

function blockPlainText(blockId: string): string {
  return blockCache?.get(blockId) ?? '';
}

/**
 * Stress-test a post.
 *
 * `maxClaims` is small on purpose. Each claim that reaches a model is a real
 * request against someone's quota, and a list of twenty objections is not
 * more useful than a list of five — it is less, because nobody reads twenty.
 */
export async function stressTest(
  postId: string,
  versionId: string,
  askedById: string | null,
  opts: { maxClaims?: number; pref?: AskPreference; anonId?: string | null } = {},
): Promise<StressResult> {
  const started = Date.now();
  const maxClaims = Math.min(6, Math.max(1, opts.maxClaims ?? 4));

  const cacheKey = askCacheKey({
    postId,
    versionId,
    question: `__stress__:${maxClaims}`,
    ...opts.pref,
  });
  const memo = readAskCache<StressResult>(cacheKey);
  if (memo) return { ...memo, latencyMs: 0, cached: true };

  const quota = await checkAskQuota(opts.anonId || askedById || 'anonymous');
  if (!quota.ok) {
    return {
      claims: [],
      mode: 'rate-limited',
      latencyMs: 0,
      error: `You have asked ${quota.used} questions in the last hour, which is the limit. Try again in ${Math.ceil(quota.retryAfter / 60)} minute${quota.retryAfter > 120 ? 's' : ''}.`,
    };
  }

  const database = await readyDb();
  /* `block_id`, not `id`. The blocks table has a surrogate primary key and a
     stable author-facing `block_id`; the anchor in the rendered article is
     `block-${block_id}`, and `block_fts` indexes `block_id` too, so anything
     other than that would produce citations that point at nothing.

     Filtered to the current version, for the same reason empathy.ts filters:
     the blocks table keeps a row per version, so an unfiltered read returns the
     same sentence once per revision the post has had, and a claim rewritten out
     of the article would still be attacked. */
  const blocks = await database.all<{ block_id: string; text: string }>(sql`
    SELECT block_id AS block_id, text AS text
    FROM blocks
    WHERE post_id = ${postId}
      AND version_id = (select current_version_id from posts where id = ${postId})
    ORDER BY ordinal
  `);
  blockCache = new Map(blocks.map((b) => [b.block_id, b.text ?? '']));

  /* Candidates, in document order, so the output reads as a walk through the
     article rather than a ranking. De-duplicated by normalised text: a repeated
     claim is one claim, and attacking it twice wastes a request. */
  const seen = new Set<string>();
  const candidates: Array<{ blockId: string; quote: string }> = [];
  for (const block of blocks) {
    for (const sentence of sentences(block.text ?? '')) {
      if (!isCandidate(sentence)) continue;
      const key = sentence.toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ blockId: block.block_id, quote: sentence });
      if (candidates.length >= maxClaims * 3) break;
    }
    if (candidates.length >= maxClaims * 3) break;
  }

  if (candidates.length === 0) {
    const result: StressResult = {
      claims: [],
      mode: 'extractive',
      latencyMs: Date.now() - started,
      error:
        'No sentence in this post makes a claim specific enough to argue with — no numbers, absolutes or prescriptions. That is worth knowing on its own.',
    };
    blockCache = null;
    return result;
  }

  const claims: StressClaim[] = [];
  let anyModel = false;

  for (const candidate of candidates) {
    if (claims.length >= maxClaims) break;
    const located = await locateBlock(postId, candidate.quote);
    const citation = located?.passage ?? candidate.quote;

    /* One call per claim, and it may decline. Asking the chain once per claim
       rather than once for the whole article is deliberate: a single call with
       five claims gets one answer, usually about the easiest one, and the other
       four silently vanish. A per-claim call means an abstention is attributable
       to the claim it belongs to. */
    const answer = await answerFromAnyModel(
      postId,
      askedById,
      [citation],
      `Here is a claim from an article:\n\n"${candidate.quote}"\n\n` +
        `The article says, in the same passage: "${citation}"\n\n` +
        'State the strongest objection to that specific claim, in two sentences. ' +
        'If the passage does not support the claim, say so plainly. ' +
        'Answer only from this passage. If the passage contains nothing that ' +
        'undermines the claim, reply with exactly: NOT COVERED',
      opts.pref,
    ).catch(() => null);

    if (answer) {
      anyModel = true;
      claims.push({
        blockId: candidate.blockId,
        quote: candidate.quote,
        objection: answer.text,
        fromModel: true,
        modelLabel: answer.label,
        note: 'answered',
      });
      continue;
    }

    /* No objection could be grounded. The claim is reported anyway, paired with
       its passage, because "nothing here undermines this" is a result and not an
       absence — and it is only a result if the reader can see what was checked. */
    claims.push({
      blockId: candidate.blockId,
      quote: candidate.quote,
      objection: null,
      fromModel: false,
      modelLabel: null,
      note: 'abstained',
    });
  }

  blockCache = null;

  const result: StressResult = {
    claims,
    mode: anyModel ? 'model' : 'extractive',
    latencyMs: Date.now() - started,
  };
  if (anyModel) writeAskCache(cacheKey, result);
  return result;
}

/** Exported for the invariant check: is this string worth attacking? */
export const isStressCandidate = isCandidate;
export { sentences as splitSentences };