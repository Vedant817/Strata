/**
 * Publication-scope annotation behaviour.
 *
 * The schema change that made `annotations.post_id` nullable is easy to get
 * subtly wrong in a way that still typechecks: a publication note can leak into
 * an article's margin, or a post author can end up moderating a note that has no
 * post. Both are invisible to `astro check`, so this drives the real repository
 * functions against a throwaway copy of the database and asserts what they
 * actually do.
 *
 * Runs the real migration on the copy first, so it also proves 0020 applies
 * cleanly from the previous schema.
 *
 * Run: npx tsx scripts/check-publication-notes.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');

let passed = 0;
let failed = 0;
function ok(label: string, condition: boolean, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ok   ${label}${detail ? `  ${detail}` : ''}`);
  } else {
    failed++;
    console.error(`  FAIL ${label}${detail ? `  ${detail}` : ''}`);
  }
}
const eq = (label: string, actual: unknown, expected: unknown) =>
  ok(label, Object.is(actual, expected), `got ${String(actual)}, want ${String(expected)}`);

/* -------------------------------------------------------------------------- */
/* Work on a throwaway copy so the dev database is never touched               */
/* -------------------------------------------------------------------------- */

const source = path.resolve(projectRoot, 'data/strata.db');
if (!fs.existsSync(source)) {
  console.error('data/strata.db missing — run `npm run db:seed` first.');
  process.exit(1);
}
// Outside the repo, so a locked handle on a native libsql file cannot leave
// litter behind and cannot dirty the working tree.
const scratch = path.join(os.tmpdir(), 'strata-publication-check.db');
for (const suffix of ['', '-journal', '-wal', '-shm']) {
  fs.rmSync(`${scratch}${suffix}`, { force: true });
}
fs.copyFileSync(source, scratch);

// Must be set before the db module is imported: it reads the URL at load time.
process.env.DATABASE_URL = `file:${scratch}`;

const { readyDb, client } = await import('../src/lib/db/index');
const repo = await import('../src/lib/repo/annotations');
await readyDb();

console.log('\npublication-scope annotations');
console.log(`  scratch copy: ${path.basename(scratch)}\n`);

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const rows = async (sql: string) => (await client.execute(sql)).rows as unknown as Record<string, unknown>[];
const count = async (sql: string) => Number((await client.execute(sql)).rows[0][0]);

const postRows = await rows(
  `select p.id as postId, p.author_id as postAuthorId from posts p
    where exists (select 1 from annotations a where a.post_id = p.id) limit 1;`,
);
if (!postRows[0]) {
  console.error('no post with annotations — run `npm run db:seed` first.');
  process.exit(1);
}
const POST_ID = String(postRows[0].postId);
const POST_AUTHOR = String(postRows[0].postAuthorId);

/* -------------------------------------------------------------------------- */
/* 1. Reactions in the store are intact and joined                              */
/* -------------------------------------------------------------------------- */

/* This used to assert `count(*) > 0` and read as "migration 0020 preserved
   reactions" — but nothing in the seed creates reactions, so on a fresh dev
   database it asserted 0 > 0 and passed while proving nothing. Worse, a join
   over zero rows is also green. So the reactions are put there first, on a note
   that really exists, and then checked. Whether the *migration* preserves them
   is a separate question with a separate answer: scripts/check-migration-0020.ts
   builds a pre-0020 database, plants six reactions, applies 0020 and asserts. */
{
  const seeded = await rows(
    `select a.id as noteId from annotations a where a.post_id is not null limit 1;`,
  );
  const NOTE = String(seeded[0]?.noteId ?? '');
  if (NOTE) {
    await client.batch(
      [
        { sql: `insert into annotation_reactions (annotation_id, voter_key, kind) values (?, ?, 'useful')`, args: [NOTE, 'probe-reactor-1'] },
        { sql: `insert into annotation_reactions (annotation_id, voter_key, kind) values (?, ?, 'sharp')`, args: [NOTE, 'probe-reactor-2'] },
      ],
      'write',
    );
    const total = await count('select count(*) from annotation_reactions');
    const joined = await count(`
      select count(*) from annotation_reactions r
        join annotations a on a.id = r.annotation_id;`);
    ok('reactions are present to be checked at all', total >= 2, `${total} rows`);
    eq('every reaction joins a note (0 orphans)', joined, total);
    const kept = await count(
      `select count(*) from annotation_reactions where voter_key like 'probe-reactor-%'`,
    );
    eq('both planted reactions are readable by the repo', kept, 2);
    // Clean up so the count assertions elsewhere describe the fixture, not us.
    await client.execute({ sql: `delete from annotation_reactions where voter_key like 'probe-reactor-%'` });
  }
}
eq('integrity_check clean', String((await client.execute('pragma integrity_check')).rows[0][0]), 'ok');
eq('no FK violations', (await client.execute('pragma foreign_key_check')).rows.length, 0);

