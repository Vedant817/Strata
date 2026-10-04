import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { readyDb } from '../db';
import {
  follows,
  newsletterSubscribers,
  posts,
  postVersions,
  readReceipts,
  topics,
  users,
} from '../db/schema';

export interface DigestItem {
  slug: string;
  title: string;
  dek: string;
  authorName: string;
  kind: 'new' | 'revised';
  detail: string;
  /** When the post was published or the revision landed. Used by the RSS feed. */
  at: number;
  /** Why *this* reader is being shown it. Absent when there was no signal. */
  because?: string;
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

  return { since: sinceMs, items: items.slice(0, 3) };
}

/**
 * The constellation digest — PLAN.md §9.7, §10.4.
 *
 * The email and the RSS feed are a *site* digest, and they have to be: a
 * newsletter row is an email address and nothing else, so there is no honest way
 * to rank a send for one subscriber differently from another. That is a
 * constraint of the table, not an oversight, and pretending otherwise would mean
 * either mailing everyone the same thing under a personalised heading or asking
 * people to log in to read a weekly email.
 *
 * This is the reader-facing half. It ranks against what a reader has actually
 * done here — the authors they follow, and the topics of the posts they have
 * finished reading — and then says which of those it was. A reader with no
 * history gets the site digest with no invented reasons, because a cold-start
 * digest that claims to know you is the engagement bait §1.1 refuses.
 *
 * Everything here is first-party and already stored: `follows` and
 * `readReceipts`. Nothing is inferred about a reader who has not read anything.
 */
export interface ConstellationDigest extends Digest {
  /** False when there was no signal to personalise with, and the site list was used. */
  personalised: boolean;
  /** Enough to render an honest explanation of how the list was chosen. */
  signals: {
    follows: number;
    readCount: number;
    topics: string[];
  };
}

/** What the plan actually asks for: three, not "up to ten". */
const CONSTELLATION_ITEMS = 3;

/** `follows.follower_key` is `u:<id>` or `a:<anonId>`. */
function followerKey(identity: { anonId?: string; userId?: string | null }): string[] {
  const keys: string[] = [];
  if (identity.userId) keys.push(`u:${identity.userId}`);
  if (identity.anonId) keys.push(`a:${identity.anonId}`);
  return keys;
}

export async function buildConstellationDigest(
  identity: { anonId?: string; userId?: string | null } | null,
  sinceMs: number,
): Promise<ConstellationDigest> {
  const empty: ConstellationDigest['signals'] = { follows: 0, readCount: 0, topics: [] };

  if (!identity || (!identity.anonId && !identity.userId)) {
    const site = await buildDigest(sinceMs);
    return { ...site, items: site.items.slice(0, CONSTELLATION_ITEMS), personalised: false, signals: empty };
  }

  const database = await readyDb();

  /* Explicit follows. */
  const keys = followerKey(identity);
  const followed = keys.length
    ? await database
        .select({ authorId: follows.authorId })
        .from(follows)
        .where(inArray(follows.followerKey, keys))
    : [];
  const followedIds = new Set(followed.map((f) => f.authorId));

  /* Inferred interests: which topics this reader has actually finished. A
     receipt is a finished read, not a page view, so this is a statement about
     attention rather than about a click. */
  const readRows = await database
    .select({ topicId: posts.topicId })
    .from(readReceipts)
    .innerJoin(posts, eq(readReceipts.postId, posts.id))
    .where(
      identity.userId
        ? eq(readReceipts.userId, identity.userId)
        : eq(readReceipts.anonId, identity.anonId ?? ''),
    );

  const topicCounts = new Map<string, number>();
  for (const r of readRows) {
    if (!r.topicId) continue;
    topicCounts.set(r.topicId, (topicCounts.get(r.topicId) ?? 0) + 1);
  }

  if (followedIds.size === 0 && topicCounts.size === 0) {
    const site = await buildDigest(sinceMs);
    return {
      ...site,
      items: site.items.slice(0, CONSTELLATION_ITEMS),
      personalised: false,
      signals: { ...empty, readCount: readRows.length },
    };
  }

  // The site digest is the candidate pool: it already knows what moved, and
  // already knows which of those were revisions.
  const site = await buildDigest(sinceMs);

  /* Topic names, so a reason can say "Systems" rather than a slug. */
  const topicNames = new Map<string, string>();
  if (topicCounts.size > 0) {
    const rows = await database
      .select({ id: topics.id, name: topics.name })
      .from(topics)
      .where(inArray(topics.id, [...topicCounts.keys()]));
    for (const r of rows) topicNames.set(r.id, r.name);
  }

  /* Author ids for the candidates, so a follow can be recognised. */
  const slugs = site.items.map((i) => i.slug);
  const authorRows = slugs.length
    ? await database
        .select({ slug: posts.slug, authorId: posts.authorId, topicId: posts.topicId })
        .from(posts)
        .where(inArray(posts.slug, slugs))
    : [];
  const byslug = new Map(authorRows.map((r) => [r.slug, r]));

  const scored = site.items.map((item) => {
    const meta = byslug.get(item.slug);
    const reasons: Array<{ weight: number; text: string }> = [];

    if (meta && followedIds.has(meta.authorId)) {
      reasons.push({ weight: 100, text: `You follow ${item.authorName}.` });
    }
    if (meta?.topicId) {
      const count = topicCounts.get(meta.topicId);
      if (count) {
        const name = topicNames.get(meta.topicId) ?? 'a topic you have read';
        reasons.push({
          weight: 10 + Math.min(count, 20),
          text: `In ${name}, which you have read ${count === 1 ? 'once' : `${count} times`}.`,
        });
      }
    }

    const weight = reasons.reduce((n, r) => n + r.weight, 0);
    return { item, weight, reasons };
  });

  /* Ties break on recency, which is what the site digest was already ordered by,
     so an unranked pair keeps the behaviour a reader had before. */
  scored.sort((a, b) => b.weight - a.weight || b.item.at - a.item.at);

  const items = scored.slice(0, CONSTELLATION_ITEMS).map(({ item, reasons }) => ({
    ...item,
    because: reasons.length > 0 ? reasons[0]!.text : undefined,
  }));

  return {
    since: sinceMs,
    items,
    personalised: true,
    signals: {
      follows: followedIds.size,
      readCount: readRows.length,
      topics: [...topicNames.values()].slice(0, 5),
    },
  };
}

/**
 * The email body.
 *
 * Each post carries the author's own dek under its title, and that is the
 * human-written reason PLAN.md §10.4 asks for. It was already being selected
 * and then thrown away: a generated line like "New from @ada" is honest but it
 * is not a reason, it is a receipt. The dek is the sentence the person who wrote
 * the post wrote to say what it is about, and putting it in the digest is the
 * difference between a mailing list and somebody telling you what they made.
 *
 * A revision uses the author's change summary for the same reason — it is
 * literally their sentence about what changed.
 */
export function renderDigestText(digest: Digest, site: string): { subject: string; text: string } {
  const lines = digest.items.flatMap((item) => {
    const out = [`${item.title} — ${item.authorName}`, `   ${site}/w/${item.slug}`];
    // The dek, when the author wrote one. Never a placeholder.
    if (item.dek) out.push(`   ${item.dek}`);
    out.push(`   ${item.detail}`, '');
    return out;
  });
  const count = digest.items.length;
  return {
    subject: `Strata weekly: ${count} ${count === 1 ? 'post moved' : 'posts moved'}`,
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
