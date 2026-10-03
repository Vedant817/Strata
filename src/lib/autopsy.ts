import {
  blockToPlainText,
  countWords,
  type Block,
} from './blocks';

/**
 * Draft Autopsy — PLAN.md §7.
 *
 * Three named diagnostics, each a sentence a writer can act on:
 *
 *   1. A term is used before (or without) a definition, and readers ask about it.
 *   2. The closing paragraphs restate the opening ones.
 *   3. One section is twice as long as the others *and* readers skip it.
 *
 * The two halves of (3) already lived on `/studio/readers/[slug]` as a drop-off
 * curve and as section lengths the writer can see by reading. Nothing joined
 * them, so the finding the plan names was never produced. This module is that
 * join, plus the two text-only checks that do not need a cohort.
 *
 * Conservative on purpose. A lint that cries wolf gets deleted, and then
 * nothing is checked at all. Every rule below has a corresponding assertion
 * in `scripts/check-autopsy.ts` for the case that must *not* fire.
 */

export type AutopsyKind = 'undefined_jargon' | 'restated_intro' | 'long_skipped_section';

export interface AutopsyAsk {
  question: string;
  blockId: string | null;
}

export interface AutopsyReach {
  blockId: string;
  reached: number;
}

export interface AutopsyFinding {
  kind: AutopsyKind;
  /** Block the writer should look at. Empty only if the finding is post-wide. */
  blockId: string;
  quote: string;
  detail: string;
}

export interface AutopsyInput {
  body: Block[];
  asks?: AutopsyAsk[];
  reach?: AutopsyReach[];
  /** Distinct readers. Skip-rates are withheld below the cohort floor. */
  cohort?: number;
  cohortFloor?: number;
}

export interface AutopsyReport {
  findings: AutopsyFinding[];
  jargonChecked: number;
  sectionsChecked: number;
}

const STOPWORDS = new Set(
  `a an and are as at be but by for from had has have how i if in into is it its
   me my of on or our so that the their them then there these they this to was we
   were what when where which who why will with would you your not no nor than
   also just into over under about after before between against during without
   within because while though although however therefore thus still even only
   more most other some any each few such same own both through after once here
   when those being been doing did does done can could should might may must
   shall will upon per via like unlike including using used use`.split(/\s+/),
);

/** Identifiers, not concepts. `getUserById` is code; `p99 latency` is a term. */
const CODE_IDENT = /^(?:[A-Za-z_]\w*|\w+\.\w+|\w+\(.*\)|[a-z]+(?:[A-Z][a-z0-9]+)+)$/;

const DEFINITION = /\b(?:is|are|means|mean|refers to|stands for|denotes|called)\b/i;

export function autopsy(input: AutopsyInput): AutopsyReport {
  const body = input.body;
  const asks = input.asks ?? [];
  const findings: AutopsyFinding[] = [];

  const jargon = jargonFindings(body, asks);
  findings.push(...jargon.findings);

  const restated = restatedIntro(body);
  if (restated) findings.push(restated);

  const long = longSkippedSection(body, input.reach ?? [], input.cohort ?? 0, input.cohortFloor ?? 20);
  findings.push(...long.findings);

  return {
    findings,
    jargonChecked: jargon.checked,
    sectionsChecked: long.checked,
  };
}

/* -------------------------------------------------------------------------- */
/* 1. Undefined jargon                                                         */
/* -------------------------------------------------------------------------- */

