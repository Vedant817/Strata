/**
 * Seeds the canon. Idempotent: wipes and rebuilds, so the content can be
 * rewritten during development without accumulating junk revisions.
 *
 *   npm run db:seed
 */

import { eq } from 'drizzle-orm';
import { readyDb } from '../src/lib/db';
import {
  annotations,
  blocks,
  newsletterSubscribers,
  postLinks,
  postVersions,
  posts,
  readEvents,
  readReceipts,
  readingListItems,
  readingLists,
  series,
  topics,
  users,
} from '../src/lib/db/schema';
import { nanoid } from '../src/lib/ids';
import { rebuildSearchIndex } from '../src/lib/repo/search';
import { assertNoAnchorMisses } from '../src/seed/build';
import { blockToPlainText, serializeBody, type Block } from '../src/lib/blocks';
import {
  SEED_ANNOTATIONS,
  SEED_POSTS,
  SEED_READING_LIST,
  SEED_TOPICS,
  SEED_USERS,
  type SeedPost,
} from '../src/seed/content';

const DAY = 86_400_000;

async function wipe() {
  const database = await readyDb();
  // Order matters only where FKs are enforced; libsql defaults to them on.
  await database.delete(readingListItems);
  await database.delete(readingLists);
  await database.delete(annotations);
  await database.delete(readReceipts);
  await database.delete(readEvents);
  await database.delete(blocks);
  await database.delete(postVersions);
  await database.delete(postLinks);
  await database.delete(posts);
  await database.delete(series);
  await database.delete(topics);
  await database.delete(newsletterSubscribers);
  await database.delete(users);
}

async function insertPost(
  seed: SeedPost,
  topicIds: Map<string, string>,
  authorId: string,
  now: number,
): Promise<{ postId: string; versionIds: string[]; finalBlocks: Block[] }> {
  const database = await readyDb();
  const postId = `p_${seed.slug.slice(0, 12)}`;
  const publishedAt = now - seed.publishedDaysAgo * DAY;
  const versionIds: string[] = [];
  let finalBlocks: Block[] = seed.revisions[0]!.body;

  // Every revision except the first is an update to the post row, so the post
  // must exist before we walk the history.
  const firstAt = publishedAt;
  await database.insert(posts).values({
    id: postId,
    slug: seed.slug,
    title: seed.title,
    dek: seed.dek,
    authorId,
    status: 'seedling',
    visibility: 'public',
    currentVersionId: null,
    publishedAt: firstAt,
    createdAt: firstAt,
    updatedAt: firstAt,
    lastReviewedAt: publishedAt,
    topicId: topicIds.get(seed.topicSlug) ?? null,
    seoDescription: seed.seoDescription,
    viewCount: 0,
  });

  for (const [i, rev] of seed.revisions.entries()) {
    const versionId = `v_${postId}_${i + 1}`;
    versionIds.push(versionId);
    finalBlocks = rev.body;
    // Spread later revisions across the window between publication and today.
    const at =
      rev.daysAgo >= seed.publishedDaysAgo
        ? publishedAt
        : now - rev.daysAgo * DAY;

    await database.insert(postVersions).values({
      id: versionId,
      postId,
      versionNumber: i + 1,
      body: serializeBody(rev.body),
      changeSummary: rev.changeSummary,
      authorId,
      createdAt: at,
      isMajor: rev.isMajor,
    });

    const rows = rev.body.map((block, ordinal) => ({
      id: nanoid(),
      postId,
      versionId,
      blockId: block.id,
      ordinal,
      type: block.type,
      layer: block.layer,
      text: 'text' in block ? (block as { text: string }).text : '',
      headingPath: '',
      wordCount: 0,
    }));
    if (rows.length) await database.insert(blocks).values(rows);
  }

  await database
    .update(posts)
    .set({
      currentVersionId: versionIds[versionIds.length - 1]!,
      status: seed.status,
      updatedAt: now - seed.revisions[seed.revisions.length - 1]!.daysAgo * DAY,
      lastReviewedAt: now - seed.revisions[seed.revisions.length - 1]!.daysAgo * DAY,
    })
    .where(eq(posts.id, postId));

  return { postId, versionIds, finalBlocks };
}

