/**
 * Identity, anonymous-first.
 *
 * The reading loop never asks for an account. A random first-party id is enough
 * to read, to set your depth, and to write a margin note — the note is signed by
 * the browser, not by a login. Claiming a handle is a separate, deferred action
 * that upgrades existing anonymous notes to an attributed identity.
 *
 * There are no passwords. A handle is a name you attach to your notes, not a
 * credential, which means it cannot be phished and cannot be used to take over
 * an account.
 */

import { and, eq, gt, isNull, lt, or } from 'drizzle-orm';
import type { AstroCookies } from 'astro';
import { readyDb } from '../db';
import { handleClaims, sessions, users } from '../db/schema';
import { nanoid } from '../ids';
import { claimAnonNotes } from './annotations';
import { ANON_COOKIE } from '../prefs';

export const SESSION_COOKIE = 'strata_session';
const SESSION_DAYS = 30;
const CLAIM_MINUTES = 20;

export interface Identity {
  anonId: string;
  userId: string | null;
  handle: string | null;
  displayName: string | null;
  isAuthor: boolean;
}

const EMPTY: Omit<Identity, 'anonId'> = {
  userId: null,
  handle: null,
  displayName: null,
  isAuthor: false,
};

export async function getIdentity(cookies: AstroCookies): Promise<Identity> {
  const anonId = cookies.get(ANON_COOKIE)?.value ?? '';
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (!token) return { anonId, ...EMPTY };

  const database = await readyDb();
  const rows = await database
    .select({
      userId: users.id,
      handle: users.handle,
      displayName: users.displayName,
      role: users.role,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.token, token))
    .limit(1);

  const row = rows[0];
  if (!row) return { anonId, ...EMPTY };
  if (row.expiresAt < Date.now()) {
    await database.delete(sessions).where(eq(sessions.token, token));
    return { anonId, ...EMPTY };
  }
  return {
    anonId,
    userId: row.userId,
    handle: row.handle,
    displayName: row.displayName,
    isAuthor: row.role === 'author' || row.role === 'editor',
  };
}

export async function createSession(userId: string, cookies: AstroCookies): Promise<string> {
  const database = await readyDb();
  const token = nanoid() + nanoid();
  const expiresAt = Date.now() + SESSION_DAYS * 86_400_000;
  await database.insert(sessions).values({ token, userId, expiresAt, createdAt: Date.now() });
  cookies.set(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_DAYS * 86_400,
  });
  return token;
}

export async function destroySession(cookies: AstroCookies): Promise<void> {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    const database = await readyDb();
    await database.delete(sessions).where(eq(sessions.token, token));
  }
  cookies.delete(SESSION_COOKIE, { path: '/' });
}

/* -------------------------------------------------------------------------- */
/* Claiming a handle                                                           */
/* -------------------------------------------------------------------------- */

const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{2,23}$/i;

export type ClaimResult =
  | { ok: true; token: string; expiresAt: number; existing: boolean }
  | { ok: false; error: string };

export async function requestHandleClaim(input: {
  handle: string;
  email: string;
  anonId: string;
}): Promise<ClaimResult> {
  const database = await readyDb();
  const handle = input.handle.trim().toLowerCase();

  if (!HANDLE_RE.test(handle)) {
    return { ok: false, error: 'A handle is 3 to 24 characters: letters, numbers, dash or underscore.' };
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email.trim())) {
    return { ok: false, error: 'That does not look like an email address.' };
  }
  if (!input.anonId) {
    return { ok: false, error: 'No browser session to attach these notes to.' };
  }

  const taken = await database.select({ id: users.id }).from(users).where(eq(users.handle, handle)).limit(1);
  if (taken.length > 0) {
    return { ok: false, error: `The handle "${handle}" is already taken.` };
  }

  const token = `${nanoid()}${nanoid()}`;
  const expiresAt = Date.now() + CLAIM_MINUTES * 60_000;
  await database.insert(handleClaims).values({
    id: nanoid(),
    handle,
    email: input.email.trim().toLowerCase(),
    anonId: input.anonId,
    token,
    expiresAt,
    createdAt: Date.now(),
  });
  return { ok: true, token, expiresAt, existing: false };
}

export type RedeemResult =
  | { ok: true; handle: string; notesClaimed: number }
  | { ok: false; error: string };

export async function redeemHandleClaim(
  token: string,
  cookies: AstroCookies,
): Promise<RedeemResult> {
  const database = await readyDb();
  const rows = await database
    .select()
    .from(handleClaims)
    .where(and(eq(handleClaims.token, token), isNull(handleClaims.redeemedAt)))
    .limit(1);

  const claim = rows[0];
  if (!claim) return { ok: false, error: 'That link has already been used, or never existed.' };
  if (claim.expiresAt < Date.now()) {
    return { ok: false, error: 'That link has expired. Request a new one.' };
  }

  const now = Date.now();
  const existing = await database
    .select()
    .from(users)
    .where(eq(users.handle, claim.handle))
    .limit(1);

  let userId = existing[0]?.id;
  if (!userId) {
    userId = `u_${claim.handle}`;
    await database.insert(users).values({
      id: userId,
      email: claim.email,
      handle: claim.handle,
      displayName: claim.handle,
      bio: '',
      role: 'reader',
      createdAt: now,
    });
  }

  const notesClaimed = await claimAnonNotes(claim.anonId, userId);
  await database
    .update(handleClaims)
    .set({ redeemedAt: now })
    .where(eq(handleClaims.id, claim.id));

  await createSession(userId, cookies);
  return { ok: true, handle: claim.handle, notesClaimed };
}

/** A pending claim for this browser, if any — used to show a reminder. */
export async function getPendingClaim(anonId: string) {
  if (!anonId) return null;
  const database = await readyDb();
  const rows = await database
    .select()
    .from(handleClaims)
    .where(
      and(
        eq(handleClaims.anonId, anonId),
        isNull(handleClaims.redeemedAt),
        gt(handleClaims.expiresAt, Date.now()),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Housekeeping: drop expired claims. Called opportunistically, not on a cron. */
export async function pruneClaims(): Promise<void> {
  const database = await readyDb();
  await database.delete(handleClaims).where(lt(handleClaims.expiresAt, Date.now() - 86_400_000));
}

export { or };
