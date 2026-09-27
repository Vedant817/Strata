import { nanoid } from './ids';
import type { Block } from './blocks';

/**
 * Markdown → typed blocks, for archive import.
 *
 * Deliberately a converter, not a parser: it handles the shapes exporters
 * actually produce (frontmatter, headings, paragraphs, fenced code, quotes,
 * lists, simple tables) and leaves inline markup (`**bold**`, ``code``,
 * `[text](url)`) untouched, because the block renderer already understands
 * it. Anything exotic stays a paragraph rather than being dropped — a
 * slightly misshapen import beats a silently truncated one, and the writer
 * retags layers after importing anyway.
 *
 * Layer first pass: headings and the opening paragraph are `core` so the post
 * renders something real at skim; code is `master`; everything else is
 * `understand`. Importing is step one, retagging is step two, and the page
 * says so.
 */

export interface ImportedPost {
  slug: string;
  title: string;
  dek: string;
  publishedAt: number | null;
  status: 'seedling' | 'budding' | 'evergreen';
  blocks: Block[];
  warnings: string[];
}

function slugifyFilename(name: string): string {
  return name
    .replace(/\.md$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function parseFrontmatter(src: string): { meta: Record<string, string>; body: string } {
  const meta: Record<string, string> = {};
  if (!src.startsWith('---\n') && !src.startsWith('---\r\n')) return { meta, body: src };
  const end = src.indexOf('\n---', 3);
  if (end < 0) return { meta, body: src };
  for (const line of src.slice(4, end).split('\n')) {
    const at = line.indexOf(':');
    if (at < 0) continue;
    const key = line.slice(0, at).trim().toLowerCase();
    const value = line
      .slice(at + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (key) meta[key] = value;
  }
  return { meta, body: src.slice(end + 4).replace(/^\r?\n/, '') };
}

function toStatus(value: string | undefined): ImportedPost['status'] {
  const v = (value ?? '').toLowerCase();
  if (v === 'budding' || v === 'evergreen') return v;
  return 'seedling';
}

function toPublishedAt(value: string | undefined, fallbackMtime: number): number | null {
  if (value) {
    const t = Date.parse(value);
    if (!Number.isNaN(t)) return t;
  }
  return fallbackMtime > 0 ? fallbackMtime : null;
}

export function markdownToBlocks(filename: string, src: string, mtimeMs = 0): ImportedPost {
  const warnings: string[] = [];
  const { meta, body } = parseFrontmatter(src);
  const blocks: Block[] = [];

  const lines = body.split('\n');
  let i = 0;
  let paragraphCount = 0;

  const pushParagraph = (text: string) => {
    const clean = text.trim();
    if (!clean) return;
    paragraphCount++;
    // The opening paragraph is the lede: core, so skim shows something real.
    blocks.push({ id: nanoid(), type: 'paragraph', text: clean, layer: paragraphCount === 1 ? 'core' : 'understand' });
  };

  let title = meta.title ?? '';
  const dek = meta.dek ?? meta.description ?? meta.subtitle ?? '';

  while (i < lines.length) {
    const line = lines[i]!;

    // Fenced code.
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const lang = fence[1] || 'text';
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith('```')) {
        code.push(lines[i]!);
        i++;
      }
      i++; // closing fence (or EOF)
      blocks.push({ id: nanoid(), type: 'code', lang, code: code.join('\n'), caption: '', layer: 'master' });
      continue;
    }

    // Headings. The first H1 is the title if frontmatter did not name one.
    const h1 = line.match(/^#\s+(.*)/);
    if (h1) {
      if (!title) title = h1[1]!.trim();
      else blocks.push({ id: nanoid(), type: 'heading', level: 2, text: h1[1]!.trim(), layer: 'core' });
      i++;
      continue;
    }
    const h = line.match(/^#{2,3}\s+(.*)/);
    if (h) {
      blocks.push({ id: nanoid(), type: 'heading', level: 2, text: h[1]!.trim(), layer: 'core' });
      i++;
      continue;
    }

    // Quote.
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) {
        quote.push(lines[i]!.replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ id: nanoid(), type: 'quote', text: quote.join('\n'), attribution: '', layer: 'understand' });
      continue;
    }

    // List.
    if (/^(\s*)[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      const ordered = /^\s*\d+\.\s+/.test(line);
      while (i < lines.length && (/^(\s*)[-*+]\s+/.test(lines[i]!) || /^\s*\d+\.\s+/.test(lines[i]!))) {
        items.push(lines[i]!.replace(/^(\s*[-*+]|\s*\d+\.)\s+/, '').trim());
        i++;
      }
      blocks.push({ id: nanoid(), type: 'list', ordered, items, layer: 'understand' });
      continue;
    }

    // Simple pipe table.
    if (line.includes('|') && lines[i + 1]?.match(/^\|?[\s:|-]+\|?$/)) {
      const head = line.split('|').map((c) => c.trim()).filter(Boolean);
      i += 2; // header + separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim() !== '') {
        rows.push(lines[i]!.split('|').map((c) => c.trim()).filter(Boolean));
        i++;
      }
      if (head.length > 0 && rows.length > 0) {
        blocks.push({ id: nanoid(), type: 'table', head, rows, layer: 'understand' });
        continue;
      }
      warnings.push(`${filename}: a table-like shape did not parse and was kept as prose`);
    }

    // Thematic break / HTML / frontmatter leftovers: skip quietly, they are chrome.
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line) || line.trim().startsWith('<')) {
      i++;
      continue;
    }

    // Paragraph: accumulate to the blank line.
    if (line.trim() === '') {
      i++;
      continue;
    }
    const para: string[] = [line];
    i++;
    while (i < lines.length && lines[i]!.trim() !== '' && !/^(#{1,3}\s|```|>)/.test(lines[i]!)) {
      para.push(lines[i]!);
      i++;
    }
    pushParagraph(para.join('\n'));
  }

  if (!title) {
    title = slugifyFilename(filename).replace(/-/g, ' ') || 'Untitled import';
    warnings.push(`${filename}: no title found; used the filename`);
  }

  return {
    slug: meta.slug ?? slugifyFilename(filename),
    title,
    dek,
    publishedAt: toPublishedAt(meta.date ?? meta.published ?? meta.published_at, mtimeMs),
    status: toStatus(meta.status),
    blocks,
    warnings,
  };
}
