/**
 * Annotation store invariants.
 *
 * The marginalia system is the one place in this product where a reader's words
 * live, so the table itself has to be provably intact. `annotations.post_id` is
 * nullable to express *publication scope* — a note about the publication rather
 * than an article — which means a careless table rebuild could silently drop
 * every reaction anyone has ever left on a comment.
 *
 * That is exactly what almost happened: rebuilding the table by renaming before
 * dropping made SQLite rewrite the foreign keys in `annotation_reactions` and
 * `annotation_reports` onto the renamed table, and the follow-up DROP cascaded
 * every reaction away. Counts alone can read green if you do not join, so this
 * asserts the join explicitly.
 *
 * Run: npx tsx scripts/check-annotation-invariants.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');

/* -------------------------------------------------------------------------- */
/* Assertions                                                                  */
/* -------------------------------------------------------------------------- */

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

function eq(label: string, actual: unknown, expected: unknown) {
  ok(label, Object.is(actual, expected), `got ${String(actual)}, want ${String(expected)}`);
}

/* -------------------------------------------------------------------------- */
/* Connection                                                                  */
/* -------------------------------------------------------------------------- */

const url = process.env.DATABASE_URL ?? 'file:./data/strata.db';

if (url.startsWith('file:')) {
  const file = url.replace(/^file:/, '');
  const dir = path.isAbsolute(file) ? path.dirname(file) : path.resolve(projectRoot, path.dirname(file));
  fs.mkdirSync(dir, { recursive: true });
}

const { createClient } = await import('@libsql/client');
const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });

/** Scalar count from a SELECT, for assertions and reporting. */
async function count(sql: string): Promise<number> {
  const rs = await client.execute(sql);
  const row = rs.rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error(`no row returned for: ${sql}`);
  const v = Object.values(row)[0];
  return typeof v === 'bigint' ? Number(v) : Number(v);
}

async function scalar(sql: string): Promise<string> {
  const rs = await client.execute(sql);
  const row = rs.rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error(`no row returned for: ${sql}`);
  return String(Object.values(row)[0]);
}

console.log('\nannotation store invariants');
console.log(`  ${url.replace(/\/\/[^@/]*@/, '//<redacted>@')}\n`);

/* -------------------------------------------------------------------------- */
/* 1. Integrity                                                                */
/* -------------------------------------------------------------------------- */

eq('pragma integrity_check is clean', (await scalar('pragma integrity_check;')).trim(), 'ok');

/* -------------------------------------------------------------------------- */
/* 2. Child rows are not orphaned                                              */
/* -------------------------------------------------------------------------- */

const annotations = await count('select count(*) from annotations;');
const reactions = await count('select count(*) from annotation_reactions;');
const reports = await count('select count(*) from annotation_reports;');

// The load-bearing assertion. A DROP/RENAME in the wrong order keeps the
// reaction *rows* and simply re-points the foreign key at a table that no
// longer has them, so only a join can catch it.
const joinedReactions = await count(`
  select count(*) from annotation_reactions r
    join annotations a on a.id = r.annotation_id;`);
eq('every reaction joins an annotation (0 orphans)', joinedReactions, reactions);

const joinedReports = await count(`
  select count(*) from annotation_reports r
    join annotations a on a.id = r.annotation_id;`);
eq('every report joins an annotation (0 orphans)', joinedReports, reports);

/* -------------------------------------------------------------------------- */
/* 3. Referential sanity of the nullable publication scope                      */
/* -------------------------------------------------------------------------- */

const scopes = await count('select count(*) from annotations where post_id is null;');
console.log(`  note  ${annotations} annotations (${scopes} publication-scoped), ${reactions} reactions, ${reports} reports`);

// The nullable-post design only holds if the two scopes stay mutually exclusive:
// every article note must still point at a live post, and every publication note
// must point at no post and no version.
const articleNotesWithoutPost = await count(`
  select count(*) from annotations a
    left join posts p on p.id = a.post_id
   where a.post_id is not null and p.id is null;`);
eq('no article-scoped note points at a missing post', articleNotesWithoutPost, 0);

const publicationNotesWithVersion = await count(`
  select count(*) from annotations where post_id is null and version_id is not null;`);
