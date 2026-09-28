import { eq, sql } from 'drizzle-orm';
import { readyDb } from '../db';
import { posts, postVersions } from '../db/schema';
import { blockToPlainText, parseBody } from '../blocks';

export interface SearchHit {
  slug: string;
  title: string;
  dek: string;
  status: 'seedling' | 'budding' | 'evergreen' | 'archived';
  /** HTML fragment with `<mark>` around the matched span. Safe to render: the
   *  indexed text is plain prose, so the only markup present is our own. */
  snippet: string;
}

/**
 * Search over the canon.
 *
 * SQLite FTS5, porter stemming, rank-ordered. The reader types words; they must
 * never be able to type FTS syntax, so every term is quoted and the only
 * operator left is the implicit AND. The final term gets a prefix wildcard so
 * a half-typed thought still finds its post.
 */
/** Quoted FTS terms from free text, safe to interpolate into MATCH. Exported
 *  so link suggestions use the same sanitization as search itself. */
export function toFtsQuery(raw: string): string | null {
  const terms = raw
    .split(/\s+/)
    .map((t) => t.replace(/["*]/g, '').trim())
    .filter((t) => t.length > 0)
    .slice(0, 10);
  if (terms.length === 0) return null;
  return terms
    .map((t, i) => (i === terms.length - 1 && t.length >= 3 ? `"${t}"*` : `"${t}"`))
    .join(' ');
}

interface FtsRow {
  slug: string;
  title: string;
  dek: string;
  status: SearchHit['status'];
  snippet: string;
}

export async function searchPosts(raw: string, limit = 20): Promise<SearchHit[]> {
  // Mirrors the form's minlength. A single letter matches nearly everything
  // through stemming, which is noise rather than an answer.
  if (raw.trim().length < 2) return [];
  const query = toFtsQuery(raw);
  if (!query) return [];
  const database = await readyDb();
  const rows = await database.all<FtsRow>(sql`
    SELECT f.slug AS slug, f.title AS title, f.dek AS dek, p.status AS status,
      snippet(post_fts, 2, '<mark>', '</mark>', '…', 28) AS snippet
    FROM post_fts f
    INNER JOIN posts p ON p.slug = f.slug
    WHERE post_fts MATCH ${query}
      AND p.visibility = 'public'
      AND p.published_at IS NOT NULL
    ORDER BY rank
    LIMIT ${limit}
  `);
  return rows.map((r) => ({ slug: r.slug, title: r.title, dek: r.dek, status: r.status, snippet: r.snippet }));
}

/**
 * Rebuild the index from the current version of every visible post.
 *
 * Fills both `post_fts` (which post) and `block_fts` (which sentence — Ask
 * needs block scope, and a post-level index cannot promise that a passage
 * came from *this* post). Called after seeding and after any publish, because
 * the indexed body is a projection of typed-block JSON into plain text and
 * only application code knows how to make that projection. Returns the number
 * of posts indexed so the caller can say so honestly instead of assuming it
 * worked.
 */
export async function rebuildSearchIndex(): Promise<number> {
  const database = await readyDb();
  const rows = await database
    .select({
      postId: posts.id,
      slug: posts.slug,
      title: posts.title,
      dek: posts.dek,
      body: postVersions.body,
    })
    .from(posts)
    .innerJoin(postVersions, eq(posts.currentVersionId, postVersions.id))
    .where(eq(posts.visibility, 'public'));

  await database.run(sql`DELETE FROM post_fts`);
  await database.run(sql`DELETE FROM block_fts`);
  for (const row of rows) {
    const parsed = parseBody(row.body);
    const body = parsed.map((b) => blockToPlainText(b)).join('\n\n');
    await database.run(
      sql`INSERT INTO post_fts(title, dek, body, slug) VALUES (${row.title}, ${row.dek}, ${body}, ${row.slug})`,
    );
    for (const block of parsed) {
      const text = blockToPlainText(block).trim();
      // Headings index well and quote well; code and figures do neither, and
      // a code dump as an "answer" is a failure mode, not a feature.
      if (!text || block.type === 'code' || block.type === 'figure') continue;
      await database.run(
        sql`INSERT INTO block_fts(text, block_id, post_id) VALUES (${text}, ${block.id}, ${row.postId})`,
      );
    }
  }
  return rows.length;
}
