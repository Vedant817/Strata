import { sql } from 'drizzle-orm';
import { readyDb } from '../db';
import { asks } from '../db/schema';
import { nanoid } from '../ids';
import { answerFromAnyModel } from '../ai/ask';

export interface AskPassage {
  blockId: string;
  /** The matched span, with `<mark>` around the query terms. */
  quote: string;
}

export interface AskResult {
  question: string;
  matched: boolean;
  passages: AskPassage[];
  /** Milliseconds the retrieval took. Recorded, because cost caps start with
   *  knowing the cost of the cheap half before any model is attached. */
  latencyMs: number;
  /** The model's grounded prose, when one was available and affordable.
   *  Always paired with the same `passages` — the model summarizes, it does
   *  not source. Null means the extractive quotes below are the answer. */
  answer: string | null;
  /** Which model produced it, e.g. "openrouter / llama-3.3-70b:free". Shown
   *  so a reader knows what summarized their post, and which quota paid. */
  modelLabel: string | null;
  mode: 'extractive' | 'model';
}

/**
 * Ask this article — extractive, grounded, offline.
 *
 * There is no model here, and that is the point for v1: the answer is always
 * quotes from *this* post, so it cannot hallucinate, cannot import outside
 * knowledge, and costs nothing to run. A question with no match gets "this
 * isn't covered in the article" rather than an invented answer — and that
 * refusal is logged, because the questions readers had to ask are the
 * writer's to-do list (§4.5: asking improves the article for everyone).
 *
 * The retrieval is block-scoped FTS over this post only. A post-level index
 * would let a neighboring post's vocabulary answer for this one; filtering by
 * `post_id` inside the query makes that structurally impossible. When a model
 * arrives it answers *from these passages*, behind the per-author caps — the
 * interface is the passages, not the prose.
 */

/** Words that carry no retrieval signal in an English question. */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'did', 'do', 'does', 'for', 'from',
  'had', 'has', 'have', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'me', 'my', 'of',
  'on', 'or', 'our', 'so', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they',
  'this', 'to', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'who', 'why', 'will',
  'with', 'would', 'you', 'your',
]);

function terms(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}]+/gu, '').trim())
    .filter((t) => t.length > 1 && !STOPWORDS.has(t.toLowerCase()))
    .slice(0, 12);
}

/**
 * Build FTS queries for a question, most precise first.
 *
 * This used to quote every whitespace-separated token and AND them, so "Why is
 * summing p99 latencies a mistake?" demanded the post contain `why`, `is`, `a`
 * and `mistake?` too. Nothing ever did, `matched` came back false, and the page
 * told the reader "This isn't covered in the article" — on an article whose
 * first sentence is exactly about summing p99s. The quotes were the feature and
 * the retrieval was quietly refusing them.
 *
 * So: content words only, tried as an AND first for precision, then as an OR so
 * a real question still finds its passage. The second query is a superset of the
 * first, so it can only ever widen recall, never reorder the top hits.
 */
function toFtsQueries(raw: string): string[] {
  const t = terms(raw);
  if (t.length === 0) return [];
  const quoted = t.map((x) => `"${x}"`);
  return [quoted.join(' '), quoted.join(' OR ')];
}

export async function askPost(
  postId: string,
  versionId: string,
  question: string,
  askedById: string | null,
  limit = 3,
  pref?: { providerId?: string | null; model?: string | null },
): Promise<AskResult> {
  const started = Date.now();
  const clean = question.trim().slice(0, 500);
  const queries = clean.length >= 2 ? toFtsQueries(clean) : [];

  let passages: AskPassage[] = [];
  if (queries.length > 0) {
    const database = await readyDb();
    for (const query of queries) {
      const rows = await database.all<{ block_id: string; quote: string }>(sql`
        SELECT block_id AS block_id,
          snippet(block_fts, 0, '<mark>', '</mark>', '…', 32) AS quote
        FROM block_fts
        WHERE post_id = ${postId} AND block_fts MATCH ${query}
        ORDER BY rank
        LIMIT ${limit}
      `);
      passages = rows.map((r) => ({ blockId: r.block_id, quote: r.quote }));
      if (passages.length > 0) break;
    }
  }

  const latencyMs = Date.now() - started;
  const matched = passages.length > 0;

  // The model is an upgrade, never a dependency. If there is no key, no
  // budget, an open breaker, a timeout, an HTTP error, or the model abstains
  // ("NOT COVERED"), we fall through to the extractive quotes — which are always
  // present when matched. Grounding stays structural: the model only ever saw
  // these passages, so its answer cannot outrun them.
  let answer: string | null = null;
  let modelLabel: string | null = null;
  let mode: 'extractive' | 'model' = 'extractive';
  {
    // Wrapped: even an unexpected throw (a DB hiccup in the budget table) must
    // not break answering — the extractive quotes are the floor, always.
    let model: Awaited<ReturnType<typeof answerFromAnyModel>> = null;
    try {
      model = await answerFromAnyModel(
        postId,
        askedById,
        passages.map((p) => p.quote),
        clean,
        pref,
      );
    } catch (err) {
      console.error('[strata] ask model path failed, falling back:', err);
    }
    if (model) {
      answer = model.text;
      modelLabel = model.label;
      mode = 'model';
    }
  }

  // The confusion signal. Unmatched questions are the interesting rows — they
  // are exactly what the writer should write next, so they are stored with the
  // same care as the answered ones.
  try {
    const database = await readyDb();
    await database.insert(asks).values({
      id: nanoid(),
      postId,
      versionId,
      blockId: null,
      question: clean,
      answer: answer ?? (matched ? passages.map((p) => p.quote.replace(/<\/?mark>/g, '')).join('\n\n') : ''),
      citations: JSON.stringify(passages.map((p) => ({ blockId: p.blockId }))),
      mode,
      latencyMs,
      askedById,
    });
  } catch (err) {
    // Logging must never break answering.
    console.error('[strata] ask log failed:', err);
  }

  return { question: clean, matched, passages, latencyMs, answer, modelLabel, mode };
}
