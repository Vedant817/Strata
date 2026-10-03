/**
 * Rehearsal for migration 0020 (publication-scope annotations).
 *
 * Why this exists as its own script: the only way to know that the table
 * rebuild did not delete every reaction a reader ever left is to run the
 * rebuild against a database that actually has reactions in it. The dev
 * database usually has none — nothing seeds them — so an assertion like
 * "reactions survived" reads green on 0 rows and proves nothing. That is the
 * false pass this file exists to make impossible.
 *
 * So the fixture is built from scratch: migrations 0000-0019 are applied to a
 * throwaway file, a reader's reactions and reports are inserted by hand, and
 * 0020 is then applied to *that*. Nothing here depends on local dev data, and
 * nothing touches the dev database.
 *
 * What it asserts, in order:
 *   1. the pre-state really is the old schema (post_id NOT NULL);
 *   2. rows survive - the same ids, counts and the join;
 *   3. no orphans, and integrity_check/foreign_key_check are clean;
 *   4. the new capability works (a note with post_id NULL is accepted);
 *   5. the *deleted* property is still enforced - a reaction for a note that
 *      does not exist is refused, and deleting a post still cascades to its
 *      notes and their reactions. A rebuild that quietly dropped the child
 *      foreign keys would pass every count-based assertion above and only
 *      fail here.
 *
 * Run: npx tsx scripts/check-migration-0020.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, type Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const drizzleDir = path.join(projectRoot, 'drizzle');

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

const JOURNAL = path.join(drizzleDir, 'meta', '_journal.json');
const TAG = '0020_publication_scope_annotations';

type Journal = { entries: Array<{ idx: number; version: string; when: number; tag: string }> };
const journal = JSON.parse(fs.readFileSync(JOURNAL, 'utf8')) as Journal;
const entry = journal.entries.find((e) => e.tag === TAG);
if (!entry) {
  console.error(`${TAG} is not in the journal — the rehearsal has nothing to apply.`);
  process.exit(1);
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'strata-migrate-0020-'));
const scratchDb = path.join(tmpRoot, 'rehearsal.db');

/**
 * A drizzle migration folder containing only the tags in `keep`, with the
 * journal trimmed to match. Applied through the same migrator the app uses, so
 * the rehearsal exercises the real path — including the single RPC that the
 * migration's own comment says `PRAGMA foreign_keys = off` does not survive.
 */
