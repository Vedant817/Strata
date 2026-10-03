/**
 * After-first-read recommendations.
 *
 * PLAN.md §10.4: three posts — one short, one long, one living diff —
 * inferred from behaviour, never a form.
 *
 * Run: npx tsx scripts/check-recommend.ts
 */

import { pickThree, type RecommendCandidate } from '../src/lib/recommend';

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

function c(id: string, minutes: number, versions: number): RecommendCandidate {
  return {
    id,
    slug: id,
    title: id,
    dek: '',
    readingMinutes: minutes,
    versionCount: versions,
  };
}

{
  const picked = pickThree([c('a', 2, 1), c('b', 12, 1), c('c', 6, 4), c('d', 8, 1)]);
  ok('returns three', picked.length === 3, String(picked.length));
  ok('includes the shortest', picked.some((p) => p.slug === 'a' && p.kind === 'short'));
  ok('includes the longest unread that is not short', picked.some((p) => p.slug === 'b' && p.kind === 'long'));
  ok('includes a living diff', picked.some((p) => p.slug === 'c' && p.kind === 'living'));
  ok('no duplicates', new Set(picked.map((p) => p.slug)).size === picked.length);
}

{
  const picked = pickThree([c('only', 5, 1)]);
  ok('one candidate yields one recommendation', picked.length === 1);
  ok('a single-version post is not labelled living', picked[0]?.kind !== 'living');
}

{
  const picked = pickThree([]);
  ok('empty pool is empty', picked.length === 0);
}

{
  const picked = pickThree([c('s', 2, 1), c('l', 20, 1)]);
  ok('two single-version posts: short and long, no fake living', picked.length === 2);
  ok(
    'kinds are short and long',
    picked.some((p) => p.kind === 'short') && picked.some((p) => p.kind === 'long'),
  );
}

{
  const picked = pickThree([c('rev', 10, 5), c('short', 2, 1), c('long', 20, 1)]);
  ok(
    'living reason names the diff',
    picked.find((p) => p.kind === 'living')?.reason.includes('revised') === true,
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
