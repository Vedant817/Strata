import { and, eq } from 'drizzle-orm';
import { readyDb } from '../db';
import { askModelBudgets } from '../db/schema';

/**
 * Cost boundary, now per (author, provider).
 *
 * The old table was keyed by post alone, because there was one provider. With
 * a dozen, "the cap" is ambiguous: a reader who has burned a Groq quota has
 * not spent anything at OpenAI, and a Groq outage should not silence a working
 * Anthropic key. So the key is (postId, providerId) and the breaker trips per
 * provider, for the same reason the caps are per provider.
 *
 * Enforcement is still in the database, not process memory: a restart cannot
 * reset it and two instances cannot each decide they are the first to spend.
 */

const HOLDER = globalThis as unknown as {
  __strataAskLimits?: Record<string, number | undefined>;
};

function limit(name: string, fallback: number): number {
  HOLDER.__strataAskLimits ??= {};
  const hit = HOLDER.__strataAskLimits[name];
  if (hit !== undefined) return hit;
  const raw = Number(process.env[name]);
  const value = Number.isFinite(raw) && raw > 0 ? raw : fallback;
  HOLDER.__strataAskLimits[name] = value;
  return value;
}

const dailyCap = () => limit('ASK_DAILY_CAP', 25);
const breakerAfter = () => limit('ASK_BREAKER_AFTER', 3);
const breakerMs = () => limit('ASK_BREAKER_MS', 60_000);

function dayBucket(): number {
  return Math.floor(Date.now() / 86_400_000) * 86_400_000;
}

export interface BudgetDecision {
  ok: boolean;
  reason?: string;
}

export async function checkBudget(
  postId: string,
  providerId: string,
): Promise<BudgetDecision> {
  const database = await readyDb();
  const [row] = await database
    .select()
    .from(askModelBudgets)
    .where(
      and(eq(askModelBudgets.postId, postId), eq(askModelBudgets.providerId, providerId)),
    )
    .limit(1);
  if (row?.openUntil && row.openUntil > Date.now()) {
    return { ok: false, reason: `${providerId} is temporarily unavailable after repeated failures.` };
  }
  const calls = row && row.windowStart === dayBucket() ? row.calls : 0;
  if (calls >= dailyCap()) {
    return { ok: false, reason: `Daily cap reached for ${providerId}; answering with quotes instead.` };
  }
  return { ok: true };
}

export async function recordCall(
  postId: string,
  providerId: string,
  ok: boolean,
): Promise<void> {
  const database = await readyDb();
  const bucket = dayBucket();
  const [row] = await database
    .select()
    .from(askModelBudgets)
    .where(
      and(eq(askModelBudgets.postId, postId), eq(askModelBudgets.providerId, providerId)),
    )
    .limit(1);

  const previous = row?.consecutiveFailures ?? 0;
  const failures = ok ? 0 : previous + 1;
  const openUntil = ok
    ? null
    : failures >= breakerAfter()
      ? Date.now() + breakerMs()
      : (row?.openUntil ?? null);
  const calls = row && row.windowStart === bucket ? row.calls + 1 : 1;

  if (!row) {
    await database.insert(askModelBudgets).values({
      postId,
      providerId,
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
    .where(
      and(eq(askModelBudgets.postId, postId), eq(askModelBudgets.providerId, providerId)),
    );
}
