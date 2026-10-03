/**
 * Typed block document model.
 *
 * A post body is a list of typed blocks, never Markdown. This is what makes
 * stable annotation anchors, author-declared depth layers, semantic diffs and
 * per-block comprehension telemetry possible at all.
 *
 * Depth layers:
 *   core      — always visible. The argument itself.
 *   understand— shown at Read and Study. Prerequisites, context, primer cards.
 *   master    — shown only at Study. Footnotes, citations, appendices, private
 *               author margin notes.
 */

import { z } from 'zod';

export const LAYERS = ['core', 'understand', 'master'] as const;
export type Layer = (typeof LAYERS)[number];

const base = {
  id: z.string().min(1),
  layer: z.enum(LAYERS).default('core'),
};

export const paragraphBlock = z.object({
  ...base,
  type: z.literal('paragraph'),
  text: z.string(),
});

export const headingBlock = z.object({
  ...base,
  type: z.literal('heading'),
  level: z.union([z.literal(2), z.literal(3)]).default(2),
  text: z.string(),
});

export const codeBlock = z.object({
  ...base,
  type: z.literal('code'),
  lang: z.string().default('text'),
  code: z.string(),
  caption: z.string().default(''),
  /**
   * Offer "Run this against my inputs" on this block (PLAN.md §4.4, v1.1).
   *
   * Opt-in per block on purpose. A snippet being a `code` block says nothing
   * about whether it is *runnable* — a Kubernetes manifest, a shell pipeline
   * and a server config are all code, and none of them should grow a Run
   * button because of where they sit in the schema. Also gated server-side by
   * `RUNNABLE_CODE`; both must agree.
   */
  runnable: z.boolean().default(false),
  /** The runnable dialect. Kept separate from `lang` so a fenced ```js block
   *  stays highlighted as JavaScript while the sandbox runs it as such. */
  run: z
    .enum(['javascript', 'wasm'])
    .optional()
    .describe('Dialect the sandbox executes. Omit to infer from lang.'),
});

export const listBlock = z.object({
  ...base,
  type: z.literal('list'),
  ordered: z.boolean().default(false),
  items: z.array(z.string()),
});

export const quoteBlock = z.object({
  ...base,
  type: z.literal('quote'),
  text: z.string(),
  attribution: z.string().default(''),
});

export const tableBlock = z.object({
  ...base,
  type: z.literal('table'),
  head: z.array(z.string()),
  rows: z.array(z.array(z.string())),
});

export const calloutBlock = z.object({
  ...base,
  type: z.literal('callout'),
  tone: z.enum(['note', 'warn', 'correction']).default('note'),
  title: z.string().default(''),
  text: z.string(),
});

/** Always visible, and *expanded* at skim — the one thing skim never hides. */
export const tldrBlock = z.object({
  ...base,
  type: z.literal('tldr'),
  text: z.string(),
  layer: z.literal('core').default('core'),
});

/** Glossary card surfaced inline the first time a term is read at Read depth. */
export const primerBlock = z.object({
  ...base,
  type: z.literal('primer'),
  term: z.string(),
  text: z.string(),
  layer: z.literal('understand').default('understand'),
});

export const figureBlock = z.object({
  ...base,
  type: z.literal('figure'),
  src: z.string(),
  alt: z.string(),
  caption: z.string().default(''),
});

/** Author-authored explorable artifact. Read-side in v1; authoring in v3. */
export const interactiveBlock = z.object({
  ...base,
  type: z.literal('interactive'),
  component: z.enum(['curve', 'breakdown', 'matrix', 'timeline']),
  title: z.string().default(''),
  props: z.record(z.string(), z.unknown()).default({}),
});

export const blockSchema = z.discriminatedUnion('type', [
  paragraphBlock,
  headingBlock,
  codeBlock,
  listBlock,
  quoteBlock,
  tableBlock,
  calloutBlock,
  tldrBlock,
  primerBlock,
  figureBlock,
  interactiveBlock,
]);

export type Block = z.infer<typeof blockSchema>;
export type BlockType = Block['type'];
export type ParagraphBlock = Extract<Block, { type: 'paragraph' }>;
export type CodeBlock = Extract<Block, { type: 'code' }>;

