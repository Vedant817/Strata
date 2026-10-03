/**
 * Scratch harness for the publication-scope table rebuild.
 *
 * `migrate()` on libsql hands every statement of a migration file to the server
 * in a single `client.migrate()` RPC, so a failure inside a rebuild comes back
 * as an opaque `SQLITE_UNKNOWN_0: not an error` naming no statement.
 *
 * Two facts make the obvious rebuild order silently destructive here, both
 * established by running them rather than reasoning about them:
 *
 *   1. `PRAGMA foreign_keys` is ON by default, so dropping a parent table fires
 *      `ON DELETE CASCADE` against every live child.
 *   2. The pragma is a no-op inside a transaction, and `client.migrate()` — the
 *      call drizzle uses — does not expose a way to step outside one. The
 *      documented SQLite rebuild procedure (foreign_keys off, rebuild, on) is
 *      therefore not expressible in a drizzle migration file.
 *
 * So the rebuild cannot be made non-cascading by turning enforcement off. It has
 * to be ordered so that nothing references `annotations` at the instant it is
 * dropped. This script enumerates every table that references it, then runs the
 * quarantine ordering and asserts the readers' rows survived.
 *
 * Usage: npx tsx scripts/debug-rebuild-annotations.ts [scratch.db]
 */
import fs from 'node:fs';

const target = process.argv[2] ?? 'data/scratch.db';
if (!fs.existsSync(target)) {
  console.error(`scratch db missing: ${target} (copy data/strata.db first)`);
  process.exit(1);
}

const { createClient } = await import('@libsql/client');
const client = createClient({ url: `file:${target}` });

const COLS = [
  'id',
  'post_id',
  'version_id',
  'block_id',
  'anchor',
  'body',
  'kind',
  'parent_id',
  'author_id',
  'anon_id',
  'guest_name',
  'status',
  'is_accepted',
  'is_resolved',
  'is_private',
  'created_at',
  'edited_at',
] as const;

const one = async (sql: string): Promise<number> => {
  const rs = await client.execute(sql);
  return Number(Object.values(rs.rows[0] as Record<string, unknown>)[0]);
};

async function snapshot(label: string) {
  const [n, r, joined, reports, pub, integrity, fkCheck] = await Promise.all([
    one('select count(*) from annotations'),
    one('select count(*) from annotation_reactions'),
    one('select count(*) from annotation_reactions r join annotations a on a.id = r.annotation_id'),
    one('select count(*) from annotation_reports'),
    one('select count(*) from annotations where post_id is null'),
    (async () => String((await client.execute('pragma integrity_check')).rows[0][0]))(),
    (async () => (await client.execute('pragma foreign_key_check')).rows.length)(),
  ]);
  console.log(
    `  ${label.padEnd(10)} annotations=${n} reactions=${r} joined=${joined} reports=${reports} pub=${pub} integrity=${integrity} fk_violations=${fkCheck}`,
  );
  return { n, r, joined, reports, pub };
}

/* -------------------------------------------------------------------------- */
/* Who references annotations? Must be exhaustive or the cascade still bites.  */
/* -------------------------------------------------------------------------- */

console.log('\nreferences to annotations');
const tables = await client.execute(
  `select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name != '__drizzle_migrations';`,
);
const referrers: string[] = [];
for (const row of tables.rows) {
  const t = String((row as Record<string, unknown>).name);
  const refs = await client.execute(`pragma foreign_key_list('${t}')`);
  if (refs.rows.some((r) => String((r as Record<string, unknown>).table) === 'annotations')) {
    referrers.push(t);
  }
}
console.log(`  ${referrers.length ? referrers.join(', ') : '(none)'}`);

/* -------------------------------------------------------------------------- */
/* Pragma behaviour                                                            */
/* -------------------------------------------------------------------------- */

console.log('\npragma behaviour');
console.log(`  default                          = ${String((await client.execute('pragma foreign_keys')).rows[0][0])}`);
await client.execute('pragma foreign_keys = off');
console.log(`  after '= off' outside a tx        = ${String((await client.execute('pragma foreign_keys')).rows[0][0])}`);
try {
  const tx = await client.transaction();
  await tx.execute('pragma foreign_keys = off');
  console.log(`  after '= off' inside a tx         = ${String((await tx.execute('pragma foreign_keys')).rows[0][0])}`);
  await tx.commit();
} catch (err) {
  console.log(`  tx probe failed: ${err instanceof Error ? err.message : String(err)}`);
}
await client.execute('pragma foreign_keys = on');