function jargonFindings(body: Block[], asks: AutopsyAsk[]): { findings: AutopsyFinding[]; checked: number } {
  const primers = new Set(
    body
      .filter((b): b is Extract<Block, { type: 'primer' }> => b.type === 'primer')
      .map((b) => b.term.trim().toLowerCase())
      .filter(Boolean),
  );

  const defined = new Set<string>(primers);
  const firstUse = new Map<string, { blockId: string; paragraph: number; quote: string }>();
  let paragraph = 0;
  let checked = 0;

  for (const block of body) {
    if (block.type === 'paragraph') paragraph++;
    if (block.type === 'code' || block.type === 'interactive') continue;

    const text = blockToPlainText(block);
    const terms = extractTerms(text);
    if (terms.length === 0) continue;

    const lowered = text.toLowerCase();
    for (const term of terms) {
      const key = term.toLowerCase();
      if (isDefinedIn(lowered, key) || primers.has(key)) defined.add(key);
      if (!firstUse.has(key) && (block.type === 'paragraph' || block.type === 'callout' || block.type === 'quote')) {
        firstUse.set(key, {
          blockId: block.id,
          paragraph: block.type === 'paragraph' ? paragraph : Math.max(1, paragraph),
          quote: excerptAround(text, term),
        });
      }
    }
  }

  const findings: AutopsyFinding[] = [];
  const seen = new Set<string>();

  for (const [key, use] of firstUse) {
    if (defined.has(key)) continue;
    if (seen.has(key)) continue;
    checked++;

    const askHits = asks.filter((a) => a.question.toLowerCase().includes(key));
    const concept = isConceptTerm(key);
    if (!concept && askHits.length === 0) continue;

    seen.add(key);
    const para = use.paragraph || 1;
    const askedShare = asks.length > 0 ? askHits.length / asks.length : 0;
    let detail = `Paragraph ${para} introduces \`${displayTerm(key, use.quote)}\` without definition.`;
    if (asks.length >= 5 && askHits.length > 0) {
      detail += ` ${Math.round(askedShare * 100)}% of readers ask about it.`;
    } else if (askHits.length > 0) {
      detail += ' Readers have asked about it.';
    }

    findings.push({
      kind: 'undefined_jargon',
      blockId: use.blockId,
      quote: use.quote,
      detail,
    });
    if (findings.length >= 5) break;
  }

  return { findings, checked };
}

function extractTerms(text: string): string[] {
  const out: string[] = [];
  const ticks = text.matchAll(/`([^`\n]{2,40})`/g);
  for (const m of ticks) {
    const term = m[1]!.trim();
    if (term && !looksLikeCode(term)) out.push(term);
  }
  const acronyms = text.matchAll(/\b([A-Z]{2,6})\b/g);
  for (const m of acronyms) {
    const term = m[1]!;
    if (COMMON_ACRONYM.has(term)) continue;
    out.push(term);
  }
  return out;
}

/** Acronyms every technical post is allowed to use without a primer. */
const COMMON_ACRONYM = new Set([
  'HTML', 'CSS', 'HTTP', 'HTTPS', 'URL', 'URI', 'JSON', 'XML', 'PDF', 'FAQ',
  'TODO', 'OK', 'ID', 'US', 'UK', 'UTC', 'API', 'CPU', 'GPU', 'RAM', 'SSD',
  'SQL', 'SSH', 'DNS', 'TLS', 'CLI', 'UI', 'UX', 'OS', 'VM',
]);

function looksLikeCode(term: string): boolean {
  if (CODE_IDENT.test(term)) return true;
  // Arithmetic in a backtick is a formula, not a term of art.
  // The cache post writes `ttl x writesPerSecond`; that is not jargon to define.
  if (/[=/*+\<>()]/.test(term)) return true;
  if (/\sx\s/i.test(term)) return true;
  return false;
}

function isConceptTerm(key: string): boolean {
  if (looksLikeCode(key)) return false;
  if (/\s/.test(key)) return true;
  if (/-/.test(key)) return true;
  if (/\d/.test(key)) return true;
  if (/^[A-Z]{2,6}$/.test(key)) return true;
  return false;
}

function isDefinedIn(haystackLower: string, termLower: string): boolean {
  const escaped = termLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:\`?${escaped}\`?)\\s+${DEFINITION.source}`, 'i');
  return re.test(haystackLower);
}

