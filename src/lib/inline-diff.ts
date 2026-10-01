/**
 * Inline-aware diffing.
 *
 * A word-level diff over raw source text splits code spans and emphasis across
 * segment boundaries: `delete` becomes "`del" + "ete" + "`", and re-rendering
 * each fragment emits literal backticks into the article. That is visible,
 * embarrassing, and it happens on exactly the posts the whole product is about.
 *
 * So: tokenise first (markup becomes an atomic token, prose becomes words),
 * diff the token keys, then render whole groups.
 */

import { diffArrays } from 'diff';
import { escapeHtml, renderInline } from './inline';

export interface Token {
  key: string;
  /** Pre-rendered, escaped HTML for this token. */
  html: string;
  /** The raw source text, so character offsets can be reconstructed. */
  text: string;
}

const INLINE_PATTERN =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(==[^=\n]+==)|(\[[^\]\n]+\]\([^)\s]+\))/g;

/** Split source into atomic markup tokens and word/whitespace tokens. */
export function tokenizeInline(src: string): Token[] {
  const out: Token[] = [];
  let cursor = 0;
  let n = 0;

  const pushProse = (run: string) => {
    // Keep whitespace as its own token so a diff can reconstruct spacing.
    for (const piece of run.split(/(\s+)/)) {
      if (!piece) continue;
      out.push({ key: `p${n++}:${piece}`, html: escapeHtml(piece), text: piece });
    }
  };

  INLINE_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_PATTERN.exec(src)) !== null) {
    if (m.index > cursor) pushProse(src.slice(cursor, m.index));
    const raw = m[0];
    out.push({ key: `m${n++}:${raw}`, html: renderInline(raw), text: raw });
    cursor = m.index + raw.length;
  }
  if (cursor < src.length) pushProse(src.slice(cursor));
  return out;
}

/**
 * Render source with [start, end) wrapped in a highlight.
 *
 * Token-based, so a highlight never lands mid-code-span and leaves a stray
 * backtick behind. A range that partially covers a token snaps outward to the
 * token boundary: highlighting a whole `code` span or none of it is correct,
 * highlighting three of its seven characters is not representable.
 */
export function renderWithHighlight(
  src: string,
  start: number,
  end: number,
  className: string,
  attrs = '',
): string {
  if (start >= end) return renderInline(src);
  const tokens = tokenizeInline(src);
  let offset = 0;
  let html = '';
  let open = false;

  for (const token of tokens) {
    const tokStart = offset;
    const tokEnd = offset + token.text.length;
    offset = tokEnd;
    const overlaps = tokStart < end && tokEnd > start;
    if (overlaps && !open) {
      html += `<span class="${className}"${attrs}>`;
      open = true;
    }
    html += token.html;
    if (!overlaps && open) {
      html += '</span>';
      open = false;
    }
  }
  if (open) html += '</span>';
  return html;
}

export interface InlineRange {
  start: number;
  end: number;
  className: string;
  attrs?: string;
  tag?: string;
  /** When two ranges cover the same words the lower number wins. A reader's own
   *  highlight outranks a note anchor, because the note still reads in the margin
   *  while the mark is the only trace of the highlight on the page. */
  priority?: number;
}

/**
 * Render source with several ranges wrapped at once — a note anchor and this
 * reader's own highlights can land on the same block, and painting them in one
 * pass keeps the tags correctly nested instead of interleaving half-open spans.
 * Ranges must be sorted and non-overlapping; anything overlapping is dropped
 * rather than guessed at.
 */
export function renderRanges(src: string, ranges: InlineRange[]): string {
  const usable = ranges
    .filter((r) => r.start < r.end)
    .sort((a, b) => a.start - b.start || (a.priority ?? 1) - (b.priority ?? 1))
    .filter((r, i, all) => i === 0 || r.start >= all[i - 1]!.end);

  if (usable.length === 0) return renderInline(src);

  const openTag = (r: InlineRange) => `<${r.tag ?? 'span'} class="${r.className}"${r.attrs ?? ''}>`;
  const closeTag = (r: InlineRange) => `</${r.tag ?? 'span'}>`;

  const tokens = tokenizeInline(src);
  let offset = 0;
  let html = '';
  let next = 0;
  const stack: InlineRange[] = [];

  for (const token of tokens) {
    const tokStart = offset;
    const tokEnd = offset + token.text.length;
    offset = tokEnd;

    while (stack.length > 0 && stack[stack.length - 1]!.end <= tokStart) {
      html += closeTag(stack.pop()!);
    }
    /* `usable` is sorted and non-overlapping, so a single forward cursor is
       enough: every range is opened at most once and closed by the stack. */
    while (next < usable.length && usable[next]!.start < tokEnd) {
      const r = usable[next]!;
      if (r.end > tokStart) {
        stack.push(r);
        html += openTag(r);
      }
      next++;
    }
    html += token.html;
  }
  while (stack.length > 0) html += closeTag(stack.pop()!);
  return html;
}

/**
 * Find a stored quote inside raw block source.
 *
 * Highlights are persisted as normalised prose (`text.replace(/\s+/g, ' ')`) but
 * live in source that still carries its original line breaks and indentation, so
 * a plain `indexOf` misses most of them. Comparing against a whitespace-folded
 * copy — and carrying an index map back to the source — finds the run without
 * ever slicing the wrong characters.
 */
export function findQuoteRange(src: string, quote: string): { start: number; end: number } | null {
  const needle = quote.replace(/\s+/g, ' ').trim();
  if (needle.length < 2) return null;

  let folded = '';
  const map: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      pendingSpace = folded.length > 0;
      continue;
    }
    if (pendingSpace) {
      folded += ' ';
      map.push(i);
      pendingSpace = false;
    }
    folded += ch;
    map.push(i);
  }
  if (needle.length > folded.length) return null;

  const at = folded.indexOf(needle);
  if (at < 0) return null;
  const endIdx = at + needle.length - 1;
  return { start: map[at]!, end: map[endIdx]! + 1 };
}

export interface InlineSegment {
  type: 'same' | 'ins' | 'del';
  /** Pre-rendered HTML for this contiguous group. */
  html: string;
  /** The plain text, for accessible labels and copy. */
  text: string;
}

export function diffInline(before: string, after: string): InlineSegment[] {
  const a = tokenizeInline(before);
  const b = tokenizeInline(after);
  const parts = diffArrays(a, b, {
    comparator: (x, y) => x.key === y.key,
  });

  const segments: InlineSegment[] = [];
  for (const part of parts) {
    const type = part.added ? 'ins' : part.removed ? 'del' : 'same';
    const tokens = part.value;
    if (tokens.length === 0) continue;
    const last = segments[segments.length - 1];
    const html = tokens.map((t) => t.html).join('');
    const text = tokens.map((t) => decodeEntity(t.html)).join('');
    if (last && last.type === type) {
      last.html += html;
      last.text += text;
    } else {
      segments.push({ type, html, text });
    }
  }
  return segments;
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

function decodeEntity(html: string): string {
  return html.replace(/&(amp|lt|gt|quot|#39);/g, (full) => ENTITIES[full] ?? full);
}
