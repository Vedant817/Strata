/**
 * Draft Autopsy assertions.
 *
 * The three named diagnostics in PLAN.md §7, plus the cases that must not fire.
 * Run against fixtures, not a live post: a live post's jargon changes with
 * the seed, and a test that depends on seed copy is a test that rot silently.
 *
 * Run: npx tsx scripts/check-autopsy.ts
 */

import { autopsy, autopsyFromVersionBody, type AutopsyAsk, type AutopsyReach } from '../src/lib/autopsy';
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
function heading(id: string, text: string): Block {
  return { id, type: 'heading', level: 2, text, layer: 'core' };
}
function primer(id: string, term: string, text: string): Block {
  return { id, type: 'primer', term, text, layer: 'understand' };
}

const INTRO =
  'Caches exist so the hot path does not wait on a disk. The first request pays; the next twenty do not.';
const MIDDLE =
  'A write-through cache keeps the backing store honest, which is slower on the write and faster on the read that follows.';
const SAME_OUTRO =
  'Caches exist so the hot path does not wait on a disk. The first request pays; the next twenty do not, and that is the whole point of the cache.';
const DIFFERENT_OUTRO =
  'Measure the miss penalty before you add another layer. Most of the time the extra hop costs more than the disk you were trying to hide.';

function filler(id: string, n: number): Block {
  const words = Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
  return para(id, words);
}

/* -------------------------------------------------------------------------- */
/* 1. Undefined jargon                                                         */
/* -------------------------------------------------------------------------- */

{
  const body: Block[] = [
    para('p1', 'Most systems quote a mean and call it done.'),
    para('p2', 'That hides the tail.'),
    para('p3', 'Paragraph three introduces `p99 latency` without ever saying what it is, and then keeps going.'),
    para('p4', 'Readers bounce here.'),
    para('p5', 'A later paragraph talks about queues instead.'),
  ];
  const asks: AutopsyAsk[] = [
    { question: 'what is p99 latency?', blockId: 'p3' },
    { question: 'what is p99 latency exactly', blockId: 'p3' },
    { question: 'why not the mean?', blockId: 'p1' },
    { question: 'what is p99 latency in this post', blockId: 'p3' },
    { question: 'how is the tail measured?', blockId: 'p2' },
    { question: 'p99 latency again', blockId: 'p3' },
    { question: 'queues?', blockId: 'p5' },
    { question: 'why queues', blockId: 'p5' },
    { question: 'is the mean enough', blockId: 'p1' },
  ];
  const report = autopsy({ body, asks });
  const hit = report.findings.find((f) => f.kind === 'undefined_jargon');
  ok('undefined jargon fires', !!hit);
  ok(
    'names the paragraph',
    !!hit && hit.detail.includes('Paragraph 3'),
    hit?.detail,
  );
  ok('names the term', !!hit && hit.detail.includes('p99 latency'), hit?.detail);
  ok(
    'quotes an ask rate when the cohort of questions is large enough',
    !!hit && /\d+% of readers ask/.test(hit.detail),
    hit?.detail,
  );
}

{
  const body: Block[] = [
    primer('pr', 'p99 latency', 'The value that 99% of requests came in under.'),
    para('p1', 'We quote `p99 latency` because the mean lies.'),
    para('p2', 'A primer sits above the first use, so this is defined.'),
    para('p3', 'Nothing more to add about the mean.'),
    para('p4', 'Still nothing.'),
    para('p5', 'Closing without repeating.'),
  ];
  const report = autopsy({
    body,
    asks: [{ question: 'what is p99 latency?', blockId: 'p1' }],
  });
  ok(
    'a primer defines the term — no jargon finding',
    report.findings.every((f) => f.kind !== 'undefined_jargon'),
  );
}

{
  const body: Block[] = [
    para('p1', 'A `p99` is the value that 99% of requests came in under.'),
    para('p2', 'We then quote `p99` in the next sentence because it is already defined.'),
    para('p3', 'More prose about queues and disks and nothing else.'),
    para('p4', 'Still more.'),
    para('p5', 'Done.'),
  ];
  const report = autopsy({ body });
  ok(
    'an in-sentence definition counts',
    report.findings.every((f) => f.kind !== 'undefined_jargon'),
  );
}

