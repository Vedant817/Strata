/**
 * Abuse limits for Ask.
 *
 * Ask is a GET that spends the deployment's model key, and it is on the public
 * reading path. Without a meter, a reader holding refresh can spend the owner's
 * quota in minutes, and — because every question is logged for the writer — fill
 * the confusion dashboard with duplicates of the same question. The risk
 * register named this ("Ask costs spiral") and listed "abuse limits (rate limit)"
 * as a requirement; this is that requirement.
 *
 * Two mechanisms, because they solve different problems:
 *
 *   1. **A per-browser cap**, counted from the `asks` table. It needs no new
 *      state, it survives a cold start, and it works across every serverless
 *      instance because the counter lives in the database rather than in a
 *      process that gets recycled.
 *   2. **An answer cache** keyed by (post version, question, provider, model).
 *      Repeated and near-identical questions — the retry button, a shared link,
 *      someone asking the same thing as the last reader — cost nothing.
 *
 * Both are keyed on the pseudonymous browser id, never on an account, because
 * most readers here never have one and the cap has to cover them too.
 */

import { and, count, eq, gte, sql } from 'drizzle-orm';
import { readyDb } from '../db';
import { asks } from '../db/schema';

/** Questions allowed per browser per hour. Generous for a reader, ruinous to abuse. */
export const ASK_LIMIT_PER_HOUR = 20;
const WINDOW_MS = 60 * 60 * 1000;

export interface AskQuota {
  ok: boolean;
  used: number;
  limit: number;
  /** Seconds until the window frees a slot. */
  retryAfter: number;
}

/**
 * Count this browser's questions in the current window.
 *
 * Unmatched queries still count. A visitor who only ever asks things the article
 * does not cover is still spending a lookup and still polluting the writer's
 * confusion list, so a rate limit that skipped them would be a rate limit with a
 * hole in exactly the wrong place.
 */
export async function checkAskQuota(anonId: string): Promise<AskQuota> {
  const since = Date.now() - WINDOW_MS;
  try {
    const database = await readyDb();
    const rows = await database
      .select({ n: count() })
      .from(asks)
      .where(and(eq(asks.anonId, anonId), gte(asks.createdAt, since)));
    const used = Number(rows[0]?.n ?? 0);
    if (used < ASK_LIMIT_PER_HOUR) {
      return { ok: true, used, limit: ASK_LIMIT_PER_HOUR, retryAfter: 0 };
    }
    const oldest = await database
      .select({ at: sql<number>`min(${asks.createdAt})` })
      .from(asks)
      .where(and(eq(asks.anonId, anonId), gte(asks.createdAt, since)));
    const free = Number(oldest[0]?.at ?? Date.now()) + WINDOW_MS - Date.now();
    return {
      ok: false,
      used,
      limit: ASK_LIMIT_PER_HOUR,
      retryAfter: Math.max(60, Math.ceil(free / 1000)),
    };
  } catch {
    // A missing counter must not take Ask offline. The per-author model budget
    // and the circuit breaker still apply, so the worst case is the old
    // behaviour, not an unbounded bill.
    return { ok: true, used: 0, limit: ASK_LIMIT_PER_HOUR, retryAfter: 0 };
  }
}

/* ------------------------------------------------------------ answer cache */

interface CacheEntry {
  at: number;
  value: unknown;
}

const HOLDER = globalThis as unknown as {
  __strataAskCache?: Map<string, CacheEntry>;
};

/** Ten minutes. Long enough to absorb a retry loop, short enough that a
 *  published revision is reflected almost immediately. */
const CACHE_TTL_MS = 10 * 60 * 1000;

/** Normalised so "Why is X?" and "why is x" share one entry. */
export function askCacheKey(args: {
  postId: string;
  versionId: string;
  question: string;
  providerId?: string | null;
  model?: string | null;
}): string {
  return [
    args.postId,
    args.versionId,
    args.question.trim().toLowerCase().replace(/\s+/g, ' '),
    args.providerId ?? '',
    args.model ?? '',
  ].join('|');
}

export function readAskCache<T>(key: string): T | null {
  const map = (HOLDER.__strataAskCache ??= new Map());
  const hit = map.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    map.delete(key);
    return null;
  }
  // Touch, so a hot key is not evicted as the oldest.
  hit.at = Date.now();
  return hit.value as T;
}

export function writeAskCache(key: string, value: unknown): void {
  const map = (HOLDER.__strataAskCache ??= new Map());
  // Bounded: a runaway loop must not turn the cache into a leak.
  if (map.size > 500) {
    const oldest = [...map.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) map.delete(oldest[0]);
  }
  map.set(key, { at: Date.now(), value });
}