function displayTerm(key: string, quote: string): string {
  const ticks = quote.match(/`([^`]+)`/);
  if (ticks && ticks[1]!.toLowerCase() === key) return ticks[1]!;
  return key;
}

function excerptAround(text: string, term: string): string {
  const idx = text.toLowerCase().indexOf(term.toLowerCase());
  if (idx < 0) return text.replace(/\s+/g, ' ').trim().slice(0, 140);
  const from = Math.max(0, idx - 40);
  const to = Math.min(text.length, idx + term.length + 40);
  return `${from > 0 ? '…' : ''}${text.slice(from, to).replace(/\s+/g, ' ').trim()}${to < text.length ? '…' : ''}`;
}

/* -------------------------------------------------------------------------- */
/* 2. Conclusion restates introduction                                         */
/* -------------------------------------------------------------------------- */

function restatedIntro(body: Block[]): AutopsyFinding | null {
  const prose = body.filter((b) => b.type === 'paragraph');
  // Need an opening, a middle, and a closing. Four paragraphs can still be
  // two ideas said twice; five is the smallest shape that has a middle.
  if (prose.length < 5) return null;

  const opening = prose.slice(0, 2);
  const last = prose[prose.length - 1]!;
  if (opening.some((b) => b.id === last.id)) return null;

  const a = tokensOf(opening.map(blockToPlainText).join(' '));
  // The last paragraph is the conclusion. Mixing in the penultimate one
  // lets a distinct "meanwhile…" paragraph drown a restated ending.
  const b = tokensOf(blockToPlainText(last));
  if (a.size < 8 || b.size < 8) return null;

  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  const union = a.size + b.size - shared;
  const jaccard = union === 0 ? 0 : shared / union;
  if (shared < 6 || jaccard < 0.45) return null;

  return {
    kind: 'restated_intro',
    blockId: last.id,
    quote: blockToPlainText(last).replace(/\s+/g, ' ').trim().slice(0, 160),
    detail: 'Your conclusion restates your introduction.',
  };
}

function tokensOf(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 4) continue;
    if (STOPWORDS.has(raw)) continue;
    out.add(raw);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* 3. Long section × drop-off                                                  */
/* -------------------------------------------------------------------------- */

interface Section {
  index: number;
  title: string;
  headingId: string;
  blocks: Block[];
  words: number;
}

function longSkippedSection(
  body: Block[],
  reach: AutopsyReach[],
  cohort: number,
  cohortFloor: number,
): { findings: AutopsyFinding[]; checked: number } {
  const sections = splitSections(body);
  const checked = sections.length;
  if (sections.length < 3) return { findings: [], checked };

  const words = sections.map((s) => s.words).filter((n) => n > 0);
  if (words.length < 3) return { findings: [], checked };

  const median = medianOf(words);
  if (median < 40) return { findings: [], checked };

  const byId = new Map(reach.map((r) => [r.blockId, r.reached]));
  const findings: AutopsyFinding[] = [];
  const canQuoteSkip = cohort >= cohortFloor && reach.length > 0;

  for (const section of sections) {
    if (section.words < median * 2) continue;

    const prose = section.blocks.filter((b) => b.type === 'paragraph' || b.type === 'quote' || b.type === 'list');
    const first = prose[0];
    const last = prose[prose.length - 1];
    let skipShare: number | null = null;
    if (first && last && canQuoteSkip) {
      const start = byId.get(first.id) ?? 0;
      const end = byId.get(last.id) ?? 0;
      if (start >= 3) skipShare = Math.max(0, (start - end) / start);
    }

    // Length alone is not the finding the plan names. Without a skip signal we
    // still report the length, because a writer can cut a section before twenty
    // readers exist. We never invent a skip percentage.
    if (skipShare !== null && skipShare < 0.4) continue;

    const ratio = median === 0 ? 0 : section.words / median;
    const label = section.title ? `Section ${section.index} (“${section.title}”)` : 'The opening';
    let detail = `${label} is ${formatRatio(ratio)} longer than the rest of the post`;
    if (skipShare !== null) {
      detail += ` and ${Math.round(skipShare * 100)}% of readers skip it.`;
    } else {
      detail += '.';
    }

    const quoteBlock = first ?? section.blocks[0];
    findings.push({
      kind: 'long_skipped_section',
      blockId: quoteBlock?.id ?? section.headingId,
      quote: quoteBlock ? blockToPlainText(quoteBlock).replace(/\s+/g, ' ').trim().slice(0, 160) : section.title,
      detail,
    });
  }

  return { findings: findings.slice(0, 3), checked };
}

function splitSections(body: Block[]): Section[] {
  const sections: Section[] = [];
  let current: Section = { index: 0, title: '', headingId: '', blocks: [], words: 0 };

  const flush = () => {
    if (current.blocks.length === 0 && !current.title) return;
    sections.push(current);
  };

  let nextIndex = 1;
  for (const block of body) {
    if (block.type === 'heading' && block.level === 2) {
      flush();
      current = { index: nextIndex++, title: block.text.trim(), headingId: block.id, blocks: [], words: 0 };
      continue;
    }
    current.blocks.push(block);
    if (block.type !== 'heading') current.words += countWords(blockToPlainText(block));
  }
  flush();
  return sections;
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1]! + sorted[mid]!) / 2;
  return sorted[mid]!;
}

function formatRatio(ratio: number): string {
  const rounded = Math.round(ratio * 2) / 2;
  if (Number.isInteger(rounded)) return `${rounded}×`;
  return `${rounded.toFixed(1)}×`;
}
