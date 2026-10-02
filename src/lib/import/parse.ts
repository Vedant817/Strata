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

/** Hard ceilings, applied before parsing, not after. */
export const IMPORT_LIMITS = {
  maxPosts: 200,
  maxBytesPerPost: 512 * 1024,
  maxBlocksPerPost: 400,
} as const;

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
    const text = htmlToText(item.content);
    if (!text) {
      warnings.push(`"${item.title || item.postName || 'untitled'}" had no content and was skipped.`);
      continue;
    }
    const blocks = markdownToBlocks(text, warnings);
    if (blocks.length === 0) continue;
    const title = item.title || item.postName || 'Imported post';
    posts.push({
      title,
      slug: slugify(item.postName || title),
      dek: item.excerpt ? item.excerpt.replace(/\s+/g, ' ').slice(0, 300) : '',
      body: blocks,
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

/* ------------------------------------------------------------------- façade */

export function detectFormat(filename: string, content: string): 'markdown' | 'wordpress' | null {
  const name = filename.toLowerCase();
  if (name.endsWith('.xml') || /<rss[\s>]|<wp:wxr_version/i.test(content.slice(0, 2000))) {
    return 'wordpress';
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
    return { posts: [], warnings: [`"${filename}" is not a Markdown or WordPress export, so it was skipped.`] };
  }
  if (format === 'wordpress') {
    const posts = parseWordpressXml(content, warnings);
    return { posts, warnings };
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