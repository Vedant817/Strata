import { and, eq } from 'drizzle-orm';
import { readyDb } from '../db';
import { userProviderKeys } from '../db/schema';
import { openSealed, seal } from '../ai/secrets';
import { getProvider } from '../ai/providers';

/**
 * Per-user provider keys.
 *
 * Nothing here ever returns plaintext to a browser. Reads for display give
 * the provider, a hint, and a fingerprint; the only function that decrypts is
 * `resolveKey`, called on the one request that is about to spend the money.
 */

export interface KeySummary {
  providerId: string;
  label: string;
  hint: string;
  fingerprint: string;
  model: string | null;
}

export async function setKey(
  userId: string,
  providerId: string,
  plaintext: string,
  model?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!getProvider(providerId)) return { ok: false, error: 'Unknown provider.' };
  const clean = plaintext.trim();
  if (clean.length < 12) return { ok: false, error: 'That does not look like an API key.' };
  const sealed = seal(clean);
  const database = await readyDb();
  await database
    .insert(userProviderKeys)
    .values({
      userId,
      providerId,
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      tag: sealed.tag,
      hint: sealed.hint,
      fingerprint: sealed.fingerprint,
      model: model ?? null,
    })
    .onConflictDoUpdate({
      target: [userProviderKeys.userId, userProviderKeys.providerId],
      set: {
        ciphertext: sealed.ciphertext,
        iv: sealed.iv,
        tag: sealed.tag,
        hint: sealed.hint,
        fingerprint: sealed.fingerprint,
        model: model ?? null,
        updatedAt: Date.now(),
      },
    });
  return { ok: true };
}

export async function setModel(
  userId: string,
  providerId: string,
  model: string,
): Promise<boolean> {
  const database = await readyDb();
  const result = await database
    .update(userProviderKeys)
    .set({ model, updatedAt: Date.now() })
    .where(
      and(eq(userProviderKeys.userId, userId), eq(userProviderKeys.providerId, providerId)),
    );
  return (result.rowsAffected ?? 0) > 0;
}

export async function removeKey(userId: string, providerId: string): Promise<boolean> {
  const database = await readyDb();
  const result = await database
    .delete(userProviderKeys)
    .where(
      and(eq(userProviderKeys.userId, userId), eq(userProviderKeys.providerId, providerId)),
    );
  return (result.rowsAffected ?? 0) > 0;
}

/** Keys this user has added, for the settings page. No plaintext. */
export async function listKeys(userId: string): Promise<KeySummary[]> {
  const database = await readyDb();
  const rows = await database
    .select({
      providerId: userProviderKeys.providerId,
      hint: userProviderKeys.hint,
      fingerprint: userProviderKeys.fingerprint,
      model: userProviderKeys.model,
    })
    .from(userProviderKeys)
    .where(eq(userProviderKeys.userId, userId));
  return rows.map((r) => ({
    providerId: r.providerId,
    label: getProvider(r.providerId)?.label ?? r.providerId,
    hint: r.hint,
    fingerprint: r.fingerprint,
    model: r.model,
  }));
}

/**
 * The plaintext key, for a request that is about to use it. This is the only
 * place ciphertext is opened, and the value never leaves the caller's stack.
 */
export async function resolveKey(userId: string, providerId: string): Promise<string | null> {
  const database = await readyDb();
  const [row] = await database
    .select()
    .from(userProviderKeys)
    .where(
      and(eq(userProviderKeys.userId, userId), eq(userProviderKeys.providerId, providerId)),
    )
    .limit(1);
  if (!row) return null;
  try {
    return openSealed(row);
  } catch (err) {
    // A row that will not open is a tampered row or a rotated secret. Either
    // way the key is unusable, and pretending otherwise would be worse.
    console.error('[strata] provider key failed to open:', err);
    return null;
  }
}

export async function chosenModel(
  userId: string,
  providerId: string,
): Promise<string | null> {
  const database = await readyDb();
  const [row] = await database
    .select({ model: userProviderKeys.model })
    .from(userProviderKeys)
    .where(
      and(eq(userProviderKeys.userId, userId), eq(userProviderKeys.providerId, providerId)),
    )
    .limit(1);
  return row?.model ?? null;
}
