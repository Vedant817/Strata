import { and, desc, eq } from 'drizzle-orm';
import { readyDb } from '../db/index';
import { webmentions } from '../db/schema';

/**
 * Reading side. Verified mentions first, because a mention we could not
 * substantiate is a claim someone made about our post, and showing it as fact
 * invites us to be wrong in public.
 */
export interface Mention {
  id: string;
  source: string;
  sourceTitle: string;
  kind: string;
  verified: boolean;
  createdAt: number;
  /** Host shown instead of a full URL, which is a wall of noise in a sidebar. */
  host: string;
}

export async function listMentions(postId: string, limit = 25): Promise<Mention[]> {
  const database = await readyDb();
  const rows = await database
    .select()
    .from(webmentions)
    .where(eq(webmentions.postId, postId))
    .orderBy(desc(webmentions.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    sourceTitle: r.sourceTitle,
    kind: r.kind,
    verified: r.verifiedAt !== null,
    createdAt: r.createdAt,
    host: hostOf(r.source),
  }));
}

export async function mentionCount(postId: string): Promise<number> {
  const database = await readyDb();
  const rows = await database
    .select({ id: webmentions.id })
    .from(webmentions)
    .where(and(eq(webmentions.postId, postId)));
  return rows.length;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return 'somewhere';
  }
}