/**
 * End-to-end proof of the version-pinning promise.
 *
 * Publishes a revision that edits the paragraph a real anonymous note is
 * attached to, so the "this note is on revision N" path can be exercised in the
 * browser rather than reasoned about.
 *
 *   npx tsx scripts/prove-anchor-survival.ts
 */

import { eq } from 'drizzle-orm';
import { readyDb } from '../src/lib/db';
import { annotations, posts } from '../src/lib/db/schema';
import { parseBody, serializeBody, blockToPlainText, type Block } from '../src/lib/blocks';
import { resolveAnchor, type Anchor } from '../src/lib/repo/annotations';
import { publishRevision } from '../src/lib/repo/posts';

const database = await readyDb();

const [post] = await database.select().from(posts).where(eq(posts.slug, 'cache-invalidation-is-a-distributed-problem')).limit(1);
if (!post) throw new Error('seed post missing — run npm run db:seed');

// The note we just posted in the browser is the one whose body mentions the LRU.
const all = await database.select().from(annotations).where(eq(annotations.postId, post.id));
const target = all.find((a) => a.body.includes('pod LRU')) ?? all[0];
if (!target) throw new Error('no annotation to test against');

const anchor = JSON.parse(target.anchor) as Anchor;
const current = await database.query.postVersions.findFirst({
  where: (t, { eq }) => eq(t.id, post.currentVersionId!),
});
if (!current) throw new Error('current version missing');

const before = parseBody(current.body);
const block = before.find((b) => b.id === target.blockId);
if (!block) throw new Error('annotated block missing from current version');

console.log(`annotated block: ${block.type}`);
console.log(`anchor quote   : ${JSON.stringify(anchor.quote)}`);
console.log(`resolves now   : ${resolveAnchor(anchor, blockToPlainText(block)).status}`);

/* Edit the paragraph by inserting a clause *before* the anchored sentence.
   Offsets shift, the sentence survives. */
const src = blockToPlainText(block);
const at = src.indexOf(anchor.quote);
if (at < 0) throw new Error('anchor quote is not in the block — cannot build the test');

const edited: Block =
  block.type === 'paragraph'
    ? { ...block, text: src.slice(0, at) + 'And this is the part that surprises people. ' + src.slice(at) }
    : block;
const after = before.map((b) => (b.id === block.id ? edited : b));

const r = await publishRevision({
  postId: post.id,
  authorId: post.authorId,
  body: after,
  changeSummary: 'Testing: added a clause above an annotated sentence.',
  isMajor: true,
});

const newText = blockToPlainText(after.find((b) => b.id === target.blockId)!);
const resolved = resolveAnchor(anchor, newText);

console.log(`\npublished revision ${r.versionNumber}`);
console.log(`anchor now       : ${resolved.status} at ${resolved.start}`);
console.log(
  `expected         : moved (offsets shifted by ${resolved.start - anchor.start}, sentence intact)`,
);
console.log(
  resolved.status === 'moved'
    ? '\nPASS — the note survived the edit and the page will offer the previous revision.'
    : `\nUNEXPECTED — got ${resolved.status}`,
);
process.exit(resolved.status === 'moved' ? 0 : 1);
