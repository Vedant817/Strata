/**
 * Archive import: turning someone else's publication into typed blocks.
 *
 * Switching cost is the archive, so this is the first thing a writer has to be
 * asked for. It therefore has one job and one rule:
 *
 *   **Never lose the author's own metadata.** Original publication dates, the
 *   inbound URL the post used to live at, its categories. A blog post that
 *   predates the migration is a record of when somebody believed something, and
 *   re-dating it to "today" quietly destroys the only evidence that matters. If
 *   the source carries a date we keep it, verbatim.
 *
 * Two formats, because they cover almost every real archive:
 *
 *   - **Markdown with YAML front matter.** What Substack, Hashnode, Dev.to,
 *     Obsidian, Ghost and a plain folder of `.md` files all reduce to.
 *   - **WordPress WXR XML.** What every WordPress blog on earth exports, and
 *     the only format that reliably carries both the original date and the
 *     original permalink.
 *
 * Everything is parsed to the same typed-block shape the editor already uses,
 * so an imported post opens in the studio and can be revised like any other.
 * Nothing here executes what it reads: HTML is flattened to text, never passed
 * through, because an export is untrusted input.
 */

import { z } from 'zod';
import {
  blockSchema,
  newBlockId,
  type Block,
  type BlockType,
} from '../blocks';
import { extractSubtree, htmlMeta, htmlToBlocks } from './html';
import { IMPORT_LIMITS } from './shared';

export { IMPORT_LIMITS };

export interface ImportedPost {
  title: string;
  slug: string;
  dek: string;
  body: Block[];
  /** ms since epoch, from the source. Never invented. */
  publishedAt?: number;
  /** Where this post used to live, so inbound links keep resolving somewhere. */
  originalUrl?: string;
  status: 'public' | 'unlisted' | 'private';
  categories: string[];
  /** What the parser could not represent, so the writer can look at it. */
  warnings: string[];
}

/* ------------------------------------------------------------------ helpers */

export function slugify(input: string, fallback = 'imported-post'): string {
  const s = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return s.length >= 2 ? s : fallback;
}

