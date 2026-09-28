import { eq } from 'drizzle-orm';
import { readyDb } from '../db';
import { readerProfiles } from '../db/schema';
import type { Density, Depth } from '../prefs';

/**
 * Reading preferences that follow an account.
 *
 * Preferences normally live in cookies, which is right: it means a reader can
 * choose "skim" and have it work with no account, on the first page, with no
 * round trip. The cost is that the choice is a property of the *browser*, so a
 * reader who set up their depth on a laptop gets the default on a phone, and
 * has to learn their own settings twice.
 *
 * This table is the answer for readers who have claimed a handle. The cookie
 * still wins on the device that set it — an explicit local choice should never
 * be overridden by a stale profile from another device — but the profile is
 * what a new device inherits, and what `/settings` edits.
 */
export interface Profile {
  depth: Depth;
  density: Density;
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const database = await readyDb();
  const [row] = await database
    .select({ depth: readerProfiles.depthPreference, density: readerProfiles.density })
    .from(readerProfiles)
    .where(eq(readerProfiles.userId, userId))
    .limit(1);
  if (!row) return null;
  return { depth: row.depth as Depth, density: row.density as Density };
}

export async function saveProfile(
  userId: string,
  prefs: Partial<Profile> & { theme?: string },
): Promise<void> {
  const database = await readyDb();
  const existing = await getProfile(userId);
  const merged = {
    depth: prefs.depth ?? existing?.depth ?? ('understand' as Depth),
    density: prefs.density ?? existing?.density ?? ('comfortable' as Density),
  };
  await database
    .insert(readerProfiles)
    .values({
      userId,
      depthPreference: merged.depth,
      density: merged.density,
      // `explanation_level` has no UI yet and keeps its schema default.
    })
    .onConflictDoUpdate({
      target: readerProfiles.userId,
      set: { depthPreference: merged.depth, density: merged.density },
    });
}