{
  const body: Block[] = [
    para('p1', 'Call `getUserById` and then `user.email`.'),
    para('p2', 'These are identifiers, not concepts.'),
    para('p3', 'A post full of code spans must not drown in jargon warnings.'),
    para('p4', 'Still identifiers.'),
    para('p5', 'Closing.'),
  ];
  const report = autopsy({ body });
  ok(
    'code-like backticks do not fire',
    report.findings.every((f) => f.kind !== 'undefined_jargon'),
  );
}

{
  const body: Block[] = [
    para('p1', 'A replica can be at most `ttl x writesPerSecond` of its reads stale.'),
    para('p2', 'That is a formula, not a term that wants a primer.'),
    para('p3', 'The rest of this post is about caches and disks and nothing else.'),
    para('p4', 'Still about caches.'),
    para('p5', 'Closing without a definition of the formula, on purpose.'),
  ];
  const report = autopsy({ body });
  ok(
    'inline formulae do not fire as jargon',
    report.findings.every((f) => f.kind !== 'undefined_jargon'),
  );
}

/* -------------------------------------------------------------------------- */
/* 2. Restated introduction                                                    */
/* -------------------------------------------------------------------------- */

{
  const body: Block[] = [
    para('p1', INTRO),
    para('p2', 'The rest of the opening names the cost of a miss and leaves it there.'),
    para('p3', MIDDLE),
    para('p4', 'Meanwhile eviction policy is a separate argument and should stay one.'),
    para('p5', SAME_OUTRO),
  ];
  const report = autopsy({ body });
  const hit = report.findings.find((f) => f.kind === 'restated_intro');
  ok('restated intro fires', !!hit);
  ok(
    'uses the plan\'s sentence',
    !!hit && hit.detail === 'Your conclusion restates your introduction.',
    hit?.detail,
  );
}

{
  const body: Block[] = [
    para('p1', INTRO),
    para('p2', 'The rest of the opening names the cost of a miss and leaves it there.'),
    para('p3', MIDDLE),
    para('p4', 'Meanwhile eviction policy is a separate argument and should stay one.'),
    para('p5', DIFFERENT_OUTRO),
  ];
  const report = autopsy({ body });
  ok(
    'a different conclusion does not fire',
    report.findings.every((f) => f.kind !== 'restated_intro'),
  );
}

{
  const body: Block[] = [para('p1', INTRO), para('p2', SAME_OUTRO)];
  const report = autopsy({ body });
  ok(
    'a two-paragraph post is not a restated conclusion',
    report.findings.every((f) => f.kind !== 'restated_intro'),
  );
}

/* -------------------------------------------------------------------------- */
/* 3. Long section × drop-off                                                  */
/* -------------------------------------------------------------------------- */

{
  const body: Block[] = [
    heading('h1', 'Setup'),
    filler('a1', 50),
    heading('h2', 'The long argument'),
    filler('b1', 120),
    filler('b2', 120),
    heading('h3', 'Coda'),
    filler('c1', 50),
  ];
  const reach: AutopsyReach[] = [
    { blockId: 'b1', reached: 40 },
    { blockId: 'b2', reached: 16 },
    { blockId: 'a1', reached: 40 },
    { blockId: 'c1', reached: 14 },
  ];
  const report = autopsy({ body, reach, cohort: 40, cohortFloor: 20 });
  const hit = report.findings.find((f) => f.kind === 'long_skipped_section');
  ok('long skipped section fires', !!hit, hit?.detail);
  ok(
    'names the section',
    !!hit && hit.detail.includes('Section 2'),
    hit?.detail,
  );
  ok(
    'quotes a skip rate when the cohort is large enough',
    !!hit && /\d+% of readers skip it/.test(hit.detail ?? ''),
    hit?.detail,
  );
}

{
  const body: Block[] = [
    heading('h1', 'Setup'),
    filler('a1', 50),
    heading('h2', 'The long argument'),
    filler('b1', 120),
    filler('b2', 120),
    heading('h3', 'Coda'),
    filler('c1', 50),
  ];
  const reach: AutopsyReach[] = [
    { blockId: 'b1', reached: 40 },
    { blockId: 'b2', reached: 38 },
  ];
  const report = autopsy({ body, reach, cohort: 40, cohortFloor: 20 });
  ok(
    'a long section that readers finish is not a finding',
    report.findings.every((f) => f.kind !== 'long_skipped_section'),
  );
}