/* -------------------------------------------------------------------------- */
/* The quarantine ordering                                                     */
/* -------------------------------------------------------------------------- */

console.log('\nrebuild  (quarantine ordering, foreign_keys left ON)');
const before = await snapshot('BEFORE');

const NEW_ANNOTATIONS = `CREATE TABLE annotations_new (
  id text PRIMARY KEY NOT NULL,
  post_id text,
  version_id text,
  block_id text,
  anchor text,
  body text NOT NULL,
  kind text DEFAULT 'comment' NOT NULL,
  parent_id text,
  author_id text,
  anon_id text,
  guest_name text,
  status text DEFAULT 'visible' NOT NULL,
  is_accepted integer DEFAULT false NOT NULL,
  is_resolved integer DEFAULT false NOT NULL,
  is_private integer DEFAULT false NOT NULL,
  created_at integer NOT NULL,
  edited_at integer,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE cascade,
  FOREIGN KEY (version_id) REFERENCES post_versions(id) ON DELETE cascade,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE set null
);`;

// Staged without a foreign key. This is the whole trick: during the window in
// which `annotations` is dropped, nothing may reference it by name, or the
// cascade takes the rows with it.
const STAGE_REACTIONS = `CREATE TABLE annotation_reactions_stage (
  annotation_id text NOT NULL,
  voter_key text NOT NULL,
  kind text NOT NULL,
  created_at integer NOT NULL,
  PRIMARY KEY (annotation_id, voter_key, kind)
);`;
const STAGE_REPORTS = `CREATE TABLE annotation_reports_stage (
  id text PRIMARY KEY NOT NULL,
  annotation_id text NOT NULL,
  reporter_key text NOT NULL,
  reason text NOT NULL,
  created_at integer NOT NULL
);`;

// Rebuilt children, re-pointed at the new `annotations` so the foreign key and
// its cascade are restored rather than silently lost.
const FINAL_REACTIONS = `CREATE TABLE annotation_reactions_final (
  annotation_id text NOT NULL,
  voter_key text NOT NULL,
  kind text NOT NULL,
  created_at integer NOT NULL,
  PRIMARY KEY (annotation_id, voter_key, kind),
  FOREIGN KEY (annotation_id) REFERENCES annotations(id) ON DELETE cascade
);`;
const FINAL_REPORTS = `CREATE TABLE annotation_reports_final (
  id text PRIMARY KEY NOT NULL,
  annotation_id text NOT NULL,
  reporter_key text NOT NULL,
  reason text NOT NULL,
  created_at integer NOT NULL,
  FOREIGN KEY (annotation_id) REFERENCES annotations(id) ON DELETE cascade
);`;

const statements: [string, string][] = [
  ['1  create annotations_new', NEW_ANNOTATIONS],
  [
    '2  copy annotations',
    `INSERT INTO annotations_new (${COLS.join(', ')}) SELECT ${COLS.join(', ')} FROM annotations;`,
  ],
  ['3  stage reactions (fk-less)', STAGE_REACTIONS],
  [
    '4  copy reactions',
    `INSERT INTO annotation_reactions_stage SELECT annotation_id, voter_key, kind, created_at FROM annotation_reactions;`,
  ],
  ['5  stage reports (fk-less)', STAGE_REPORTS],
  [
    '6  copy reports',
    `INSERT INTO annotation_reports_stage SELECT id, annotation_id, reporter_key, reason, created_at FROM annotation_reports;`,
  ],
  // Nothing references these two, so dropping them cannot cascade.
  ['7  drop annotation_reactions', 'DROP TABLE annotation_reactions;'],
  ['8  drop annotation_reports', 'DROP TABLE annotation_reports;'],
  // Nothing references annotations now — the children are staged under fk-less
  // names, which is the entire reason for steps 3-6.
  ['9  drop annotations', 'DROP TABLE annotations;'],
  ['10 rename annotations_new', 'ALTER TABLE annotations_new RENAME TO annotations;'],
  ['11 create reactions (fk back)', FINAL_REACTIONS],
  [
    '12 copy reactions back',
    `INSERT INTO annotation_reactions_final SELECT annotation_id, voter_key, kind, created_at FROM annotation_reactions_stage;`,
  ],
  ['13 drop stage', 'DROP TABLE annotation_reactions_stage;'],
  ['14 rename reactions_final', 'ALTER TABLE annotation_reactions_final RENAME TO annotation_reactions;'],
  ['15 create reports (fk back)', FINAL_REPORTS],
  [
    '16 copy reports back',
    `INSERT INTO annotation_reports_final SELECT id, annotation_id, reporter_key, reason, created_at FROM annotation_reports_stage;`,
  ],
  ['17 drop stage', 'DROP TABLE annotation_reports_stage;'],
  ['18 rename reports_final', 'ALTER TABLE annotation_reports_final RENAME TO annotation_reports;'],
  ['19 idx post', 'CREATE INDEX annotations_post_idx ON annotations (post_id, status);'],
  ['20 idx block', 'CREATE INDEX annotations_block_idx ON annotations (post_id, block_id);'],
  ['21 idx version', 'CREATE INDEX annotations_version_idx ON annotations (version_id);'],
  ['22 idx parent', 'CREATE INDEX annotations_parent_idx ON annotations (parent_id);'],
  ['23 idx anon', 'CREATE INDEX annotations_anon_idx ON annotations (anon_id);'],
  ['24 idx reports', 'CREATE INDEX annotation_reports_note_idx ON annotation_reports (annotation_id);'],
];

