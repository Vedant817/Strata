import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { readyDb } from '../db';
import { newsletterSubscribers, posts, postVersions, users } from '../db/schema';

export interface DigestItem {
  slug: string;
  title: string;
  dek: string;
  authorName: string;
  kind: 'new' | 'revised';
  detail: string;
  /** When the post was published or the revision landed. Used by the RSS feed. */
  at: number;
}

export interface Digest {
  since: number;
  items: DigestItem[];
}

/**
 * The weekly digest, §10.4's return hook.
 *
 * Three posts with a human-written reason each is the aspiration; what ships
 * is three posts with an *honest* reason each — "new from @handle" or
 * "revised 3×, latest: <summary>". A generated reason that pretends a human
 * wrote it would be the engagement-bait §1.1 refuses, so the lines say what
 * happened and nothing more. Empty weeks send nothing: "you have 0 new
 * posts" is the notification the plan explicitly bans.
 */
export async function buildDigest(sinceMs: number): Promise<Digest> {
  const database = await readyDb();
  const items: DigestItem[] = [];

  const fresh = await database
    .select({
      slug: posts.slug,
      title: posts.title,
      dek: posts.dek,
      authorName: users.displayName,
      publishedAt: posts.publishedAt,
    })
    .from(posts)
    .innerJoin(users, eq(posts.authorId, users.id))
    .where(
      and(
        eq(posts.visibility, 'public'),
        sql`${posts.publishedAt} is not null`,
        gt(posts.publishedAt, sinceMs),
      ),
    )
    .orderBy(desc(posts.publishedAt))
    .limit(10);

  for (const p of fresh) {
    items.push({
      slug: p.slug,
      title: p.title,
      dek: p.dek,
      authorName: p.authorName,
      kind: 'new',
      detail: `New from ${p.authorName}.`,
      at: p.publishedAt ?? Date.now(),
    });
  }

  const revised = await database
    .select({
      slug: posts.slug,
      title: posts.title,
      dek: posts.dek,
      authorName: users.displayName,
      versionNumber: postVersions.versionNumber,
      changeSummary: postVersions.changeSummary,
      createdAt: postVersions.createdAt,
    })
    .from(postVersions)
    .innerJoin(posts, eq(postVersions.postId, posts.id))
    .innerJoin(users, eq(posts.authorId, users.id))
    .where(
      and(
        eq(posts.visibility, 'public'),
        gt(postVersions.versionNumber, 1),
        gt(postVersions.createdAt, sinceMs),
      ),
    )
    .orderBy(desc(postVersions.createdAt))
    .limit(10);

  const seen = new Set(items.map((i) => i.slug));
  for (const r of revised) {
    if (seen.has(r.slug)) continue;
    seen.add(r.slug);
    items.push({
      slug: r.slug,
      title: r.title,
      dek: r.dek,
      authorName: r.authorName,
      kind: 'revised',
      detail: `Revised to v${r.versionNumber} — ${r.changeSummary}`,
      at: r.createdAt,
    });
  }

  return { since: sinceMs, items: items.slice(0, 10) };
}

export function renderDigestText(digest: Digest, site: string): { subject: string; text: string } {
  const lines = digest.items.flatMap((item, i) => [
    `${i + 1}. ${item.title} — ${item.detail}`,
    `   ${site}/w/${item.slug}`,
    '',
  ]);
  return {
    subject: `Strata weekly: ${digest.items.length} ${digest.items.length === 1 ? 'post moved' : 'posts moved'}`,
    text: ['What changed this week on Strata.', '', ...lines, 'Unsubscribe anytime — reply STOP.'].join('\n'),
  };
}

export async function getDigestSubscribers(): Promise<string[]> {
  const database = await readyDb();
  const rows = await database
    .select({ email: newsletterSubscribers.email })
    .from(newsletterSubscribers)
    .orderBy(newsletterSubscribers.createdAt);
  return [...new Set(rows.map((r) => r.email.toLowerCase()))];
}