/** Front matter is YAML, but only the flat scalar subset anyone actually uses. */
export function parseFrontMatter(raw: string): { data: Record<string, string>; body: string } {
  const data: Record<string, string> = {};
  let body = raw;
  // Some exporters use --- or +++ fences.
  const m = /^(?:\uFEFF)?(?:---|\+\+\+)[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\+\+\+)[ \t]*\r?\n?/.exec(raw);
  if (m) {
    body = raw.slice(m[0].length);
    for (const line of m[1]!.split(/\r?\n/)) {
      const at = line.indexOf(':');
      if (at < 1) continue;
      const key = line.slice(0, at).trim().toLowerCase();
      let value = line.slice(at + 1).trim();
      // Only scalars. A nested YAML list is not something we can guess at.
      if (/^[\[{]/.test(value)) continue;
      value = value.replace(/^["']|["']$/g, '').trim();
      if (key && value) data[key] = value;
    }
  }
  return { data, body };
}

/** Any date shape an export might use, to ms. Returns undefined when hopeless. */
export function parseDate(input: string | undefined | null): number | undefined {
  if (!input) return undefined;
  const t = input.trim();
  if (!t) return undefined;
  // Bare year, e.g. "2019"
  if (/^\d{4}$/.test(t)) {
    const d = new Date(Date.UTC(Number(t), 0, 1));
    return Number.isNaN(d.getTime()) ? undefined : d.getTime();
  }
  const d = new Date(t);
  if (!Number.isNaN(d.getTime())) return d.getTime();
  // "2019-04-05 10:00" — Safari-style, hand-normalise.
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (m) {
    const ms = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? '0'));
    return Number.isNaN(ms) ? undefined : ms;
  }
  return undefined;
}

/**
 * Flatten HTML to plain text with paragraph structure.
 *
 * Deliberately lossy and deliberately not an HTML parser: an export is
 * untrusted input, and the only safe subset to accept from it is "text with
 * breaks". `<script>` and `<style>` contents are dropped entirely rather than
 * escaped, so nothing downstream can ever see them as prose.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_x, d: string) => String.fromCodePoint(Number(d)))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ----------------------------------------------------------------- markdown */

interface Draft {
  type: BlockType;
  payload: Record<string, unknown>;
}

/** Guard against a pathological document before the block loop runs. */
function push(out: Draft[], d: Draft, warnings: string[]): void {
  if (out.length >= IMPORT_LIMITS.maxBlocksPerPost) {
    if (warnings[warnings.length - 1] !== 'Block limit reached.') {
      warnings.push('Block limit reached.');
    }
    return;
  }
  out.push(d);
}

/**
 * Markdown to typed blocks.
 *
 * Inline markup is left intact on purpose: the editor's own inline renderer
 * (`renderInline`) already understands `code`, **bold**, *italic*, ==mark== and
 * links, so re-escaping here would double it.
 */
export function markdownToBlocks(md: string, warnings: string[] = []): Block[] {
  const drafts: Draft[] = [];
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;

  const para: string[] = [];
  const flushPara = () => {
    const text = para.join('\n').trim();
    para.length = 0;
    if (text) push(drafts, { type: 'paragraph', payload: { text } }, warnings);
  };

  while (i < lines.length) {
    const line = lines[i]!;

    // fenced code
    const fence = /^\s*(```|~~~)\s*([A-Za-z0-9+#._-]*)\s*$/.exec(line);
    if (fence) {
      flushPara();
      const marker = fence[1]!;
      const lang = (fence[2] || 'text').toLowerCase();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s*${marker}`).test(lines[i]!)) {
        buf.push(lines[i]!);
        i++;
      }
      i++; // closing fence
      push(drafts, { type: 'code', payload: { lang, code: buf.join('\n'), caption: '' } }, warnings);
      continue;
    }

    // heading — h1 becomes the title if it is the very first thing, else h2
    const head = /^(#{1,6})\s+(.*)$/.exec(line);
    if (head) {
      flushPara();
      const level = head[1]!.length;
      const text = head[2]!.trim();
      if (text) {
        push(drafts, { type: 'heading', payload: { level: level <= 2 ? 2 : 3, text } }, warnings);
      }
      i++;
      continue;
    }

    // blockquote, possibly several paragraphs
    if (/^\s*>/.test(line)) {
      flushPara();
      const buf: string[] = [];
      while (i < lines.length && (/^\s*>/.test(lines[i]!) || (lines[i]!.trim() && buf.length))) {
        buf.push(lines[i]!.replace(/^\s*>\s?/, ''));
        i++;
      }
      const text = buf.join('\n').trim();
      if (text) push(drafts, { type: 'quote', payload: { text, attribution: '' } }, warnings);
      continue;
    }

    // table
    if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1]!)) {
      flushPara();
      const cells = (row: string) =>
        row
          .replace(/^\s*\|/, '')
          .replace(/\|\s*$/, '')
          .split('|')
          .map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /\|/.test(lines[i]!) && lines[i]!.trim()) {
        rows.push(cells(lines[i]!));
        i++;
      }
      if (head.length) {
        push(drafts, { type: 'table', payload: { head, rows } }, warnings);
      }
      continue;
    }

    // list
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      flushPara();
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*([-*+]|\d+[.)])\s+/, '').trim());
        i++;
      }
      if (items.length) push(drafts, { type: 'list', payload: { ordered, items } }, warnings);
      continue;
    }

    // thematic break — no block type for it, and inventing one would be noise
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      flushPara();
      i++;
      continue;
    }

    if (!line.trim()) {
      flushPara();
      i++;
      continue;
    }

    para.push(line);
    i++;
  }
  flushPara();

  const blocks: Block[] = [];
  for (const d of drafts) {
    const parsed = blockSchema.safeParse({ id: newBlockId(), layer: 'core', ...d.payload, type: d.type });
    if (parsed.success) {
      blocks.push(parsed.data as Block);
    } else {
      warnings.push(`Skipped a ${d.type} block that would not validate.`);
    }
  }
  return blocks;
}

/* ------------------------------------------------------------ wordpress wxr */

interface WxrItem {
  title: string;
  link: string;
  pubDate?: string;
  postName?: string;
  status?: string;
  categories: string[];
  content: string;
  excerpt: string;
}

function tagText(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  const m = re.exec(xml);
  return m ? decodeEntities(m[1]!).trim() : '';
}

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

