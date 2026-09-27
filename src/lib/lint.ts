import { blockToPlainText, type Block } from './blocks';

/**
 * Citation-presence lint, §7.
 *
 * A claim that asserts a number, a percentage, or a date with nothing to
 * point at is the thing that makes technical writing decay — and it is the
 * cheapest thing in the whole product to catch, because the lint is
 * mechanical. It is deliberately *not* a fact-checker: it never claims a
 * claim is wrong, only that nothing in the post supports it, and every hit is
 * phrased as a question a writer can dismiss in one click.
 *
 * Two passes, because the two failure modes look nothing alike:
 *   - hard claims (numbers, percentages, durations) with no citation
 *   - claims with a citation to *this* post's own vocabulary but no link
 *
 * The false-positive rate is the whole design risk, so every rule is
 * conservative and the findings are advisory. A lint that cries wolf gets
 * deleted, and then nothing is checked at all.
 */

/** Words that introduce a quantified assertion. Deliberately short list. */
const QUANTIFIERS = [
  /\d+\s*%/,
  /\b\d{2,}\s?(?:ms|s|kb|mb|gb|tb|x)\b/i,
  /\b(?:in|within|after|about|roughly|approximately)\s+\d+\s*(?:ms|s|m|h|d|min|hour|day|week|month|year)/i,
  /\b\d+\s*(?:times|×)\b/i,
];

/** Universals, but only where they assert something about the world rather
 *  than describing code or using ordinary prose. "every subsequent get" is a
 *  statement about a function; "nobody can now state what the system is
 *  allowed to do" is a claim about a team. Without this distinction the
 *  absolute rule fires on almost every paragraph and the lint gets deleted. */
const UNIVERSALS = /\b(?:always|never|everyone|nobody|no one)\b/i;

/** Definitions of the term being introduced, not assertions about the world.
 *  "A p99 is the value that 99% of requests came in under" needs no citation
 *  — it *is* the citation. */
const DEFINITION = /\bis (?:the|a|an|just|exactly)\b[^.]{0,60}\b(?:value|term|means|refers|denotes)\b/i;
const DEFINITION_PREFIX = /^(?:a|an|the)\s+[a-z0-9-]{1,20}\s+is\s+/i;

/** A source is present if the post links out, or cites a prior revision of itself. */
const CITATION = /\[([^\]]*)\]\(https?:\/\/[^)]+\)|https?:\/\/\S+|@cite|footnote/i;

export interface LintFinding {
  blockId: string;
  blockIndex: number;
  kind: 'uncited_number' | 'absolute_claim' | 'citation_without_target';
  severity: 'advisory';
  quote: string;
  detail: string;
}

export interface LintReport {
  findings: LintFinding[];
  /** Blocks that looked claim-bearing at all — the denominator that makes the
   *  count legible. "3 findings in 40 paragraphs" is a fact; "3 findings" alone
   *  reads as a verdict on the writer. */
  claimsChecked: number;
  citationsFound: number;
}

export function lintCitations(body: Block[]): LintReport {
  const findings: LintFinding[] = [];
  let claimsChecked = 0;
  let citationsFound = 0;

  body.forEach((block, index) => {
    // Headings are labels, code is the author's own, figures and tables are
    // their own evidence. Linting any of them produces noise, not signal.
    if (['heading', 'code', 'figure', 'table', 'tldr', 'primer'].includes(block.type)) return;

    const raw = blockToPlainText(block);
    if (!raw.trim()) return;

    /* Inline code is the author's own vocabulary, not their claims: `min: 0.5`
       is a config value, not an unsourced statistic. Linting inside backticks
       produced findings against JSON blobs and function signatures, which is
       how a lint earns the reputation of crying wolf. */
    const text = raw.replace(/`[^`]*`/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) return;

    const hasCitation = CITATION.test(text);
    if (hasCitation) citationsFound++;

    /* A block that opens by defining its own term is a primer, not a claim.
       Linting it produced the single most embarrassing class of false
       positive: telling the author that "A p99 is the value that 99% of
       requests came in under" is an unsourced claim. */
    const isDefinition = DEFINITION.test(text) || DEFINITION_PREFIX.test(text);

    for (const rule of QUANTIFIERS) {
      if (isDefinition) break;
      const match = text.match(rule);
      if (!match) continue;
      claimsChecked++;
      if (hasCitation) break;
      findings.push({
        blockId: block.id,
        blockIndex: index,
        kind: 'uncited_number',
        severity: 'advisory',
        quote: excerpt(text, match.index ?? 0, match[0].length),
        detail: 'A number with no source in this post. If it came from a benchmark, say which.',
      });
      // One finding per block is enough; a paragraph with four numbers is one
      // problem to fix, not four.
      break;
    }

    if (!hasCitation && !isDefinition) {
      const universal = text.match(UNIVERSALS);
      if (universal) {
        claimsChecked++;
        findings.push({
          blockId: block.id,
          blockIndex: index,
          kind: 'absolute_claim',
          severity: 'advisory',
          quote: excerpt(text, universal.index ?? 0, universal[0].length),
          detail:
            'An absolute claim with nothing to point at. Either soften it or cite what supports it.',
        });
      }
    }
  });

  return { findings, claimsChecked, citationsFound };
}

function excerpt(text: string, at: number, len: number): string {
  const from = Math.max(0, at - 40);
  const to = Math.min(text.length, at + len + 40);
  return `${from > 0 ? '…' : ''}${text.slice(from, to).replace(/\s+/g, ' ').trim()}${to < text.length ? '…' : ''}`;
}