/** Blocks whose plain text participates in search, diffs and retrieval. */
export const PROSE_BLOCK_TYPES: BlockType[] = [
  'paragraph',
  'heading',
  'quote',
  'callout',
  'tldr',
  'primer',
  'list',
];

export function parseBody(json: string): Block[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: Block[] = [];
  for (const item of raw) {
    const parsed = blockSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export function serializeBody(blocks: Block[]): string {
  return JSON.stringify(blocks);
}

/** Plain-text projection. Search, diffs, retrieval and anchors all use this. */
export function blockToPlainText(block: Block): string {
  switch (block.type) {
    case 'paragraph':
    case 'quote':
    case 'tldr':
    case 'heading':
      return block.text;
    case 'callout':
      // Title included: a correction's headline is its most quotable part, and
      // dropping it breaks anchoring, search and diffs on every callout.
      return [block.title, block.text].filter(Boolean).join(' — ');
    case 'primer':
      return [block.term, block.text].filter(Boolean).join(' — ');
    case 'code':
      return block.code;
    case 'list':
      return block.items.join('\n');
    case 'table':
      return [block.head.join(' '), ...block.rows.map((r) => r.join(' '))].join('\n');
    case 'figure':
      return [block.alt, block.caption].filter(Boolean).join(' ');
    case 'interactive':
      return [block.title, JSON.stringify(block.props)].filter(Boolean).join(' ');
  }
}

/**
 * The exact string `renderInline` consumes for a block — i.e. what the reader
 * actually sees, excluding any chrome the renderer adds separately (a callout's
 * title, a code caption, a figure's alt text).
 *
 * `blockToPlainText` is the *search/retrieval/anchor* projection and includes
 * those fields. Diffing and display must use this one, or a callout's title
 * shows up twice and code spans render as literal backticks.
 */
export function blockInlineSource(block: Block): string {
  switch (block.type) {
    case 'paragraph':
    case 'heading':
    case 'tldr':
    case 'callout':
    case 'quote':
    case 'primer':
      return block.text;
    case 'code':
      return block.code;
    case 'list':
      return block.items.join('\n');
    case 'table':
      return [block.head.join(' '), ...block.rows.map((r) => r.join(' '))].join('\n');
    case 'figure':
      return [block.alt, block.caption].filter(Boolean).join(' ');
    case 'interactive':
      return [block.title, JSON.stringify(block.props)].filter(Boolean).join(' ');
  }
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function bodyWordCount(blocks: Block[]): number {
  return blocks.reduce((sum, b) => {
    if (b.type === 'heading') return sum; // headings shouldn't inflate estimates
    return sum + countWords(blockToPlainText(b));
  }, 0);
}

/** 220wpm, floored at 1. */
export function readingMinutes(blocks: Block[]): number {
  return Math.max(1, Math.round(bodyWordCount(blocks) / 220));
}

/** Minutes a reader spends at each depth, used for the depth-dial labels. */
export function minutesAtDepth(blocks: Block[], depth: 'skim' | 'understand' | 'master'): number {
  const allowed: Record<typeof depth, Layer[]> = {
    skim: ['core'],
    understand: ['core', 'understand'],
    master: ['core', 'understand', 'master'],
  };
  const words = blocks
    .filter((b) => allowed[depth].includes(b.layer))
    .reduce((sum, b) => sum + countWords(blockToPlainText(b)), 0);
  return Math.max(1, Math.round(words / 220));
}

/** Stable ids so block identity survives a revision. */
export function newBlockId(): string {
  return `b_${Math.random().toString(36).slice(2, 10)}`;
}

/** Heading path for a block, e.g. "Cache invalidation › Read amplification". */
export function headingPaths(blocks: Block[]): Map<string, string> {
  const map = new Map<string, string>();
  const stack: Array<{ level: number; text: string }> = [];
  for (const block of blocks) {
    if (block.type === 'heading') {
      while (stack.length && stack[stack.length - 1]!.level >= block.level) stack.pop();
      stack.push({ level: block.level, text: block.text });
    }
    map.set(
      block.id,
      stack.map((h) => h.text).join(' › '),
    );
  }
  return map;
}

export function isProseBlock(block: Block): boolean {
  return PROSE_BLOCK_TYPES.includes(block.type);
}