/* -------------------------------------------------------------------------- */
/* 2. Writing a publication note                                               */
/* -------------------------------------------------------------------------- */

const ANON = 'probe-anon-publication';
const created = await repo.createPublicationNote({
  body: 'The publication should publish the roadmap it claims to follow.',
  anonId: ANON,
  guestName: 'Probe',
});
ok('createPublicationNote succeeds', created.ok);
if (!created.ok) {
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(1);
}
const NOTE_ID = created.id;

const emptyRejected = await repo.createPublicationNote({ body: '   ', anonId: ANON });
ok('empty publication note rejected', !emptyRejected.ok, emptyRejected.ok ? '' : emptyRejected.error);

/* -------------------------------------------------------------------------- */
/* 3. It does not leak into an article's margin                                */
/* -------------------------------------------------------------------------- */

const articleNotes = await repo.listAnnotations(POST_ID, new Map(), { currentVersionId: '' });
ok(
  'article margin excludes the publication note',
  !articleNotes.some((n) => n.id === NOTE_ID),
  `${articleNotes.length} article notes, none of them the publication note`,
);
ok(
  'every article note still carries a postId',
  articleNotes.every((n) => typeof n.postId === 'string' && n.postId === POST_ID),
);
ok(
  'every article note still carries a parsed anchor',
  articleNotes.every((n) => n.anchor && typeof n.anchor.quote === 'string'),
);

// Resolution is the part this refactor touched, so prove all three statuses
// still come out right. `makeAnchor` stores up to 64 characters of context, so
// reconstructing the original block needs left-padding to put the quote back at
// its recorded offset — otherwise the quote sits at `prefix.length` and the
// resolver correctly reports `moved` rather than `exact`.
if (articleNotes.length > 0) {
  const probe = articleNotes[0];
  const { quote, prefix, suffix, start, end } = probe.anchor;
  const pad = Math.max(0, start - prefix.length);
  const asWritten = 'x'.repeat(pad) + prefix + quote + suffix;
  const exactNote = (
    await repo.listAnnotations(POST_ID, new Map([[probe.blockId, asWritten]]), { currentVersionId: '' })
  ).find((n) => n.id === probe.id);
  eq(`anchor for ${probe.blockId} resolves 'exact' in its original context`, exactNote?.resolved.status, 'exact');
  eq('exact resolve keeps the recorded offset', exactNote?.resolved.start, start);
  eq('exact resolve keeps the recorded end', exactNote?.resolved.end, end);

  const movedNote = (
    await repo.listAnnotations(POST_ID, new Map([[probe.blockId, 'x'.repeat(5) + quote]]), {
      currentVersionId: '',
    })
  ).find((n) => n.id === probe.id);
  eq('a shifted sentence resolves ' + "'moved'", movedNote?.resolved.status, 'moved');
  eq('moved resolve reports the new offset', movedNote?.resolved.start, 5);

  const lostNote = (
    await repo.listAnnotations(POST_ID, new Map([[probe.blockId, 'nothing like the quote at all']]), {
      currentVersionId: '',
    })
  ).find((n) => n.id === probe.id);
  eq('a rewritten sentence is ' + "'lost', never reattached", lostNote?.resolved.status, 'lost');
}

const pubNotes = await repo.listPublicationAnnotations({ anonId: ANON });
ok('publication note is listed in publication scope', pubNotes.some((n) => n.id === NOTE_ID));
ok(
  'publication listing contains no article notes',
  pubNotes.every((n) => !articleNotes.some((a) => a.id === n.id)),
);

/* -------------------------------------------------------------------------- */
/* 4. Threading, reactions, reporting are inherited                            */
/* -------------------------------------------------------------------------- */