eq('no publication-scoped note claims a version', publicationNotesWithVersion, 0);

const publicationNotesWithAnchor = await count(`
  select count(*) from annotations where post_id is null and anchor is not null;`);
eq('no publication-scoped note claims a text anchor', publicationNotesWithAnchor, 0);

// Replies inherit scope from their parent. A publication thread that had drifted
// onto an article would be the subtlest possible leak.
const scopeDrift = await count(`
  select count(*) from annotations child
    join annotations parent on parent.id = child.parent_id
   where (child.post_id is null) <> (parent.post_id is null);`);
eq('replies never drift out of their parent scope', scopeDrift, 0);

/* -------------------------------------------------------------------------- */
/* 4. Indexes exist                                                            */
/* -------------------------------------------------------------------------- */

const idxRows = await client.execute(
  `select name from sqlite_master where type = 'index' and tbl_name = 'annotations';`,
);
const idxNames = new Set(idxRows.rows.map((r) => String((r as Record<string, unknown>).name)));
for (const expected of [
  'annotations_post_idx',
  'annotations_block_idx',
  'annotations_version_idx',
  'annotations_parent_idx',
  'annotations_anon_idx',
]) {
  ok(`index ${expected} exists`, idxNames.has(expected));
}

// Publication-scope reads filter on `post_id is null`, which the composite
// (post_id, status) index serves. Assert the index is still keyed that way
// rather than trusting that it was recreated identically.
const postIdxCols = await client.execute(
  `select name from pragma_index_info('annotations_post_idx');`,
);
const cols = postIdxCols.rows.map((r) => String((r as Record<string, unknown>).name));
ok(
  'annotations_post_idx is keyed (post_id, status)',
  cols[0] === 'post_id' && cols[1] === 'status',
  `got [${cols.join(', ')}]`,
);

/* -------------------------------------------------------------------------- */
/* 5. The nullable publication scope exists, and only where it should           */
/* -------------------------------------------------------------------------- */

const notNulls = new Set(
  (
    await client.execute(
      `select name from pragma_table_info('annotations') where "notnull" = 1;`,
    )
  ).rows.map((r) => String((r as Record<string, unknown>).name)),
);
for (const column of ['post_id', 'version_id', 'block_id', 'anchor']) {
  ok(`${column} is nullable (publication scope)`, !notNulls.has(column));
}
// The rebuild must not have quietly relaxed anything else.
for (const column of ['id', 'body', 'kind', 'status', 'created_at']) {
  ok(`${column} is still NOT NULL`, notNulls.has(column));
}

// No staging or rebuild leftovers. If a migration half-ran, these are the
// artefacts, and they would sit in the database silently.
const tables = new Set(
  (
    await client.execute(
      `select name from sqlite_master where type='table' and name not like 'sqlite_%';`,
    )
  ).rows.map((r) => String((r as Record<string, unknown>).name)),
);
for (const leftover of ['annotations_new', 'annotation_reactions_stage', 'annotation_reports_stage']) {
  ok(`no leftover table ${leftover}`, !tables.has(leftover));
}

// The child foreign keys must still exist. Losing them would not fail
// integrity_check; it would just quietly stop cascading on post deletion.
for (const child of ['annotation_reactions', 'annotation_reports']) {
  const refs = await client.execute(`pragma foreign_key_list('${child}')`);
  const pointsAtAnnotations = refs.rows.some(
    (r) => String((r as Record<string, unknown>).table) === 'annotations',
  );
  ok(`${child} still cascades from annotations`, pointsAtAnnotations);
}

// created_at must keep its default, or any insert that omits it fails. This is
// easy to drop in a hand-written CREATE TABLE and typechecks perfectly.
const ddl = String(
  (
    await client.execute(`select sql from sqlite_master where type='table' and name='annotations';`)
  ).rows[0]?.sql ?? '',
);
ok('created_at keeps its default', /created_at[^,]*DEFAULT/i.test(ddl));

/* -------------------------------------------------------------------------- */

console.log(`\n${passed} passed, ${failed} failed\n`);
client.close();
process.exit(failed === 0 ? 0 : 1);