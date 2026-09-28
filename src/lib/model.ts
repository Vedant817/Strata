import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { readyDb } from './db';
import { askModelBudgets } from './db/schema';
import type { AskPassage } from './repo/ask';

/**
 * Model-backed Ask — grounded, capped, and circuit-broken.
 *
 * Three rules, in order of importance:
 *
 * 1. The model only ever sees the retrieved passages. It is not asked to know
 *    anything; it is asked to summarize quotes from *this post*. That is what
 *    makes the model version no less honest than the extractive one — the
 *    grounding is structural, not a prompt request.
 * 2. Cost is capped per author per day, in the database. A public reader-facing
 *    feature that calls a paid model is a money risk dressed as a feature.
 * 3. A failing upstream trips a breaker, so one bad afternoon stops costing
 *    money on every request instead of on the tenth.
 *
 * Every failure path returns `null`, and the caller falls back to the
 * extractive answer. The model is an upgrade, never a dependency: a reader
 * asking a question at 3am gets quotes either way.
 */

function env(name: string): string | undefined {
  const existing = process.env[name];
  if (existing) return existing;
  try {
    const file = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    for (const line of file.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const at = trimmed.indexOf('=');
      if (at < 0) continue;
      if (trimmed.slice(0, at).trim() !== name) continue;
      return trimmed.slice(at + 1).trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    // No .env is normal in production, not an error.
  }
  return undefined;
}

const MODEL = () => env('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-5';
const MAX_DAILY = () => Number(env('ASK_DAILY_CAP') ?? 25);
const BREAKER_AFTER = () => Number(env('ASK_BREAKER_AFTER') ?? 3);
const BREAKER_MS = () => Number(env('ASK_BREAKER_MS') ?? 60_000);
const TIMEOUT_MS = () => Number(env('ASK_TIMEOUT_MS') ?? 8_000);

export function isModelConfigured(): boolean {
  return Boolean(env('ANTHROPIC_API_KEY'));
}

function dayBucket(): number {
  return Math.floor(Date.now() / 86_400_000) * 86_400_000;
}

/** Returns null when allowed, or the reason it is not. */
async function checkBudget(postId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!isModelConfigured()) return { ok: false, reason: 'No model key configured.' };
  const database = await readyDb();
  const [row] = await database.select().from(askModelBudgets).where(eq(askModelBudgets.postId, postId)).limit(1);

  if (row?.openUntil && row.openUntil > Date.now()) {
    return { ok: false, reason: 'Temporarily unavailable after repeated failures.' };
  }
  const calls = row && row.windowStart === dayBucket() ? row.calls : 0;
  if (calls >= MAX_DAILY()) {
    return { ok: false, reason: 'Daily cap reached; answering with quotes instead.' };
  }
  return { ok: true };
}

async function recordCall(postId: string, ok: boolean): Promise<void> {
  const database = await readyDb();
  const bucket = dayBucket();
  const [row] = await database.select().from(askModelBudgets).where(eq(askModelBudgets.postId, postId)).limit(1);

  // One rule for both branches, so the breaker can't open early on the first
  // call just because the row is new: it opens only once failures *reach* the
  // threshold, and only closes on a success.
  const previous = row?.consecutiveFailures ?? 0;
  const failures = ok ? 0 : previous + 1;
  const openUntil = ok ? null : failures >= BREAKER_AFTER() ? Date.now() + BREAKER_MS() : row?.openUntil ?? null;
  const calls = row && row.windowStart === bucket ? row.calls + 1 : 1;

  if (!row) {
    await database.insert(askModelBudgets).values({
      postId,
      windowStart: bucket,
      calls,
      consecutiveFailures: failures,
      openUntil,
      updatedAt: Date.now(),
    });
    return;
  }
  await database
    .update(askModelBudgets)
    .set({ windowStart: bucket, calls, consecutiveFailures: failures, openUntil, updatedAt: Date.now() })
    .where(eq(askModelBudgets.postId, postId));
}

export interface ModelAnswer {
  text: string;
  cited: boolean;
  latencyMs: number;
}

/**
 * Ask the model to answer *from the passages*. Returns null for every
 * failure — no key, cap hit, breaker open, timeout, bad status, unparseable
 * body — and the caller falls back to extractive quotes.
 */
export async function answerWithModel(
  postId: string,
  question: string,
  passages: AskPassage[],
): Promise<ModelAnswer | null> {
  if (passages.length === 0) return null;
  const budget = await checkBudget(postId);
  if (!budget.ok) return null;

  const key = env('ANTHROPIC_API_KEY');
  if (!key) return null;

  const started = Date.now();
  const numbered = passages
    .map((p, i) => `[${i + 1}] ${p.quote.replace(/<\/?mark>/g, '')}`)
    .join('\n\n');

  // Grounding is the whole design, so it is stated as a hard constraint and
  // repeated as an output rule. "If the passages don't answer it, say so" is
  // the instruction that keeps this honest — the model abstains rather than
  // reaching for a neighbor post or its own training data.
  const system = [
    'You answer questions about a single article using ONLY the quoted passages provided.',
    'Never use outside knowledge. Never speculate. If the passages do not answer the question,',
    'reply with exactly: NOT COVERED',
    'Cite the passage number(s) you used like [1] or [2]. Keep it under 80 words. No preamble.',
  ].join(' ');

  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS()),
      body: JSON.stringify({
        model: MODEL(),
        max_tokens: 300,
        system,
        messages: [{ role: 'user', content: `Passages:\n\n${numbered}\n\nQuestion: ${question}` }],
      }),
    });
  } catch {
    await recordCall(postId, false);
    return null; // Timeout or network failure — breaker counts it.
  }

  if (!res.ok) {
    await recordCall(postId, false);
    return null;
  }

  const body = (await res.json().catch(() => null)) as
    | { content?: { type?: string; text?: string }[] }
    | null;
  const text = body?.content?.find((c) => c.type === 'text')?.text?.trim() ?? '';
  await recordCall(postId, true);

  if (!text || text === 'NOT COVERED') return null;
  return {
    text,
    cited: /\[\d+\]/.test(text),
    latencyMs: Date.now() - started,
  };
}
