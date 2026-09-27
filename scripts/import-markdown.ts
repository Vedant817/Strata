/**
 * Import a folder of Markdown files as posts.
 *
 *   npx tsx scripts/import-markdown.ts ./archive --author=vedant [--status=seedling] [--dry]
 *
 * Each `.md` file becomes one post. Frontmatter (`title`, `dek`, `date`,
 * `status`, `slug`) is honored when present; the filename becomes the slug
 * otherwise, and the file's modified time becomes the original publication
 * date so an archive keeps its history instead of arriving stamped today.
 * `--dry` converts and reports without writing anything.
 *
 * Substack, Medium, Dev.to, Hashnode and Ghost exports all reduce to "a folder
 * of Markdown" with one extra step outside this script, which is why this is
 * the shape import takes: one excellent funnel rather than five brittle ones.
 */

import fs from 'node:fs';
import path from 'node:path';
import { readyDb } from '../src/lib/db';
import { users } from '../src/lib/db/schema';
import { eq } from 'drizzle-orm';
import { createPost } from '../src/lib/repo/posts';
import { markdownToBlocks } from '../src/lib/import-markdown';

function usage(): never {
  console.error('usage: npx tsx scripts/import-markdown.ts <dir> --author=<handle> [--status=seedling] [--dry]');
  process.exit(1);
}

const dir = process.argv[2];
const authorArg = process.argv.find((a) => a.startsWith('--author='))?.slice(9);
const statusArg = process.argv.find((a) => a.startsWith('--status='))?.slice(9);
const dry = process.argv.includes('--dry');
if (!dir || !authorArg) usage();

const status = statusArg === 'budding' || statusArg === 'evergreen' ? statusArg : 'seedling';

const database = await readyDb();
const [author] = await database.select().from(users).where(eq(users.handle, authorArg)).limit(1);
if (!author) {
  console.error(`no user with handle "${authorArg}" — claim or seed one first`);
  process.exit(1);
}

const files = fs
  .readdirSync(dir!)
  .filter((f) => f.toLowerCase().endsWith('.md'))
  .sort();
if (files.length === 0) {
  console.error(`no .md files in ${dir}`);
  process.exit(1);
}

let imported = 0;
for (const file of files) {
  const full = path.join(dir!, file);
  const src = fs.readFileSync(full, 'utf8');
  const mtime = fs.statSync(full).mtimeMs;
  const post = markdownToBlocks(file, src, mtime);

  console.log(`\n${file}`);
  console.log(`  → /w/${post.slug} — "${post.title}" (${post.blocks.length} blocks)`);
  for (const w of post.warnings) console.log(`  ! ${w}`);

  if (post.blocks.length === 0) {
    console.log('  ! no blocks converted; skipped');
    continue;
  }
  if (dry) continue;

  await createPost({
    slug: post.slug,
    title: post.title,
    dek: post.dek,
    authorId: author.id,
    body: post.blocks,
    status: post.status === 'seedling' ? status : post.status,
    publishedAt: post.publishedAt ?? Date.now(),
    changeSummary: `Imported from ${file}; layer tags are a first pass.`,
  });
  imported++;
}

console.log(dry ? `\ndry run: ${files.length} files would import` : `\nimported ${imported}/${files.length} posts`);
process.exit(0);