function migrationDir(keep: (tag: string) => boolean, name: string): string {
  const dir = path.join(tmpRoot, name);
  fs.mkdirSync(path.join(dir, 'meta'), { recursive: true });
  const entries = [];
  for (const e of journal.entries) {
    if (!keep(e.tag)) continue;
    entries.push(e);
    fs.copyFileSync(path.join(drizzleDir, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
  }
  fs.writeFileSync(
    path.join(dir, 'meta', '_journal.json'),
    JSON.stringify({ version: '7', dialect: 'sqlite', entries }, null, 2),
  );
  return dir;
}

/** Apply a folder through drizzle, and report how many statements ran. */
async function apply(client: Client, dir: string): Promise<void> {
  await migrate(drizzle(client), { migrationsFolder: dir });
}

async function scalar(c: Client, sql: string): Promise<unknown> {
  const rs = await c.execute(sql);
  return rs.rows[0] ? Object.values(rs.rows[0] as Record<string, unknown>)[0] : undefined;
}
const count = async (c: Client, sql: string) => Number(await scalar(c, sql));

async function columnIsNotNull(c: Client, table: string, column: string): Promise<boolean> {
  const rs = await c.execute(`pragma table_info(${table})`);
  const row = rs.rows.find((r) => String((r as Record<string, unknown>).name) === column);
  return Number((row as Record<string, unknown> | undefined)?.notnull ?? 0) === 1;
}

/** Execute and report whether it was refused. Used for the enforcement checks. */
async function refused(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    ok(label, false, 'the statement was accepted');
  } catch (err) {
    ok(label, true, String((err as Error).message).slice(0, 90));
  }
}

console.log('\nmigration 0020 rehearsal');
console.log(`  scratch database: ${scratchDb}\n`);

const client = createClient({ url: `file:${scratchDb}` });

try {
  /* ---------------------------------------------------------------------- */
  /* 1. The old schema, for real                                            */
  /* ---------------------------------------------------------------------- */

  await apply(client, migrationDir((t) => t !== TAG, 'before'));

  ok(
    'pre-state: annotations.post_id is NOT NULL (so this is the old schema)',
    await columnIsNotNull(client, 'annotations', 'post_id'),
  );

  /* ---------------------------------------------------------------------- */
  /* 2. A reader's data to lose                                              */
  /* ---------------------------------------------------------------------- */

  const now = 1_700_000_000_000;
  await client.batch(
    [
      `insert into users (id, email, handle, display_name, created_at) values ('u1','a@b.c','reader1','Reader One',${now})`,
      `insert into users (id, email, handle, display_name, created_at) values ('u2','d@e.f','reader2','Reader Two',${now})`,
      `insert into posts (id, slug, title, author_id, status, visibility, created_at, updated_at) values ('p1','rehearsal','Rehearsal','u1','published','public',${now},${now})`,
      `insert into post_versions (id, post_id, version_number, body, author_id, created_at, is_major) values ('v1','p1',1,'body','u1',${now},1)`,
      `insert into annotations (id, post_id, version_id, block_id, anchor, body, created_at) values ('a1','p1','v1','b1','q1','first note',${now})`,
      `insert into annotations (id, post_id, version_id, block_id, anchor, body, created_at) values ('a2','p1','v1','b1','q2','second note',${now})`,
      `insert into annotations (id, post_id, version_id, block_id, anchor, body, created_at) values ('a3','p1','v1','b2','q3','third note',${now})`,
      // Six reactions across two notes and three kinds, so a partial loss is
      // visible: 3 useful on a1, 2 useful + 1 sharp on a2.
      `insert into annotation_reactions (annotation_id, voter_key, kind, created_at) values ('a1','u1','useful',${now})`,
      `insert into annotation_reactions (annotation_id, voter_key, kind, created_at) values ('a1','u2','useful',${now})`,
      `insert into annotation_reactions (annotation_id, voter_key, kind, created_at) values ('a1','anon:1','useful',${now})`,
      `insert into annotation_reactions (annotation_id, voter_key, kind, created_at) values ('a2','u1','useful',${now})`,
      `insert into annotation_reactions (annotation_id, voter_key, kind, created_at) values ('a2','anon:2','useful',${now})`,
      `insert into annotation_reactions (annotation_id, voter_key, kind, created_at) values ('a2','u1','sharp',${now})`,
      `insert into annotation_reports (id, annotation_id, reporter_key, reason, created_at) values ('r1','a1','anon:3','spam',${now})`,
      `insert into annotation_reports (id, annotation_id, reporter_key, reason, created_at) values ('r2','a3','anon:4','abuse',${now})`,
    ].map((sql) => ({ sql })),
    'write',
  );

  const before = {
    annotations: await count(client, 'select count(*) from annotations'),
    reactions: await count(client, 'select count(*) from annotation_reactions'),
    joined: await count(
      client,
      'select count(*) from annotation_reactions r join annotations a on a.id = r.annotation_id',
    ),
    reports: await count(client, 'select count(*) from annotation_reports'),
  };
  eq('fixture: 3 annotations', before.annotations, 3);
  eq('fixture: 6 reactions', before.reactions, 6);
  eq('fixture: all 6 reactions join a note', before.joined, 6);
  eq('fixture: 2 reports', before.reports, 2);

  /* ---------------------------------------------------------------------- */
  /* 3. The rebuild                                                         */
  /* ---------------------------------------------------------------------- */

  await apply(client, migrationDir((t) => t === TAG, 'after'));

  ok('post-state: annotations.post_id is nullable', !(await columnIsNotNull(client, 'annotations', 'post_id')));
  eq('every annotation survived', await count(client, 'select count(*) from annotations'), 3);
  eq('every reaction survived', await count(client, 'select count(*) from annotation_reactions'), 6);
  eq(
    'every reaction still joins a note (0 orphans)',
    await count(
      client,
      'select count(*) from annotation_reactions r join annotations a on a.id = r.annotation_id',
    ),
    6,
  );
  eq(
    'every reaction kept its kind and voter',
    await count(
      client,
      "select count(*) from annotation_reactions where (annotation_id='a2' and kind='sharp' and voter_key='u1') or (annotation_id='a1' and kind='useful' and voter_key='anon:1')",
    ),
    2,
  );
  eq('every report survived', await count(client, 'select count(*) from annotation_reports'), 2);
  eq(
    'every report still joins a note (0 orphans)',
    await count(client, 'select count(*) from annotation_reports r join annotations a on a.id = r.annotation_id'),
    2,
  );
  eq('note ids are unchanged', await count(client, "select count(*) from annotations where id in ('a1','a2','a3')"), 3);
  eq(
  'article scope kept its post_id',
  await scalar(client, "select post_id from annotations where id = 'a1'"),
  'p1',
);

  const leftovers = await client.execute(
    `select name from sqlite_master where name in ('annotations_new','annotation_reactions_stage','annotation_reports_stage','annotation_reactions_final','annotation_reports_final')`,
  );
  eq('no staging table was left behind', leftovers.rows.length, 0);

  eq('pragma integrity_check is clean', String(await scalar(client, 'pragma integrity_check')).trim(), 'ok');
  eq('pragma foreign_key_check finds no violations', (await client.execute('pragma foreign_key_check')).rows.length, 0);

  /* ---------------------------------------------------------------------- */
  /* 4. The capability the migration exists for                              */
  /* ---------------------------------------------------------------------- */

  await client.execute({
    sql: `insert into annotations (id, post_id, version_id, block_id, anchor, body, created_at) values ('a4',null,null,null,null,'about the publication',${now})`,
  });
  eq('a note with no post_id is accepted', await count(client, "select count(*) from annotations where id = 'a4'"), 1);
  eq(
    'the article index still excludes it',
    await count(client, "select count(*) from annotations where post_id = 'p1' and id = 'a4'"),
    0,
  );

  /* ---------------------------------------------------------------------- */
  /* 5. What the rebuild must not have quietly removed                       */
  /* ---------------------------------------------------------------------- */

  await refused('a reaction for a note that does not exist is still refused', () =>
    client.execute("insert into annotation_reactions (annotation_id, voter_key, kind) values ('nope','u1','useful')"),
  );
  await refused('a note for a post that does not exist is still refused', () =>
    client.execute({
      sql: `insert into annotations (id, post_id, version_id, block_id, anchor, body) values ('a5','nope','v1','b1','q','x')`,
    }),
  );

  // Cascade is the property that silently degrades when a rebuild re-points the
  // foreign keys at a table that no longer exists. Deleting the post must take
  // its notes, and their reactions, with it - and must NOT take the
  // publication note, which belongs to no post.
  await client.execute("delete from posts where id = 'p1'");
  eq('deleting a post still cascades to its notes', await count(client, 'select count(*) from annotations where post_id = \'p1\''), 0);
  eq(
    'and to their reactions',
    await count(client, 'select count(*) from annotation_reactions where annotation_id in (\'a1\',\'a2\',\'a3\')'),
    0,
  );
  eq(
    'and to their reports',
    await count(client, 'select count(*) from annotation_reports where annotation_id in (\'a1\',\'a2\',\'a3\')'),
    0,
  );
  eq(
    'the publication note survives a post deletion',
    await count(client, "select count(*) from annotations where id = 'a4'"),
    1,
  );
} finally {
  client.close();
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    try {
      fs.rmSync(`${scratchDb}${suffix}`, { force: true });
    } catch {
      /* Windows can hold the handle briefly; TEMP gets cleaned eventually. */
    }
  }
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* as above */
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);