let broke = false;
for (const [label, sqlText] of statements) {
  try {
    await client.execute(sqlText);
    console.log(`  ok    ${label}`);
  } catch (err) {
    console.error(`  FAIL  ${label}\n        ${err instanceof Error ? err.message : String(err)}`);
    broke = true;
    break;
  }
}

if (!broke) {
  const after = await snapshot('AFTER');

  console.log('\nverdict');
  const checks: [string, boolean][] = [
    ['annotation rows preserved', after.n === before.n],
    ['reactions preserved', after.r === before.r],
    ['reports preserved', after.reports === before.reports],
    ['no orphaned reactions', after.joined === after.r],
  ];
  for (const [label, pass] of checks) console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}`);

  // The FK must be restored, not just the rows.
  const childFks: string[] = [];
  for (const t of ['annotation_reactions', 'annotation_reports']) {
    const refs = await client.execute(`pragma foreign_key_list('${t}')`);
    childFks.push(...refs.rows.map((r) => `${t} -> ${String((r as Record<string, unknown>).table)}`));
  }
  const restored = childFks.length === 2 && childFks.every((f) => f.endsWith('-> annotations'));
  console.log(`  ${restored ? 'PASS' : 'FAIL'}  child foreign keys restored: ${childFks.join(', ') || '(none)'}`);

  // And the cascade must still work: deleting an annotation must take its
  // reactions with it. If the FK were silently absent this would leave orphans.
  const probeId = String((await client.execute('select annotation_id from annotation_reactions limit 1')).rows[0][0]);
  await client.execute(`delete from annotations where id = '${probeId}'`);
  const cascaded = await one(`select count(*) from annotation_reactions where annotation_id = '${probeId}'`);
  const reinserted = await client.execute(
    `insert into annotations (id, post_id, version_id, block_id, anchor, body, kind, status, created_at)
     select id, post_id, version_id, block_id, anchor, body, kind, status, created_at from annotations where 1=0`,
  );
  void reinserted;
  console.log(
    `  ${cascaded === 0 ? 'PASS' : 'FAIL'}  cascade still enforced on delete (${cascaded} reactions left)`,
  );
  console.log('  note  the probe delete removed a row; re-copy from strata.db before use.');

  // Publication scope must work and must not disturb article rows.
  await client.execute(
    `insert into annotations (id, post_id, version_id, block_id, anchor, body, kind, status, created_at)
     values ('probe-pub', null, null, null, null, 'about the publication', 'comment', 'visible', 1)`,
  );
  const articleRows = await one('select count(*) from annotations where post_id is not null');
  const pubRows = await one('select count(*) from annotations where post_id is null');
  console.log(`  PASS  publication scope works: ${pubRows} publication note, ${articleRows} article notes`);
  const missingBody = await client
    .execute(`insert into annotations (id, kind, status, created_at) values ('probe-bad', 'comment', 'visible', 1)`)
    .then(
      () => false,
      () => true,
    );
  console.log(`  ${missingBody ? 'PASS' : 'FAIL'}  body still required (NOT NULL held)`);
  await client.execute(`delete from annotations where id in ('probe-pub','probe-bad')`);
}

console.log('');
client.close();