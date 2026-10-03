/**
 * Audience simulator assertions.
 *
 * PLAN.md §7: "Where does the 8-year-old drop off?"
 * Run: npx tsx scripts/check-audience.ts
 */

import { fleschKincaidGrade, simulateAudience } from '../src/lib/audience';
import type { Block } from '../src/lib/blocks';

let passed = 0;
let failed = 0;

function ok(label: string, condition: boolean, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ok   ${label}${detail ? `  ${detail}` : ''}`);
  } else {
    failed++;
    console.error(`  FAIL ${label}${detail ? `  ${detail}` : ''}`);
  }
}

function para(id: string, text: string): Block {
  return { id, type: 'paragraph', text, layer: 'core' };
}

const EASY = 'The cat sat on the mat. The dog ran to the park. The sun was hot and the day was long.';
const HARD =
  'Invalidation across a replicated cache is a consensus problem whose quorum intersection determines the stale-read window remaining after a write.';

{
  const easyGrade = fleschKincaidGrade(EASY);
  const hardGrade = fleschKincaidGrade(HARD);
  ok('easy prose scores below grade 8', easyGrade < 8, `grade ${easyGrade.toFixed(1)}`);
  ok('hard prose scores at or above grade 8', hardGrade >= 8, `grade ${hardGrade.toFixed(1)}`);
  ok('hard is strictly harder than easy', hardGrade > easyGrade, `${hardGrade.toFixed(1)} > ${easyGrade.toFixed(1)}`);
}

{
  const report = simulateAudience([
    para('p1', EASY),
    para('p2', EASY),
    para('p3', HARD),
    para('p4', EASY),
  ]);
  const child = report.personas.find((p) => p.id === 'child');
  ok('child drops at the hard paragraph', child?.paragraph === 3, child?.detail);
  ok('child names the 8-year-old', !!child?.detail.includes('8-year-old'), child?.detail);
}

{
  const report = simulateAudience([para('p1', EASY), para('p2', EASY), para('p3', EASY)]);
  const child = report.personas.find((p) => p.id === 'child');
  ok('child finishes easy prose', child?.dropBlockId === null, child?.detail);
  ok('finishing is stated, not omitted', !!child?.detail.includes('makes it to the end'), child?.detail);
}

{
  const report = simulateAudience([
    para('p1', EASY),
    para('p2', 'Paragraph two introduces `p99 latency` without saying what it is.'),
    para('p3', EASY),
  ]);
  const outsider = report.personas.find((p) => p.id === 'outsider');
  ok('outsider drops at undefined jargon', outsider?.paragraph === 2, outsider?.detail);
  ok('outsider copy stays grammatical', !!outsider?.detail.startsWith('A smart outsider drops off where'), outsider?.detail);
}

{
  const wall = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
  const report = simulateAudience([para('p1', EASY), para('p2', wall), para('p3', EASY)]);
  const skimmer = report.personas.find((p) => p.id === 'skimmer');
  ok('skimmer drops at a 80-word wall', skimmer?.paragraph === 2, skimmer?.detail);
}

{
  const report = simulateAudience([]);
  ok('empty body produces no personas', report.personas.length === 0);
  ok('empty body scores zero paragraphs', report.paragraphsScored === 0);
}

{
  const grade = fleschKincaidGrade('');
  ok('empty string grade is finite', Number.isFinite(grade));
  ok('empty string grade is not negative', grade >= 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
