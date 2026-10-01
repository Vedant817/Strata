import { sql } from 'drizzle-orm';
import { readyDb } from '../src/lib/db/index';

const db = await readyDb();
const posts = await db.run(sql`select id, slug from posts where slug like '%p99%'`);
const post = (posts.rows[0] ?? {}) as { id: string; slug: string };
console.log('POST', post.slug, post.id);

const hl = await db.run(
  sql`select id, block_id, text, anon_id, created_at from highlights where post_id = ${post.id} order by created_at desc limit 8`,
);
console.log('HIGHLIGHT ROWS:', hl.rows.length);
for (const r of hl.rows as Array<Record<string, unknown>>) {
  console.log(' -', String(r.id).slice(0, 8), '| block:', String(r.block_id).slice(0, 16), '| text:', JSON.stringify(String(r.text).slice(0, 42)), '| anon:', String(r.anon_id ?? 'null').slice(0, 10));
}
