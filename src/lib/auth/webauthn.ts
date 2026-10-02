import { and, eq, gt, lt } from 'drizzle-orm';
import { readyDb } from '../db/index';
import { passkeys, webauthnChallenges } from '../db/schema';
import { createSession } from '../repo/auth';
import { encodeCbor } from './cbor-encode';
import {
  fromBase64Url,
  parseAttestationObject,
  toBase64Url,
  toHex,
  verifySignature,
  type Cbor,
} from './cbor';
import type { AstroCookies } from 'astro';

/**
 * The WebAuthn ceremony, server side.
 *
 * Two rules govern everything here:
 *
 * 1. **The challenge is consumed before the signature is trusted.** A challenge
 *    that can be replayed turns a captured assertion into a permanent key, so
 *    `takeChallenge` finds and deletes in one step rather than read-and-mark.
 *
 * 2. **`fmt: none` is the only accepted attestation.** It is what every platform
 *    authenticator returns, and it still proves the key was created in this
 *    ceremony, because the signature comes from the authenticator's own private
 *    key. Validating vendor chains means shipping and rotating per-vendor root
 *    certificates, which this project has no use for.
 */

/** Five minutes: long enough to move a phone, short enough that rows cannot rot. */
const CHALLENGE_MS = 5 * 60 * 1000;

export interface ClientData {
  type: string;
  challenge: string;
  origin: string;
}

export function decodeClientData(b64: string): ClientData | null {
  try {
    const raw = JSON.parse(new TextDecoder().decode(fromBase64Url(b64))) as Record<string, unknown>;
    if (
      typeof raw.type !== 'string' ||
      typeof raw.challenge !== 'string' ||
      typeof raw.origin !== 'string'
    ) {
      return null;
    }
    return { type: raw.type, challenge: raw.challenge, origin: raw.origin };
  } catch {
    return null;
  }
}

/**
 * Relying party id.
 *
 * Must be the site's host, not the origin and never a hardcoded localhost — the
 * browser rejects a mismatch, and an RP id that differs between preview and
 * production silently makes every passkey unusable on one of them.
 */
export function relyingPartyId(url: URL): string {
  return url.hostname;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer);
  return new Uint8Array(digest);
}

async function newChallenge(purpose: 'register' | 'authenticate', userId: string | null) {
  const database = await readyDb();
  // Opportunistic sweep: a site full of abandoned ceremonies would otherwise
  // accumulate rows forever.
  await database.delete(webauthnChallenges).where(lt(webauthnChallenges.expiresAt, Date.now()));

  const challenge = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  await database.insert(webauthnChallenges).values({
    id: crypto.randomUUID(),
    challenge,
    userId,
    purpose,
    expiresAt: Date.now() + CHALLENGE_MS,
  });
  return challenge;
}