const reply = await repo.replyToAnnotation({
  parentId: NOTE_ID,
  body: 'Agreed, and the sandbox roadmap is public.',
  anonId: 'probe-anon-reply',
  authorId: null,
});
ok('reply to a publication note succeeds', reply.ok);
if (reply.ok) {
  const replyRow = await repo.getAnnotation(reply.id);
  eq('reply inherits publication scope', replyRow?.postId, null);
  ok('reply inherits no anchor', replyRow?.anchor === null);
  ok('reply records its parent', replyRow?.parentId === NOTE_ID);

  const afterReply = await repo.listPublicationAnnotations({});
  ok(
    'reply appears in publication scope',
    afterReply.some((n) => n.id === reply.id),
  );
  const articleAfterReply = await repo.listAnnotations(POST_ID, new Map(), { currentVersionId: '' });
  ok(
    'reply does not appear in article scope',
    !articleAfterReply.some((n) => n.id === reply.id),
  );
}

const voter = repo.voterKeyFor(null, ANON);
const reacted = await repo.toggleReaction(NOTE_ID, voter, 'useful');
ok('reaction on a publication note succeeds', reacted === true);
const withReaction = await repo.listPublicationAnnotations({});
eq(
  'reaction count is inherited by the publication view',
  withReaction.find((n) => n.id === NOTE_ID)?.reactions.useful,
  1,
);
ok(
  'myReactions sees it',
  (await repo.myReactions(voter, [NOTE_ID])).has(`${NOTE_ID}:useful`),
);
await repo.toggleReaction(NOTE_ID, voter, 'useful');

const reported = await repo.reportAnnotation(NOTE_ID, voter, 'probe report');
ok('publication note can be reported', reported.ok);
const reportedCount = await repo.countReportedPublicationNotes();
ok('report is counted, not silently dropped', reportedCount >= 1, `${reportedCount} awaiting a human`);

/* -------------------------------------------------------------------------- */
/* 5. Post-author authority does not extend over a publication note            */
/* -------------------------------------------------------------------------- */

eq('setNoteStatus refuses a publication note', await repo.setNoteStatus(NOTE_ID, POST_AUTHOR, 'hidden'), false);
eq('acceptAnnotation refuses a publication note', await repo.acceptAnnotation(NOTE_ID), false);
const stillVisible = await repo.getAnnotation(NOTE_ID);
eq('note was not hidden by the refused call', stillVisible?.status, 'visible');
eq('note was not accepted by the refused call', stillVisible?.isAccepted, false);

/* -------------------------------------------------------------------------- */
/* 6. A reply cannot cross scopes                                             */
/* -------------------------------------------------------------------------- */

const articleNote = articleNotes[0];
if (articleNote) {
  const crossed = await repo.createPublicationNote({
    body: 'should not attach',
    anonId: ANON,
    parentId: articleNote.id,
  });
  ok('publication reply to an article note is refused', !crossed.ok, crossed.ok ? '' : crossed.error);
}

/* -------------------------------------------------------------------------- */
/* 7. Self-moderation still works                                              */
/* -------------------------------------------------------------------------- */

eq(
  'author can soft-delete their own publication note',
  await repo.deleteAnnotation(NOTE_ID, { anonId: ANON }),
  true,
);
eq(
  'a stranger cannot delete it',
  await repo.deleteAnnotation(NOTE_ID, { anonId: 'someone-else' }),
  false,
);
eq(
  'a deleted publication note leaves the public list',
  (await repo.listPublicationAnnotations({})).some((n) => n.id === NOTE_ID),
  false,
);

/* -------------------------------------------------------------------------- */
/* 8. Claiming still works across both scopes                                  */
/* -------------------------------------------------------------------------- */

const [claimUser] = await rows(`select id from users limit 1;`);
if (claimUser?.id) {
  const claimed = await repo.createPublicationNote({ body: 'claim me', anonId: 'probe-claim' });
  if (claimed.ok) {
    const moved = await repo.claimAnonNotes('probe-claim', String(claimUser.id));
    ok('claimAnonNotes picks up publication notes', moved >= 1, `${moved} claimed`);
    const claimedRow = await repo.getAnnotation(claimed.id);
    eq('claimed publication note keeps publication scope', claimedRow?.postId, null);
    eq('claimed note now has an author', claimedRow?.authorId, String(claimUser.id));
    await client.execute({ sql: `delete from annotations where id = ?`, args: [claimed.id] });
  }
}

/* -------------------------------------------------------------------------- */

console.log(`\n${passed} passed, ${failed} failed\n`);

client.close();
// Best effort: a native libsql handle may still hold the file briefly on Windows.
for (const suffix of ['', '-journal', '-wal', '-shm']) {
  try {
    fs.rmSync(`${scratch}${suffix}`, { force: true });
  } catch {
    /* the OS will clear %TEMP% eventually; do not fail the run over it */
  }
}

process.exit(failed === 0 ? 0 : 1);