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

/**
 * Has anyone on this site enrolled a passkey at all?
 *
 * Exists for one caller: /settings offers passkey sign-in only when the answer
 * is yes, because a passkey cannot exist before a handle has been claimed and
 * the ceremony fails with "no matching credential" for a reader who has none.
 *
 * Deliberately a boolean and not a count. A number would be a readership metric
 * published to every anonymous visitor, and nothing here needs the difference
 * between one device and fifty. It stops at the first row, so it is a cheap
 * existence probe rather than a full scan.
 */
export async function anyPasskeysEnrolled(): Promise<boolean> {
  const database = await readyDb();
  const row = await database.select({ one: passkeys.id }).from(passkeys).limit(1);
  return row.length > 0;
}