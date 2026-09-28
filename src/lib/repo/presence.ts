import { and, eq, gt, sql } from 'drizzle-orm';
import { readyDb } from '../db';
import { presenceHeartbeats } from '../db/schema';

/**
 * Live presence without Realtime.
 *
 * §5's "3 people are reading this right now" assumed Supabase Realtime, which
 * this stack traded away with the SQLite decision. The replacement is
 * deliberately the dumbest thing that works: the open page heartbeats every
 * 30 seconds, the count endpoint counts heartbeats fresher than 90 seconds,
 * and a periodic delete prunes the rest. No profiles, no followers, no DMs,
 * no per-reader anything — the count is the whole feature, and a count can
 * never identify anyone. Ambient, not social.
 */

export const PRESENCE_TTL_MS = 90_000;

export async function heartbeat(anonKey: string, postId: string): Promise<void> {
  const database = await readyDb();
  await database
    .insert(presenceHeartbeats)
    .values({ anonKey, postId, lastSeen: Date.now() })
    .onConflictDoUpdate({
      target: [presenceHeartbeats.anonKey, presenceHeartbeats.postId],
      set: { lastSeen: Date.now() },
    });
}

export async function readersNow(postId: string): Promise<number> {
  const database = await readyDb();
  const [row] = await database
    .select({ n: sql<number>`count(*)` })
    .from(presenceHeartbeats)
    .where(
      and(
        eq(presenceHeartbeats.postId, postId),
        gt(presenceHeartbeats.lastSeen, Date.now() - PRESENCE_TTL_MS),
      ),
    );
  return Number(row?.n ?? 0);
}

export async function prunePresence(): Promise<number> {
  const database = await readyDb();
  // Drizzle's delete-returning is uneven across drivers; count first so the
  // caller can log something true.
  const [row] = await database
    .select({ n: sql<number>`count(*)` })
    .from(presenceHeartbeats)
    .where(sql`${presenceHeartbeats.lastSeen} <= ${Date.now() - PRESENCE_TTL_MS}`);
  await database
    .delete(presenceHeartbeats)
    .where(sql`${presenceHeartbeats.lastSeen} <= ${Date.now() - PRESENCE_TTL_MS}`);
  return Number(row?.n ?? 0);
}