async function main() {
  assertNoAnchorMisses();
  const now = Date.now();
  const database = await readyDb();

  console.log('· wiping');
  await wipe();

  console.log('· topics');
  const topicIds = new Map<string, string>();
  for (const t of SEED_TOPICS) {
    const id = `t_${t.slug}`;
    topicIds.set(t.slug, id);
    await database.insert(topics).values({ id, slug: t.slug, name: t.name, blurb: t.blurb });
  }

  console.log('· users');
  for (const u of SEED_USERS) {
    await database.insert(users).values({
      id: u.id,
      email: u.email,
      handle: u.handle,
      displayName: u.displayName,
      bio: u.bio,
      role: u.role,
      createdAt: now,
    });
  }
  const authorFor = (handle: string) => `u_${handle}`;

  console.log('· posts');
  const bySlug = new Map<string, { postId: string; versionIds: string[]; finalBlocks: Block[] }>();
  for (const seed of SEED_POSTS) {
    const result = await insertPost(seed, topicIds, authorFor(SEED_USERS[0]!.handle), now);
    bySlug.set(seed.slug, result);
    console.log(`  · ${seed.slug} (${seed.revisions.length} revisions, ${result.finalBlocks.length} blocks)`);
  }

  console.log('· links');
  for (const seed of SEED_POSTS) {
    const from = bySlug.get(seed.slug);
    for (const link of seed.links ?? []) {
      const to = bySlug.get(link.toSlug);
      if (!from || !to) continue;
      await database.insert(postLinks).values({
        fromPostId: from.postId,
        toPostId: to.postId,
        type: link.type,
      });
    }
  }

  console.log('· marginalia');
  let noteCount = 0;
  for (const a of SEED_ANNOTATIONS) {
    const post = bySlug.get(a.postSlug);
    if (!post) continue;
    // Locate by the quoted span, not by index — indices rot the moment an
    // upstream revision inserts a block.
    const block = post.finalBlocks.find((b) => blockToPlainText(b).includes(a.quote.slice(0, 40)));
    if (!block) {
      console.warn(`  ! no block in ${a.postSlug} contains ${JSON.stringify(a.quote.slice(0, 40))}`);
      continue;
    }
    const plain = blockToPlainText(block);
    // Anchor against the final version, with context on both sides.
    const at = Math.max(0, plain.indexOf(a.quote.slice(0, 40)));
    await database.insert(annotations).values({
      id: nanoid(),
      postId: post.postId,
      versionId: post.versionIds[post.versionIds.length - 1]!,
      blockId: block.id,
      anchor: JSON.stringify({
        blockId: block.id,
        start: at,
        end: at + a.quote.length,
        quote: a.quote,
        prefix: plain.slice(Math.max(0, at - 60), at),
        suffix: plain.slice(at + a.quote.length, at + a.quote.length + 60),
      }),
      body: a.body,
      kind: a.kind,
      authorId: authorFor(a.authorHandle),
      isAccepted: a.accepted ?? false,
      createdAt: now - a.daysAgo * DAY,
    });
    noteCount += 1;
  }
  console.log(`  · ${noteCount} notes`);

  console.log('· reading list');
  const listId = 'rl_start_here';
  await database.insert(readingLists).values({
    id: listId,
    ownerId: authorFor(SEED_USERS[0]!.handle),
    slug: SEED_READING_LIST.slug,
    title: SEED_READING_LIST.title,
    description: SEED_READING_LIST.description,
    isPublic: true,
    createdAt: now,
  });
  for (const [i, item] of SEED_READING_LIST.items.entries()) {
    const post = bySlug.get(item.toSlug);
    if (!post) continue;
    await database.insert(readingListItems).values({
      id: nanoid(),
      listId,
      postId: post.postId,
      ordinal: i,
      note: item.note,
    });
  }

  console.log('\nseeded ✓');

  // Invariants. A post with no `understand` or `master` layer renders a
  // depth dial that does nothing, which quietly makes the core reading feature
  // look broken on exactly the posts a new reader lands on.
  const thin: string[] = [];
  for (const seed of SEED_POSTS) {
    const final = seed.revisions[seed.revisions.length - 1]!.body;
    const layers = new Set(final.map((b) => b.layer));
    if (!layers.has('understand')) thin.push(`${seed.slug} — no understand layer`);
    if (!layers.has('master')) thin.push(`${seed.slug} — no master layer`);
  }
  if (thin.length) {
    console.warn('\nwarning: posts without a full depth stack:');
    for (const t of thin) console.warn(`  · ${t}`);
  }

  const indexed = await rebuildSearchIndex();
  console.log(`search index: ${indexed} posts`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
