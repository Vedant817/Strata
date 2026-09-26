/**
 * Seed authoring DSL.
 *
 * Revisions are expressed as *patches* against a base document rather than
 * full copies. This keeps the seed honest about how a real post evolves — a
 * revision touches two paragraphs, not the whole file — and it means the diff
 * engine is exercised by genuinely sparse edits rather than a full rewrite.
 */

import type { Block, Layer } from '../lib/blocks';

let counter = 0;
/** Deterministic ids so seeded block ids are stable across re-runs. */
function id(seed: string): string {
  counter += 1;
  return `b_${seed}_${counter.toString(36)}`;
}

const core: Layer = 'core';

export const p = (text: string, layer: Layer = core): Block => ({
  id: id('p'),
  type: 'paragraph',
  text,
  layer,
});

export const h2 = (text: string): Block => ({
  id: id('h2'),
  type: 'heading',
  level: 2,
  text,
  layer: core,
});

export const h3 = (text: string): Block => ({
  id: id('h3'),
  type: 'heading',
  level: 3,
  text,
  layer: core,
});

/** Always visible, and expanded at skim. The one thing skim never hides. */
export const tldr = (text: string): Block => ({ id: id('tldr'), type: 'tldr', text, layer: core });

/** Glossary card. Shows at Read depth, the first time the term is needed. */
export const primer = (term: string, text: string): Block => ({
  id: id('pr'),
  type: 'primer',
  term,
  text,
  layer: 'understand',
});

export const code = (lang: string, code: string, caption = ''): Block => ({
  id: id('co'),
  type: 'code',
  lang,
  code,
  caption,
  layer: core,
});

export const list = (items: string[], ordered = false): Block => ({
  id: id('li'),
  type: 'list',
  ordered,
  items,
  layer: core,
});

export const quote = (text: string, attribution = ''): Block => ({
  id: id('qu'),
  type: 'quote',
  text,
  attribution,
  layer: core,
});

export const table = (head: string[], rows: string[][]): Block => ({
  id: id('tb'),
  type: 'table',
  head,
  rows,
  layer: core,
});

export const callout = (
  tone: 'note' | 'warn' | 'correction',
  title: string,
  text: string,
  layer: Layer = core,
): Block => ({
  id: id('ca'),
  type: 'callout',
  tone,
  title,
  text,
  layer,
});

export const interactive = (
  component: 'curve' | 'breakdown' | 'matrix' | 'timeline',
  title: string,
  props: Record<string, unknown>,
  layer: Layer = core,
): Block => ({ id: id('ix'), type: 'interactive', component, title, props, layer });

/** Master-layer footnote. Visible only at Study depth. */
export const note = (text: string): Block => ({
  id: id('nt'),
  type: 'paragraph',
  text,
  layer: 'master',
});

/* -------------------------------------------------------------------------- */
/* Patches                                                                     */
/* -------------------------------------------------------------------------- */

export type Patch =
  | { op: 'edit'; id: string; text: string }
  | { op: 'layer'; id: string; layer: Layer }
  | { op: 'insertAfter'; after: string; block: Block }
  | { op: 'insertBefore'; before: string; block: Block }
  | { op: 'remove'; id: string };

/** Every anchor that failed to resolve, so one run reports all of them instead
 *  of dying on the first. A seed file with a typo should be fixed in one pass. */
export const anchorMisses: string[] = [];

const MISS = '__anchor_miss__';

export function applyPatches(base: Block[], patches: Patch[]): Block[] {
  let doc = base.map((b) => ({ ...b }));
  for (const patch of patches) {
    const targetId = 'id' in patch ? patch.id : 'after' in patch ? patch.after : patch.before;
    if (targetId === MISS) continue; // already reported
    switch (patch.op) {
      case 'edit': {
        const target = doc.find((b) => b.id === patch.id);
        if (!target) throw new Error(`patch: no block ${patch.id}`);
        if ('text' in target) (target as { text: string }).text = patch.text;
        break;
      }
      case 'layer': {
        const target = doc.find((b) => b.id === patch.id);
        if (!target) throw new Error(`patch: no block ${patch.id}`);
        target.layer = patch.layer;
        break;
      }
      case 'insertAfter': {
        const at = doc.findIndex((b) => b.id === patch.after);
        if (at < 0) throw new Error(`patch: no anchor ${patch.after}`);
        doc.splice(at + 1, 0, { ...patch.block });
        break;
      }
      case 'insertBefore': {
        const at = doc.findIndex((b) => b.id === patch.before);
        if (at < 0) throw new Error(`patch: no anchor ${patch.before}`);
        doc.splice(at, 0, { ...patch.block });
        break;
      }
      case 'remove': {
        const at = doc.findIndex((b) => b.id === patch.id);
        if (at < 0) throw new Error(`patch: no block ${patch.id}`);
        doc.splice(at, 1);
        break;
      }
    }
  }
  return doc;
}

export function assertNoAnchorMisses(): void {
  if (anchorMisses.length === 0) return;
  const list = [...new Set(anchorMisses)].map((m) => `  · ${m}`).join('\n');
  throw new Error(`${anchorMisses.length} seed anchor(s) did not resolve:\n${list}`);
}

/** Find the id of the nth block matching a predicate — keeps patches readable
 *  without hard-coding generated ids into the content file. */
export function blockId(blocks: Block[], match: { type?: Block['type']; contains?: string; index?: number }): string {
  const candidates = blocks.filter(
    (b) => (!match.type || b.type === match.type) && (!match.contains || JSON.stringify(b).includes(match.contains)),
  );
  const found = candidates[match.index ?? 0];
  if (!found) {
    const available = blocks
      .map((b) => b.type)
      .reduce<Record<string, number>>((acc, t) => ({ ...acc, [t]: (acc[t] ?? 0) + 1 }), {});
    anchorMisses.push(
      `${match.type ?? 'any'} containing ${JSON.stringify(match.contains)} — doc has ${JSON.stringify(available)}`,
    );
    return MISS;
  }
  return found.id;
}

export const doc = (...blocks: Block[]): Block[] => blocks;
