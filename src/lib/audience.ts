import { blockToPlainText, type Block } from './blocks';
import { autopsy } from './autopsy';

/**
 * Audience simulator — PLAN.md §7 v3.
 *
 * "Where does the 8-year-old drop off?"
 *
 * Deterministic, no model. A model-backed persona would cost per draft and
 * would say something different every run, which makes it useless as a
 * diagnostic a writer can re-run after a cut. Three first-party heuristics
 * instead, each naming a paragraph:
 *
 *   - child     — Flesch–Kincaid grade ≥ 8
 *   - outsider  — first undefined term of art (reuses Draft Autopsy jargon)
 *   - skimmer   — first wall of text (≥ 70 words in one paragraph)
 *
 * Conservative: a persona that finishes is reported as finishing, not as a
 * missing finding. Empty bodies produce an empty report, not invented drops.
 */

export type PersonaId = 'child' | 'outsider' | 'skimmer';

export interface PersonaDrop {
  id: PersonaId;
  label: string;
  dropBlockId: string | null;
  paragraph: number | null;
  /** The sentence a writer can act on. */
  detail: string;
  quote: string;
  /** Flesch–Kincaid grade of the drop paragraph, when scored. */
  grade: number | null;
}

export interface AudienceReport {
  personas: PersonaDrop[];
  paragraphsScored: number;
}

const CHILD_GRADE = 8;
const SKIM_WORDS = 70;

export function simulateAudience(body: Block[]): AudienceReport {
  const paras = body
    .filter((b) => b.type === 'paragraph')
    .map((b, i) => {
      const text = blockToPlainText(b).replace(/\s+/g, ' ').trim();
      return {
        blockId: b.id,
        paragraph: i + 1,
        text,
        words: wordCount(text),
        grade: fleschKincaidGrade(text),
      };
    })
    .filter((p) => p.words > 0);

  if (paras.length === 0) {
    return { personas: [], paragraphsScored: 0 };
  }

  const child = childDrop(paras);
  const outsider = outsiderDrop(body, paras);
  const skimmer = skimmerDrop(paras);

  return {
    personas: [child, outsider, skimmer],
    paragraphsScored: paras.length,
  };
}

interface Scored {
  blockId: string;
  paragraph: number;
  text: string;
  words: number;
  grade: number;
}

function childDrop(paras: Scored[]): PersonaDrop {
  const hit = paras.find((p) => p.grade >= CHILD_GRADE);
  if (!hit) {
    return {
      id: 'child',
      label: 'An 8-year-old',
      dropBlockId: null,
      paragraph: null,
      detail: 'The 8-year-old makes it to the end.',
      quote: '',
      grade: paras.at(-1)?.grade ?? null,
    };
  }
  return {
    id: 'child',
    label: 'An 8-year-old',
    dropBlockId: hit.blockId,
    paragraph: hit.paragraph,
    detail: `The 8-year-old drops off at paragraph ${hit.paragraph} (grade ${fmtGrade(hit.grade)}).`,
    quote: hit.text.slice(0, 160),
    grade: hit.grade,
  };
}

function outsiderDrop(body: Block[], paras: Scored[]): PersonaDrop {
  const jargon = autopsy({ body }).findings.find((f) => f.kind === 'undefined_jargon');
  if (!jargon) {
    return {
      id: 'outsider',
      label: 'A smart outsider',
      dropBlockId: null,
      paragraph: null,
      detail: 'A smart outsider is not stopped by an undefined term of art.',
      quote: '',
      grade: null,
    };
  }
  const para = paras.find((p) => p.blockId === jargon.blockId);
  return {
    id: 'outsider',
    label: 'A smart outsider',
    dropBlockId: jargon.blockId,
    paragraph: para?.paragraph ?? null,
    detail: `A smart outsider drops off where ${jargon.detail.charAt(0).toLowerCase()}${jargon.detail.slice(1)}`,
    quote: jargon.quote,
    grade: para?.grade ?? null,
  };
}

function skimmerDrop(paras: Scored[]): PersonaDrop {
  const hit = paras.find((p) => p.words >= SKIM_WORDS);
  if (!hit) {
    return {
      id: 'skimmer',
      label: 'A skimmer',
      dropBlockId: null,
      paragraph: null,
      detail: 'A skimmer is not stopped by a wall of text.',
      quote: '',
      grade: null,
    };
  }
  return {
    id: 'skimmer',
    label: 'A skimmer',
    dropBlockId: hit.blockId,
    paragraph: hit.paragraph,
    detail: `A skimmer drops off at paragraph ${hit.paragraph} (${hit.words} words).`,
    quote: hit.text.slice(0, 160),
    grade: hit.grade,
  };
}

/** Flesch–Kincaid grade level. Floored at 0, capped at 18 so a score is a grade. */
export function fleschKincaidGrade(text: string): number {
  const words = Math.max(1, wordCount(text));
  const sentences = Math.max(1, sentenceCount(text));
  const syllables = Math.max(1, syllableCount(text));
  const grade = 0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59;
  if (!Number.isFinite(grade)) return 0;
  return Math.min(18, Math.max(0, grade));
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function sentenceCount(text: string): number {
  const parts = text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  return Math.max(1, parts.length);
}

function syllableCount(text: string): number {
  let n = 0;
  for (const raw of text.split(/\s+/)) n += syllablesIn(raw);
  return Math.max(1, n);
}

function syllablesIn(raw: string): number {
  const w = raw.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 1;
  const stripped = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
  const groups = stripped.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

function fmtGrade(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
