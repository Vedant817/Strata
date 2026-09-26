/**
 * Semantic block-level diff.
 *
 * Blocks are matched by their stable `id`, so a diff knows the difference
 * between "this sentence was rewritten" and "this paragraph is new" — which a
 * naive line diff cannot. Within a modified block we fall back to a word-level
 * diff so the reader sees the actual edit, not a whole-block replacement.
 */

import { blockInlineSource, type Block } from './blocks';
import { diffInline, type InlineSegment } from './inline-diff';

export type DiffStatus = 'unchanged' | 'added' | 'removed' | 'modified';
export type SegmentType = 'same' | 'ins' | 'del';

export interface Segment {
  type: SegmentType;
  text: string;
  /** Pre-rendered HTML. Absent for plain-text consumers (search, the API). */
  html?: string;
}

export interface DiffEntry {
  blockId: string;
  status: DiffStatus;
  before: string;
  after: string;
  segments: Segment[];
  /** True when this block carries a `change_summary` worth surfacing. */
  meaningful: boolean;
}

export function diffBlocks(before: Block[], after: Block[]): DiffEntry[] {
  const beforeById = new Map(before.map((b) => [b.id, b]));

  const out: DiffEntry[] = [];
  const seen = new Set<string>();

  for (const next of after) {
    seen.add(next.id);
    const prev = beforeById.get(next.id);
    if (!prev) {
      out.push({
        blockId: next.id,
        status: 'added',
        before: '',
        after: blockInlineSource(next),
        segments: [{ type: 'ins', text: blockInlineSource(next) }],
        meaningful: true,
      });
      continue;
    }
    const a = blockInlineSource(prev);
    const b = blockInlineSource(next);
    if (a === b) {
      out.push({
        blockId: next.id,
        status: 'unchanged',
        before: a,
        after: b,
        segments: [{ type: 'same', text: b }],
        meaningful: false,
      });
      continue;
    }
    out.push({
      blockId: next.id,
      status: 'modified',
      before: a,
      after: b,
      segments: wordDiff(a, b),
      meaningful: true,
    });
  }

  // Removals are emitted at their original position so the reading order of the
  // older revision is preserved for the reader comparing versions.
  for (const prev of before) {
    if (seen.has(prev.id)) continue;
    const text = blockInlineSource(prev);
    out.push({
      blockId: prev.id,
      status: 'removed',
      before: text,
      after: '',
      segments: [{ type: 'del', text }],
      meaningful: true,
    });
  }

  return out;
}

export function wordDiff(a: string, b: string): Segment[] {
  const parts = diffInline(a, b);
  return parts.map((p) => ({ type: p.type, text: p.text, html: p.html }));
}

export type { InlineSegment };

export interface DiffStats {
  added: number;
  removed: number;
  modified: number;
  changed: number;
}

export function diffStats(entries: DiffEntry[]): DiffStats {
  let added = 0;
  let removed = 0;
  let modified = 0;
  for (const e of entries) {
    if (e.status === 'added') added++;
    else if (e.status === 'removed') removed++;
    else if (e.status === 'modified') modified++;
  }
  return { added, removed, modified, changed: added + removed + modified };
}

/** Collapse consecutive unchanged blocks — used for the compact revision view. */
export function collapseUnchanged(
  entries: DiffEntry[],
  context = 1,
): Array<DiffEntry | { type: 'gap'; count: number }> {
  const out: Array<DiffEntry | { type: 'gap'; count: number }> = [];
  let buffer: DiffEntry[] = [];

  const flush = () => {
    if (buffer.length > context * 2 + 1) {
      out.push({ type: 'gap', count: buffer.length - context * 2 });
    } else {
      out.push(...buffer);
    }
    buffer = [];
  };

  for (const entry of entries) {
    if (entry.status === 'unchanged') {
      buffer.push(entry);
      continue;
    }
    flush();
    out.push(entry);
  }
  flush();
  return out;
}