/** Fetch and delete together, so a challenge is good for exactly one use. */
async function takeChallenge(
  challenge: string,
  purpose: 'register' | 'authenticate',
): Promise<{ userId: string | null } | null> {
  const database = await readyDb();
  const rows = await database
    .select()
    .from(webauthnChallenges)
    .where(
      and(
        eq(webauthnChallenges.challenge, challenge),
        eq(webauthnChallenges.purpose, purpose),
        gt(webauthnChallenges.expiresAt, Date.now()),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  await database.delete(webauthnChallenges).where(eq(webauthnChallenges.id, row.id));
  return { userId: row.userId };
}

export async function registrationOptions(input: {
  url: URL;
  userId: string;
  username: string;
  displayName: string;
}) {
  const database = await readyDb();
  const existing = await database
    .select({ credentialId: passkeys.credentialId })
    .from(passkeys)
    .where(eq(passkeys.userId, input.userId));

  return {
    rp: { id: relyingPartyId(input.url), name: 'Strata' },
    user: {
      // Opaque and stable. The username is shown by the authenticator and is not
      // secret, but it must not be used as the credential's primary key.
      id: toBase64Url(new TextEncoder().encode(input.userId)),
      name: input.username,
      displayName: input.displayName,
    },
    challenge: await newChallenge('register', input.userId),
    pubKeyCredParams: [
      { type: 'public-key' as const, alg: -7 }, // ES256
      { type: 'public-key' as const, alg: -257 }, // RS256
    ],
    timeout: CHALLENGE_MS,
    attestation: 'none' as const,
    // Stops a second passkey being enrolled on an authenticator that already
    // has one, which is how people end up unsure which to remove.
    excludeCredentials: existing.map((e) => ({ type: 'public-key' as const, id: e.credentialId })),
    authenticatorSelection: { userVerification: 'preferred' as const, residentKey: 'preferred' as const },
  };
}

export async function loginOptions(url: URL) {
  return {
    challenge: await newChallenge('authenticate', null),
    rpId: relyingPartyId(url),
    timeout: CHALLENGE_MS,
    userVerification: 'preferred' as const,
  };
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export async function registerVerify(input: {
  url: URL;
  userId: string;
  label: string;
  credential: {
    id: string;
    rawId: string;
    response: { clientDataJSON: string; attestationObject: string; transports?: string[] };
  };
}): Promise<Result<{ credentialId: string }>> {
  const client = decodeClientData(input.credential.response.clientDataJSON);
  if (!client) return { ok: false, error: 'Could not read the ceremony data.' };
  if (client.type !== 'webauthn.create') {
    return { ok: false, error: 'That response was not from a registration ceremony.' };
  }
  if (client.origin !== input.url.origin) {
    return { ok: false, error: 'That ceremony came from a different site.' };
  }

  const challenge = await takeChallenge(client.challenge, 'register');
  if (!challenge) return { ok: false, error: 'That ceremony expired. Try again.' };
  // A challenge issued to one handle must not enrol a key for another.
  if (challenge.userId !== input.userId) {
    return { ok: false, error: 'That ceremony was for a different account.' };
  }

  let attestation;
  try {
    attestation = parseAttestationObject(fromBase64Url(input.credential.response.attestationObject));
  } catch (e) {
    return { ok: false, error: `Could not read the credential: ${(e as Error).message}` };
  }

  const expectedRp = await sha256(new TextEncoder().encode(relyingPartyId(input.url)));
  if (attestation.rpIdHash !== toHex(expectedRp)) {
    return { ok: false, error: 'That credential was made for a different site.' };
  }
  if (attestation.userVerified === false) {
    // Not fatal — many platform authenticators cannot do UV — but it is recorded
    // so a suspicious enrolment can be spotted later.
    console.warn('[strata] passkey enrolled without user verification');
  }

  const database = await readyDb();
  await database
    .insert(passkeys)
    .values({
      id: crypto.randomUUID(),
      userId: input.userId,
      credentialId: input.credential.rawId,
      publicKey: toBase64Url(encodeCbor(attestation.coseKey as Map<number | string, Cbor>)),
      counter: attestation.signCount,
      label: input.label.slice(0, 60) || 'Passkey',
      transports: input.credential.response.transports?.join(',') ?? null,
    })
    .onConflictDoNothing();

  return { ok: true, value: { credentialId: input.credential.rawId } };
}

export async function loginVerify(input: {
  url: URL;
  cookies: AstroCookies;
  credential: {
    id: string;
    rawId: string;
    response: { clientDataJSON: string; authenticatorData: string; signature: string; userHandle?: string };
  };
}): Promise<Result<{ userId: string }>> {
  const client = decodeClientData(input.credential.response.clientDataJSON);
  if (!client) return { ok: false, error: 'Could not read the ceremony data.' };
  if (client.type !== 'webauthn.get') {
    return { ok: false, error: 'That response was not from a sign-in ceremony.' };
  }
  if (client.origin !== input.url.origin) {
    return { ok: false, error: 'That ceremony came from a different site.' };
  }

  // Consumed before any credential lookup, so a captured assertion cannot be
  // retried even against a different handle.
  if (!(await takeChallenge(client.challenge, 'authenticate'))) {
    return { ok: false, error: 'That ceremony expired. Try again.' };
  }

  const database = await readyDb();
  const rows = await database
    .select()
    .from(passkeys)
    .where(eq(passkeys.credentialId, input.credential.rawId))
    .limit(1);
  const key = rows[0];
  if (!key) return { ok: false, error: 'That passkey is not registered here.' };

  let coseKey: Map<number | string, Cbor>;
  try {
    const decoded = await import('./cbor').then((m) => m.decodeCbor(fromBase64Url(key.publicKey)));
    if (!(decoded instanceof Map)) throw new Error('stored key is not a map');
    coseKey = decoded as Map<number | string, Cbor>;
  } catch (e) {
    return { ok: false, error: `Stored credential is unreadable: ${(e as Error).message}` };
  }

  const authData = fromBase64Url(input.credential.response.authenticatorData);
  const alg = coseKey.get(3);
  if (typeof alg !== 'number') return { ok: false, error: 'Stored credential has no algorithm.' };

  /* The signed message is authData || SHA-256(clientDataJSON), per §7.1.
     Signing clientDataJSON alone would let an assertion be replayed against a
     different ceremony. */
  const clientHash = await sha256(fromBase64Url(input.credential.response.clientDataJSON));
  const signed = new Uint8Array(authData.length + clientHash.length);
  signed.set(authData, 0);
  signed.set(clientHash, authData.length);

  const ok = await verifySignature(
    coseKey,
    alg,
    signed,
    fromBase64Url(input.credential.response.signature),
  );
  if (!ok) return { ok: false, error: 'That signature did not verify.' };

  // rpIdHash and the UP flag are inside the signed bytes, so checking them here
  // is checking the authenticator's statement, not ours.
  const rpIdHash = toHex(authData.subarray(0, 32));
  const expectedRp = await sha256(new TextEncoder().encode(relyingPartyId(input.url)));
  if (rpIdHash !== toHex(expectedRp)) {
    return { ok: false, error: 'That passkey belongs to a different site.' };
  }
  if (authData.length < 33) return { ok: false, error: 'Truncated authenticator data.' };
  if ((authData[32]! & 0x01) === 0) {
    return { ok: false, error: 'The authenticator did not confirm user presence.' };
  }

  /* Counter regression means a cloned authenticator. Authenticators that do not
     support counters stay at 0, so only a *decrease* is evidence. Refusing is
     right: silently accepting is how a stolen credential stays useful. */
  const signCount =
    ((authData[33]! << 24) | (authData[34]! << 16) | (authData[35]! << 8) | authData[36]!) >>> 0;
  if (key.counter !== 0 && signCount !== 0 && signCount <= key.counter) {
    console.warn('[strata] passkey counter regression — possible cloned credential');
    return { ok: false, error: 'That passkey was refused for a possible security reason.' };
  }

  await database
    .update(passkeys)
    .set({ counter: signCount, lastUsedAt: new Date() })
    .where(eq(passkeys.id, key.id));
  await createSession(key.userId, input.cookies);

  return { ok: true, value: { userId: key.userId } };
}