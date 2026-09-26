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
  html: string;
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
      out.push({ key: `p${n++}:${piece}`, html: escapeHtml(piece) });
    }
  };

  INLINE_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_PATTERN.exec(src)) !== null) {
    if (m.index > cursor) pushProse(src.slice(cursor, m.index));
    const raw = m[0];
    out.push({ key: `m${n++}:${raw}`, html: renderInline(raw) });
    cursor = m.index + raw.length;
  }
  if (cursor < src.length) pushProse(src.slice(cursor));
  return out;
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
