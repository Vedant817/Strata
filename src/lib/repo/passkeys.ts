import { desc, eq } from 'drizzle-orm';
import { readyDb } from '../db/index';
import { passkeys } from '../db/schema';

/**
 * Enrolled passkeys, newest first.
 *
 * `credentialId` is deliberately not returned. It is the authenticator's private
 * handle for the key, and nothing in this UI has a use for it — surfacing it on a
 * security screen only invites someone to paste it somewhere.
 */
export async function listPasskeys(userId: string) {
  const database = await readyDb();
  return database
    .select({
      id: passkeys.id,
      label: passkeys.label,
      transports: passkeys.transports,
      createdAt: passkeys.createdAt,
      lastUsedAt: passkeys.lastUsedAt,
    })
    .from(passkeys)
    .where(eq(passkeys.userId, userId))
    .orderBy(desc(passkeys.createdAt));
}

export async function countPasskeys(userId: string): Promise<number> {
  const rows = await listPasskeys(userId);
  return rows.length;
}