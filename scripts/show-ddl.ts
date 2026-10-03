/** Print the exact DDL the rebuild must reproduce. */
import fs from 'node:fs';

const target = process.argv[2] ?? 'data/scratch.db';
if (!fs.existsSync(target)) {
  console.error(`scratch db missing: ${target}`);
  process.exit(1);
}

const { createClient } = await import('@libsql/client');
const client = createClient({ url: `file:${target}` });

const rs = await client.execute(
  `select name, sql from sqlite_master where name in ('annotations','annotation_reactions','annotation_reports')
    order by case name when 'annotations' then 0 when 'annotation_reactions' then 1 else 2 end;`,
);
for (const row of rs.rows) {
  const r = row as Record<string, unknown>;
  console.log(`--- ${String(r.name)}`);
  console.log(String(r.sql));
  console.log('');
}

// Indexes that must exist afterwards.
const idx = await client.execute(
  `select name, tbl_name, sql from sqlite_master where type='index' and tbl_name in ('annotations','annotation_reactions','annotation_reports')
    and sql is not null order by tbl_name, name;`,
);
console.log('--- explicit indexes');
for (const row of idx.rows) console.log(String((row as Record<string, unknown>).sql));

client.close();