/** Parse a WordPress eXtended RSS export. */
export function parseWordpressXml(xml: string, warnings: string[] = []): ImportedPost[] {
  const items: WxrItem[] = [];
  const itemRe = /<item\b[\s\S]*?<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const chunk = m[0];
    if (/\<wp:status\>[^<]*<\/wp:status\>/i.test(chunk) && !/draft/i.test(chunk)) {
      const status = /<wp:status>([^<]*)<\/wp:status>/i.exec(chunk)?.[1]?.toLowerCase();
      if (status === 'trash' || status === 'private') continue;
    }
    const cats: string[] = [];
    const catRe = /<category\b[^>]*>([\s\S]*?)<\/category>/gi;
    let c: RegExpExecArray | null;
    while ((c = catRe.exec(chunk)) !== null) {
      const v = decodeEntities(c[1]!);
      if (v) cats.push(v);
    }
    items.push({
      title: decodeEntities(tagText(chunk, 'title')),
      link: tagText(chunk, 'link'),
      pubDate: tagText(chunk, 'pubDate') || tagText(chunk, 'wp:post_date') || undefined,
      postName: tagText(chunk, 'wp:post_name') || undefined,
      status: tagText(chunk, 'wp:status').toLowerCase() || undefined,
      categories: cats,
      content: tagText(chunk, 'content:encoded'),
      excerpt: decodeEntities(tagText(chunk, 'excerpt:encoded') || tagText(chunk, 'description')),
    });
  }

  const posts: ImportedPost[] = [];
  for (const item of items.slice(0, IMPORT_LIMITS.maxPosts)) {
    /* Structure, not just text. `content:encoded` is HTML, and this used to run
       it through `htmlToText` first, which threw away every heading, list and
       code block in the archive — an imported WordPress blog arrived as one
       undifferentiated run of paragraphs and the writer had to rebuild the shape
       of their own writing. Same converter the Medium and Docs paths use. */
    const blocks = htmlToBlocks(item.content, warnings);
    if (blocks.length === 0) {
      if (!htmlToText(item.content)) {
        warnings.push(`"${item.title || item.postName || 'untitled'}" had no content and was skipped.`);
      } else {
        warnings.push(`"${item.title || item.postName || 'untitled'}" had no readable prose.`);
      }
      continue;
    }
    const title = item.title || item.postName || 'Imported post';
    posts.push({
      title,
      slug: slugify(item.postName || title),
      dek: item.excerpt ? item.excerpt.replace(/\s+/g, ' ').slice(0, 300) : '',
      body: dropTitleHeading(blocks, title),
      publishedAt: parseDate(item.pubDate),
      originalUrl: item.link || undefined,
      status: item.status === 'private' ? 'private' : 'public',
      categories: item.categories,
      warnings: [],
    });
  }
  if (items.length > IMPORT_LIMITS.maxPosts) {
    warnings.push(`Only the first ${IMPORT_LIMITS.maxPosts} items were imported.`);
  }
  return posts;
}

/* --------------------------------------------------- HTML exports: Medium, Google Docs */

/**
 * Medium.
 *
 * "Download your data" gives a zip of `posts/1452181875311-my-post.html` — one
 * self-contained HTML file per post, no wrapper index. Each carries the
 * metadata this importer exists to preserve in `<meta>`: `og:title`,
 * `og:url`, `article:published_time`, and `author`.
 *
 * The article body moved around over the years, so all three known containers
 * are tried. When none matches, the `<article>` element is the fallback; failing
 * that, no post is produced and a warning explains why, rather than importing a
 * page of navigation and signup prompts as if it were the essay.
 */
