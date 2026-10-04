/**
 * Writing an archive into the database.
 *
 * The parser decides what a file *says*; this decides what it *means* for a
 * publication that already has opinions.
 *
 * Three judgement calls, all of them reversible by the writer afterwards:
 *
 *   1. **The original date is never overwritten.** `createPost` would stamp an
 *      import with today's date by default. A post from 2019 re-dated to 2026 is
 *      not an import, it is a lie about when the author believed something, and
 *      it is the single fastest way to make an archive worthless.
 *   2. **Imported posts land as budding, not evergreen.** They carry real
 *      content, but nobody here has checked them, and a publication whose whole
 *      claim is accountability should not mark an import as maintained.
 *   3. **The first pass is advisory and recorded.** Layer tags and a suggested
 *      changelog are attached to the import so the writer can see what was
 *      inferred, and change any of it in the editor.
 */

import { createPost } from '../repo/posts';
import { nanoid } from '../ids';
import { blockSchema, type Block } from '../blocks';
import { IMPORT_LIMITS, slugify, type ImportedPost } from './parse';

export interface ImportOutcome {
  filename: string;
  title: string;
  slug: string;
  postId?: string;
  imported: boolean;
  reason?: string;
  publishedAt?: number;
  originalUrl?: string;
  /** What the first pass inferred, shown to the writer so they can disagree. */
  inferred: string[];
  warnings: string[];
}

/**
 * First pass over imported blocks.
 *
 * Deliberately structural and deliberately timid. An earlier version of this
 * turned the opening paragraph into a `primer` block — which turned out to be a
 * glossary card requiring a `term`, so the block failed validation and
 * `parseBody` dropped it. The imported post shipped with its first paragraph
 * silently missing, and nothing said so.
 *
 * So: only inferences that are valid against the real schema, and none that
 * remove or replace a block the author wrote.
 *
 *   - Code is reference material. Marking it `master` keeps it out of skim,
 *     which is exactly what skim is for, and loses nothing.
 *   - Prose stays `core`. An opening paragraph is already what a reader wants
 *     first; demoting it would be the opposite of helpful.
 *   - The absence of a summary is worth mentioning, because Ask and the digest
 *     both read better with one and /write can draft it.
 */
function firstPass(body: Block[]): { blocks: Block[]; inferred: string[] } {
  const inferred: string[] = [];
  const blocks = [...body];

  let code = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (b.type !== 'code' || b.layer === 'master') continue;
    blocks[i] = { ...b, layer: 'master' } as Block;
    code++;
  }
  if (code > 0) {
    inferred.push(
      `${code} code block${code === 1 ? '' : 's'} tagged as master depth, so skim leaves them out. Promote one to a figure if it deserves to be seen early.`,
    );
  }

  if (!blocks.some((b) => b.type === 'tldr')) {
    inferred.push('No summary block yet. The studio can draft one from the opening paragraph.');
  }

  return { blocks, inferred };
}

function changelog(post: ImportedPost, inferred: string[]): string {
  const bits = [`Imported from ${post.originalUrl ?? 'an export'}`, 'original publication date preserved'];
  if (inferred.length > 0) bits.push('first pass applied');
  return bits.join(', ') + '.';
}

/**
 * Import one parsed post. Never throws for content reasons — a file the parser
 * liked but the database refuses comes back as `imported: false` with a reason,
 * so a 40-post archive does not die on its 39th.
 */
export async function importPost(
  post: ImportedPost,
  authorId: string,
  filename: string,
): Promise<ImportOutcome> {
  const base: ImportOutcome = {
    filename,
    title: post.title,
    slug: post.slug,
    imported: false,
    publishedAt: post.publishedAt,
    originalUrl: post.originalUrl,
    inferred: [],
    warnings: [...post.warnings],
  };

  if (post.body.length === 0) {
    return { ...base, reason: 'No readable prose in this file.' };
  }
  if (post.body.length > IMPORT_LIMITS.maxBlocksPerPost) {
    return { ...base, reason: `More than ${IMPORT_LIMITS.maxBlocksPerPost} blocks; import it in pieces.` };
  }

  const { blocks, inferred } = firstPass(post.body);
  const slug = slugify(post.slug || post.title);

  /* Refuse anything that would not survive a round trip through the schema.
     `parseBody` drops invalid blocks silently — which is right for rendering a
     page and catastrophic for an import, because the writer gets a "success"
     and an article with a hole in it. Validate here, where a refusal is still
     cheap and visible. */
  const invalid = blocks.filter((b) => !blockSchema.safeParse(b).success);
  if (invalid.length > 0) {
    return {
      ...base,
      inferred,
      reason: `${invalid.length} block${invalid.length === 1 ? '' : 's'} would not validate against the document schema (${invalid
        .map((b) => b.type)
        .join(', ')}). Nothing was imported — fix the source or import it in smaller pieces.`,
    };
  }

  try {
    const created = await createPost({
      slug,
      title: post.title,
      dek: post.dek,
      authorId,
      body: blocks,
      /* Budding, not evergreen: real content, unreviewed. See note 2 above. */
      status: 'budding',
      publishedAt: post.publishedAt,
      seoDescription: post.dek || undefined,
      originalUrl: post.originalUrl,
      changeSummary: changelog(post, inferred),
    });

    return {
      ...base,
      postId: created.postId,
      slug,
      imported: true,
      inferred,
    };
  } catch (err) {
    return { ...base, inferred, reason: explain(err, slug) };
  }
}

/**
 * Why an insert was refused, in words the writer can act on.
 *
 * A duplicate slug is the single most likely thing to go wrong when importing an
 * archive — people re-import, and they import twice by accident — and it is what
 * this function used to report as `Failed query: insert into "posts" ("id",
 * "slug", ...)`. The constraint violation is the only useful part of that
 * message and it is not in it.
 *
 * The real cause sits on `cause`, one or two levels down, because Drizzle wraps
 * whatever the driver threw. So the whole chain is read rather than just the
 * top message, and the error's own `code` counts too: libsql reports
 * `SQLITE_CONSTRAINT_UNIQUE`, and matching on that is more reliable than
 * matching prose that a driver version might reword.
 */
function explain(err: unknown, slug: string): string {
  const parts: string[] = [];
  let cursor: unknown = err;
  for (let depth = 0; cursor && depth < 6; depth++) {
    const e = cursor as { message?: unknown; code?: unknown; cause?: unknown };
    if (typeof e.message === 'string') parts.push(e.message);
    if (typeof e.code === 'string') parts.push(e.code);
    cursor = e.cause;
  }
  const text = parts.join(' | ');

  if (/unique|constraint/i.test(text)) {
    return `A post is already at /w/${slug}. Rename the file or edit its front matter.`;
  }
  // Anything else is a genuine surprise, so the driver's own words are better
  // than a guess — but the SQL statement is not those words.
  const first = parts.find((p) => p && !/^failed query:/i.test(p.trim()));
  return (first ?? parts[0] ?? 'Unknown error').slice(0, 200);
}

/** Stable id for an import run, so a retried batch is traceable in the log. */
export function importBatchId(): string {
  return `imp_${nanoid()}`;
}