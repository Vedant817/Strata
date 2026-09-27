import { sql } from 'drizzle-orm';
import { readyDb } from '../db';
import { asks } from '../db/schema';
import { nanoid } from '../ids';

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

function toFtsQuery(raw: string): string | null {
  const terms = raw
    .split(/\s+/)
    .map((t) => t.replace(/["*]/g, '').trim())
    .filter((t) => t.length > 1)
    .slice(0, 10);
  if (terms.length === 0) return null;
  return terms.map((t) => `"${t}"`).join(' ');
}

export async function askPost(
  postId: string,
  versionId: string,
  question: string,
  askedById: string | null,
  limit = 3,
): Promise<AskResult> {
  const started = Date.now();
  const clean = question.trim().slice(0, 500);
  const query = clean.length >= 2 ? toFtsQuery(clean) : null;

  let passages: AskPassage[] = [];
  if (query) {
    const database = await readyDb();
    const rows = await database.all<{ block_id: string; quote: string }>(sql`
      SELECT block_id AS block_id,
        snippet(block_fts, 0, '<mark>', '</mark>', '…', 32) AS quote
      FROM block_fts
      WHERE post_id = ${postId} AND block_fts MATCH ${query}
      ORDER BY rank
      LIMIT ${limit}
    `);
    passages = rows.map((r) => ({ blockId: r.block_id, quote: r.quote }));
  }

  const latencyMs = Date.now() - started;
  const matched = passages.length > 0;

  // The confusion signal. Unmatched questions are the interesting rows — they
  // are exactly what the writer should write next, so they are stored with
  // the same care as the answered ones.
  try {
    const database = await readyDb();
    await database.insert(asks).values({
      id: nanoid(),
      postId,
      versionId,
      blockId: null,
      question: clean,
      answer: matched ? passages.map((p) => p.quote.replace(/<\/?mark>/g, '')).join('\n\n') : '',
      citations: JSON.stringify(passages.map((p) => ({ blockId: p.blockId }))),
      mode: 'extractive',
      latencyMs,
      askedById,
    });
  } catch (err) {
    // Logging must never break answering.
    console.error('[strata] ask log failed:', err);
  }

  return { question: clean, matched, passages, latencyMs };
}