export function parseMediumHtml(
  content: string,
  filename: string,
  warnings: string[] = [],
): ImportedPost[] {
  const meta = htmlMeta(content);

  const body =
    extractSubtree(content, (tag, attrs) => tag === 'section' && /\be-content\b/.test(attrs.class ?? '')) ??
    extractSubtree(content, (tag, attrs) => tag === 'div' && /\bsection-content\b/.test(attrs.class ?? '')) ??
    extractSubtree(content, (tag) => tag === 'article');

  if (!body) {
    warnings.push(
      `"${filename}" looks like a Medium export but no article body was found in it, so nothing was imported.`,
    );
    return [];
  }

  const blocks = htmlToBlocks(body, warnings);
  if (blocks.length === 0) {
    warnings.push(`"${filename}" had no readable prose.`);
    return [];
  }

  const titleTag = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(content)?.[1] ?? '';
  const title = (meta['og:title'] ?? meta.title ?? stripTags(titleTag)).trim();
  if (!title) {
    warnings.push(`"${filename}" had no title, so it was skipped.`);
    return [];
  }

  return [
    {
      title,
      slug: slugify(meta['og:url'] ? titleFromUrl(meta['og:url']) : title, slugify(filename)),
      dek: (meta['og:description'] ?? meta.description ?? '').slice(0, 300),
      body: dropTitleHeading(blocks, title),
      publishedAt: parseDate(meta['article:published_time'] ?? meta['og:updated_time'] ?? meta.date),
      originalUrl: meta['og:url'] ?? undefined,
      // Medium has drafts and unpublished posts in the same export as live ones,
      // and it exposes neither in the meta tags. Everything arrives as public,
      // which is the same assumption the Markdown importer makes.
      status: 'public',
      categories: [],
      warnings: [],
    },
  ];
}

/** Google Docs: File → Download → Web page (.html), or "Publish to the web". */
export function parseGoogleDocsHtml(
  content: string,
  filename: string,
  warnings: string[] = [],
): ImportedPost[] {
  const meta = htmlMeta(content);

  /* Every Docs export wraps the body in
     `<b id="docs-internal-guid-...">`. That marker is the only reliable signal:
     the surrounding markup is generic Word-style HTML that also matches dozens
     of other exporters, and matching on it would mean confidently importing the
     wrong thing. */
  const body =
    extractSubtree(content, (_tag, attrs) => (attrs.id ?? '').startsWith('docs-internal-guid-')) ??
    extractSubtree(content, (tag, attrs) => tag === 'div' && /\bdocs-body\b/.test(attrs.class ?? ''));

  if (!body) {
    warnings.push(
      `"${filename}" does not look like a Google Docs export — expected the ` +
        `docs-internal-guid wrapper. Export as Web page (.html) and try again.`,
    );
    return [];
  }

  const blocks = htmlToBlocks(body, warnings);
  if (blocks.length === 0) {
    warnings.push(`"${filename}" had no readable prose.`);
    return [];
  }

  /* Docs has no notion of a post: no date, no URL, no tags. `publishedAt` stays
     undefined rather than being set to now — the same rule the Markdown path
     follows, and the reason an import cannot quietly re-date somebody's work. */
  const title = (meta['og:title'] ?? meta.title ?? firstHeading(blocks) ?? guessTitle(filename))
    .trim();

  return [
    {
      title,
      slug: slugify(title, slugify(filename)),
      dek: '',
      body: dropTitleHeading(blocks, title),
      publishedAt: parseDate(meta['article:published_time'] ?? meta.date),
      originalUrl: undefined,
      status: 'public',
      categories: [],
      warnings: [],
    },
  ];
}

/* ------------------------------------------------------------------- CSV */

/**
 * RFC 4180 CSV, one row at a time.
 *
 * Written by hand because a post's body is Markdown with commas, quotes and
 * blank lines inside it: `content` is routinely a multi-kilobyte field with
 * embedded `"` doubled up per the spec. Splitting on newlines or commas — which
 * is what a first attempt always does — truncates the body of any post whose
 * prose contains either.
 */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  // A leading BOM is Excel's, and it ends up inside the first header name.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  while (i < text.length) {
    const ch = text[i]!;

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\r') {
      i++;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Hashnode's `Export.csv`: one row per post, Markdown in `content`.
 *
 * This is the format Hashnode offers where Medium offers HTML, and it is a
 * genuinely better one to import — the body is already Markdown, so headings,
 * lists, quotes, code and tables survive without a converter. The columns that
 * matter are `title`, `content`, `brief`, `publishedAt`, `slug`, `path` and
 * `tags`.
 */
