import { and, desc, eq, ne } from 'drizzle-orm';
import { readyDb } from '../db/index';
import { sessions, sessionsMeta } from '../db/schema';
import { SESSION_COOKIE } from './auth';

/**
 * Device inventory.
 *
 * This exists because a `sessions` row is a bearer token: whoever holds the
 * cookie string is the account. Until this shipped there was no way to see or
 * end one — signing out of one browser left every other browser signed in
 * forever. A token you cannot revoke is a token that outlives the compromise
 * that made it matter.
 */

export interface DeviceSession {
  token: string;
  userAgent: string | null;
  createdAt: number | null;
  lastSeenAt: number | null;
  current: boolean;
  /** Best-effort, for a human recognising a device in a list. */
  label: string;
}

export async function listDeviceSessions(
  userId: string,
  currentToken: string | null,
): Promise<DeviceSession[]> {
  const database = await readyDb();
  const rows = await database
    .select({
      token: sessions.token,
      createdAt: sessions.createdAt,
      userAgent: sessionsMeta.userAgent,
      lastSeenAt: sessionsMeta.lastSeenAt,
    })
    .from(sessions)
    .leftJoin(sessionsMeta, eq(sessionsMeta.token, sessions.token))
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.createdAt));

  return rows.map((r) => ({
    ...r,
    current: r.token === currentToken,
    label: describe(r.userAgent),
  }));
}

/**
 * Record a sighting, at most once per token per interval.
 *
 * Called from the identity path, so an unconditional write would mean a DB
 * upsert on *every* page view from a signed-in reader. The throttle is a plain
 * in-memory map — acceptable here precisely because it carries no request
 * identity: losing it on a cold start just costs one extra write.
 */
const TOUCH_INTERVAL_MS = 10 * 60 * 1000;
const touchedAt = new Map<string, number>();
const TOUCH_CACHE_MAX = 5000;

export async function touchSession(token: string, userAgent: string | null): Promise<void> {
  const now = Date.now();
  const last = touchedAt.get(token) ?? 0;
  if (now - last < TOUCH_INTERVAL_MS) return;
  if (touchedAt.size > TOUCH_CACHE_MAX) touchedAt.clear();
  touchedAt.set(token, now);

  const database = await readyDb();
  // Upsert, so a device's first request records the agent and later ones only
  // move lastSeenAt.
  await database
    .insert(sessionsMeta)
    .values({ token, userAgent, createdAt: now, lastSeenAt: now })
    .onConflictDoUpdate({
      target: sessionsMeta.token,
      set: { lastSeenAt: now, ...(userAgent ? { userAgent } : {}) },
    });
}

/**
 * End one session.
 *
 * Scoped to the caller's own sessions by construction — the delete is keyed on
 * `user_id` as well as the token, so passing someone else's token removes nothing
 * rather than removing their access.
 */
export async function revokeSession(
  userId: string,
  token: string,
): Promise<{ ok: boolean; error?: string }> {
  const database = await readyDb();
  const removed = await database
    .delete(sessions)
    .where(and(eq(sessions.token, token), eq(sessions.userId, userId)))
    .returning({ token: sessions.token });
  if (!removed.length) return { ok: false, error: 'That session is already gone.' };
  await database.delete(sessionsMeta).where(eq(sessionsMeta.token, token));
  return { ok: true };
}

/**
 * End every session except the caller's.
 *
 * `keepToken` is a parameter rather than read from module state on purpose:
 * a module-level "current token" is shared across concurrent requests, so two
 * people loading /settings at the same instant would revoke each other.
 */
export async function revokeAllOtherSessions(
  userId: string,
  keepToken: string,
): Promise<number> {
  const database = await readyDb();
  const others = await database
    .select({ token: sessions.token })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), ne(sessions.token, keepToken)));

  for (const row of others) {
    await database.delete(sessionsMeta).where(eq(sessionsMeta.token, row.token));
  }
  await database
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), ne(sessions.token, keepToken)));
  return others.length;
}

export function cookieName(): string {
  return SESSION_COOKIE;
}

/**
 * A readable name for a session.
 *
 * Best-effort and never authoritative — it exists so a person can recognise
 * "the phone" versus "the laptop". Unknown agents say so rather than guessing,
 * because a wrong label on a security screen is worse than an honest blank.
 */
function describe(agent: string | null): string {
  if (!agent) return 'Unknown device';
  const u = agent.toLowerCase();
  const browser = /edg\//.test(u)
    ? 'Edge'
    : /opr\/|opera/.test(u)
      ? 'Opera'
      : /chrome\//.test(u)
        ? 'Chrome'
        : /firefox\//.test(u)
          ? 'Firefox'
          : /safari\//.test(u)
            ? 'Safari'
            : 'Browser';
  const os = /windows/.test(u)
    ? 'Windows'
    : /iphone|ipad|ipod/.test(u)
      ? 'iOS'
      : /android/.test(u)
        ? 'Android'
        : /mac os x/.test(u)
          ? 'macOS'
          : /linux/.test(u)
            ? 'Linux'
            : 'unknown OS';
  const kind = /mobile/.test(u) ? 'phone' : 'computer';
  return `${browser} on ${os} · ${kind}`;
}