{
  const body: Block[] = [
    heading('h1', 'Setup'),
    filler('a1', 50),
    heading('h2', 'The long argument'),
    filler('b1', 120),
    filler('b2', 120),
    heading('h3', 'Coda'),
    filler('c1', 50),
  ];
  const report = autopsy({ body, reach: [], cohort: 3, cohortFloor: 20 });
  const hit = report.findings.find((f) => f.kind === 'long_skipped_section');
  ok('length still reports below the cohort floor', !!hit, hit?.detail);
  ok(
    'never invents a skip percentage below the floor',
    !!hit && !/readers skip/.test(hit.detail),
    hit?.detail,
  );
}

{
  const report = autopsy({ body: [] });
  ok('empty body produces no findings', report.findings.length === 0);
  ok('an empty array is still an inspected body', report.inspected === true);
}

/* -------------------------------------------------------------------------- */
/* QA round 1 — cases the first 19 fixtures missed                             */
/* -------------------------------------------------------------------------- */

{
  const body: Block[] = [
    heading('h1', 'A'),
    filler('a1', 50),
    heading('h2', 'Long'),
    filler('b1', 120),
    filler('b2', 120),
    heading('h3', 'C'),
    filler('c1', 50),
  ];
  const report = autopsy({
    body,
    reach: [
      { blockId: 'b1', reached: 3 },
      { blockId: 'b2', reached: 1 },
    ],
    cohort: 20,
    cohortFloor: 20,
  });
  const hit = report.findings.find((f) => f.kind === 'long_skipped_section');
  ok('length still reports when only 3 people reached the section', !!hit, hit?.detail);
  ok(
    'skip% is not quoted from 3 section-reachers',
    !!hit && !/readers skip/.test(hit.detail),
    hit?.detail,
  );
}

{
  const body: Block[] = [
    para('p1', '`DEL` returns.'),
    para('p2', 'More prose about queues and disks and nothing else.'),
    para('p3', 'Still more about caches.'),
    para('p4', 'A fourth paragraph so the restated-intro rule stays quiet.'),
    para('p5', 'Closing without repeating the opening.'),
  ];
  const asks: AutopsyAsk[] = [
    { question: 'which model did you use?', blockId: null },
    { question: 'is this deleted?', blockId: null },
    { question: 'what model runs this', blockId: null },
    { question: 'did the model change', blockId: null },
    { question: 'which model is default', blockId: null },
  ];
  const report = autopsy({ body, asks });
  ok(
    'code-span acronym is not re-extracted, even when asks substring-match',
    report.findings.every((f) => f.kind !== 'undefined_jargon'),
  );
}

{
  const body: Block[] = [
    para('p1', 'The cost is `2^n` in the worst case.'),
    para('p2', 'More prose about queues and disks and nothing else.'),
    para('p3', 'Still more about caches.'),
    para('p4', 'A fourth paragraph keeps the restated-intro rule quiet.'),
    para('p5', 'Closing without repeating the opening.'),
  ];
  const report = autopsy({ body });
  ok(
    'exponent formulae do not fire as jargon',
    report.findings.every((f) => f.kind !== 'undefined_jargon'),
  );
}

{
  const body: Block[] = [
    primer('pr', 'p99', 'The value that 99% of requests came in under.'),
    para('p1', 'We quote `p99 latency` because the mean lies.'),
    para('p2', 'A primer on the short form covers the long form.'),
    para('p3', 'Nothing more to add about the mean.'),
    para('p4', 'Still nothing.'),
    para('p5', 'Closing without repeating.'),
  ];
  const report = autopsy({ body });
  ok(
    'a primer on p99 covers `p99 latency`',
    report.findings.every((f) => f.kind !== 'undefined_jargon'),
  );
}

{
  const missing = autopsyFromVersionBody(null);
  ok('missing version is not inspected', missing.inspected === false);
  ok('missing version has no findings', missing.findings.length === 0);

  const badJson = autopsyFromVersionBody('{oops');
  ok('unparseable body is not inspected', badJson.inspected === false);

  const notArray = autopsyFromVersionBody('{"type":"paragraph"}');
  ok('a non-array document is not inspected', notArray.inspected === false);

  const emptyArray = autopsyFromVersionBody('[]');
  ok('an empty block list is inspected', emptyArray.inspected === true);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