export function parseHashnodeCsv(content: string, warnings: string[] = []): ImportedPost[] {
  const rows = parseCsv(content);
  if (rows.length === 0) return [];

  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const at = (row: string[], name: string) => {
    const i = col(name);
    return i === -1 ? '' : (row[i] ?? '').trim();
  };

  const contentCol = col('content');
  const titleCol = col('title');

  if (contentCol === -1 && titleCol === -1) {
    warnings.push(
      'That CSV has no `title` or `content` column, so it does not look like a Hashnode export.',
    );
    return [];
  }

  const posts: ImportedPost[] = [];
  for (const row of rows.slice(1, IMPORT_LIMITS.maxPosts + 1)) {
    if (row.length === 1 && !row[0]!.trim()) continue;

    const body = contentCol === -1 ? '' : (row[contentCol] ?? '').trim();
    const title = at(row, 'title');

    if (!body) {
      if (title) warnings.push(`"${title}" had no content and was skipped.`);
      continue;
    }

    const blocks = markdownToBlocks(body, warnings);
    if (blocks.length === 0) continue;

    const tags = at(row, 'tags');
    const categories = tags
      ? tags
          .split(/[;,|]/)
          .map((t) => t.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean)
      : [];

    posts.push({
      title: title || firstHeading(blocks) || 'Imported post',
      // `slug` is Hashnode's own; `path` is the address it lived at.
      slug: slugify(at(row, 'slug') || title || 'imported-post'),
      dek: (at(row, 'brief') || at(row, 'subtitle') || '').slice(0, 300),
      body: dropTitleHeading(blocks, title),
      publishedAt: parseDate(at(row, 'publishedat') || at(row, 'published_at') || at(row, 'date')),
      originalUrl: /^https?:\/\//i.test(at(row, 'path')) ? at(row, 'path') : undefined,
      status: 'public',
      categories,
      warnings: [],
    });
  }

  if (posts.length > IMPORT_LIMITS.maxPosts) {
    warnings.push(
      `Only the first ${IMPORT_LIMITS.maxPosts} posts were imported; the rest were left out.`,
    );
  }
  return posts;
}

/* ------------------------------------------------------------------ shared bits */

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** The last path segment of a URL, which is where Medium keeps the slug. */
function titleFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '');
    const last = path.split('/').pop() ?? '';
    // Medium appends a short id: `my-post-title-a1b2c3`.
    return last.replace(/-[0-9a-f]{6,}$/i, '');
  } catch {
    return '';
  }
}

function firstHeading(blocks: Block[]): string | undefined {
  const h = blocks.find((b) => b.type === 'heading');
  return h && 'text' in h ? String(h.text) : undefined;
}

/**
 * Drop a leading heading that only restates the title.
 *
 * HTML exports put the post's own title in an `<h1>` *and* in the metadata,
 * because that is what the original page rendered. Importing both gives every
 * post a doubled heading, which reads as a bug in this app rather than in the
 * export. Only an exact match goes; a heading that says something different is a
 * section and stays.
 */
function dropTitleHeading(blocks: Block[], title: string): Block[] {
  if (!title) return blocks;
  const bare = (t: string) => t.replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const first = blocks[0];
  if (first?.type === 'heading' && bare((first as { text: string }).text) === bare(title)) {
    return blocks.slice(1);
  }
  return blocks;
}

function guessTitle(filename: string): string {
  return filename
    .replace(/\.(html?|txt|md|docx?)$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim() || 'Imported post';
}

/* ------------------------------------------------------------------- façade */

export type ImportFormat =
  | 'markdown'
  | 'wordpress'
  | 'medium'
  | 'gdocs'
  | 'hashnode-csv'
  | null;

/**
 * Which format this file is.
 *
 * Content wins over the extension throughout. A Medium post saved as `.txt` and
 * a WordPress export renamed `.html` are both common, and a detector that trusts
 * the extension quietly returns "markdown" for HTML and then flattens it.
 */
export function detectFormat(filename: string, content: string): ImportFormat {
  const name = filename.toLowerCase();
  const head = content.slice(0, 4000);

  if (name.endsWith('.xml') || /<rss[\s>]|<wp:wxr_version/i.test(head)) {
    return 'wordpress';
  }

  // CSV: a header row with the columns Hashnode actually emits. Checked before
  // the HTML branches because an exported CSV of HTML posts starts with `title,`.
  if (name.endsWith('.csv') || /^[^\n]*\b(content|title)\b[^\n]*,/i.test(head.split('\n')[0] ?? '')) {
    if (/\bcontent\b/i.test(head.split('\n')[0] ?? '')) return 'hashnode-csv';
  }

  // The Docs wrapper is unambiguous, so it is checked before the generic HTML.
  if (/docs-internal-guid-/i.test(head)) return 'gdocs';

  if (/<html[\s>]|<!doctype html/i.test(head)) {
    // Medium's markers: its own metadata, its own body class, or the shape of
    // the filename the export uses.
    if (
      /"og:site_name"\s+content="\s*Medium/i.test(head) ||
      /\be-content\b/i.test(head) ||
      /\bsection-content\b/i.test(head) ||
      /medium\.com\//i.test(head) ||
      /^posts\/\d{10,}-[\w-]+\.html$/i.test(name)
    ) {
      return 'medium';
    }
    // Any other HTML document: worth attempting, and the parser says so plainly
    // if it cannot find a body.
    return 'gdocs';
  }

  if (/\.(md|markdown|txt|mdx)$/.test(name) || /^---\s*$/m.test(content.slice(0, 200))) {
    return 'markdown';
  }
  return null;
}

/**
 * One file to one or more posts, depending on what it is.
 * Never throws: a file it cannot read returns an empty list and a warning.
 */
export function parseImportFile(
  filename: string,
  content: string,
): { posts: ImportedPost[]; warnings: string[] } {
  const warnings: string[] = [];
  if (content.length > IMPORT_LIMITS.maxBytesPerPost) {
    return {
      posts: [],
      warnings: [`"${filename}" is larger than ${Math.round(IMPORT_LIMITS.maxBytesPerPost / 1024)}KB and was not imported.`],
    };
  }
  const format = detectFormat(filename, content);
  if (!format) {
    return {
      posts: [],
      warnings: [
        `"${filename}" is not a recognised export. Supported: Markdown, WordPress WXR, ` +
          'Medium HTML, Google Docs HTML, Hashnode CSV.',
      ],
    };
  }

  if (format === 'wordpress') {
    const posts = parseWordpressXml(content, warnings);
    return { posts, warnings };
  }
  if (format === 'medium') {
    return { posts: parseMediumHtml(content, filename, warnings), warnings };
  }
  if (format === 'gdocs') {
    return { posts: parseGoogleDocsHtml(content, filename, warnings), warnings };
  }
  if (format === 'hashnode-csv') {
    return { posts: parseHashnodeCsv(content, warnings), warnings };
  }

  const { data, body } = parseFrontMatter(content);
  const text = body.trim();
  if (!text) {
    return { posts: [], warnings: [`"${filename}" was empty.`] };
  }
  const blocks = markdownToBlocks(text, warnings);
  if (blocks.length === 0) {
    return { posts: [], warnings: [`"${filename}" had no readable prose.`] };
  }

  // Prefer explicit front matter; fall back to a leading H1, then the filename.
  let title = data.title ?? '';
  let bodyBlocks = blocks;
  if (!title && blocks[0]?.type === 'heading') {
    title = (blocks[0] as { text: string }).text;
    bodyBlocks = blocks.slice(1);
  }
  title = title || filename.replace(/\.(md|markdown|mdx|txt)$/i, '').replace(/[-_]+/g, ' ');

  /* Drop a leading H1 that just repeats the title.
     Substack, Hashnode and Dev.to exports all carry the title twice — once in
     front matter and once as `# Title` in the body. Rendering both gives every
     imported post a doubled heading, which looks like a bug in *this* app
     rather than in the export. Only an exact match is removed: an H1 that says
     something different is a real section heading and stays. */
  const first = bodyBlocks[0];
  if (first?.type === 'heading') {
    const bare = (t: string) =>
      t
        .replace(/[*_`~]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    if (bare((first as { text: string }).text) === bare(title)) {
      bodyBlocks = bodyBlocks.slice(1);
    }
  }

  const categories = (data.categories ?? data.tags ?? '')
    .split(/[,;]/)
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);

  return {
    posts: [
      {
        title,
        slug: slugify(data.slug || title, slugify(filename)),
        dek: (data.description ?? data.dek ?? data.subtitle ?? '').slice(0, 300),
        body: bodyBlocks,
        publishedAt: parseDate(data.date ?? data.published ?? data.published_at ?? data.updated),
        originalUrl: data.url ?? data.permalink ?? data.link ?? undefined,
        status: 'public',
        categories,
        warnings: [],
      },
    ],
    warnings,
  };
}

export const importFileSchema = z.object({
  filename: z.string().min(1).max(240),
  content: z.string().max(IMPORT_LIMITS.maxBytesPerPost),
});