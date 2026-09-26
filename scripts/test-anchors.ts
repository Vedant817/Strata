/**
 * Anchor re-resolution — the load-bearing correctness property of the whole
 * product. A note that silently re-attaches to different prose is worse than no
 * note, because the argument it records is now attached to the wrong sentence.
 *
 *   npx tsx scripts/test-anchors.ts
 */

import { makeAnchor, resolveAnchor, type Anchor } from '../src/lib/repo/annotations';

let pass = 0;
let fail = 0;

function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`);
  }
}

const ORIGINAL = 'You have not fixed a bug. You have introduced a distributed systems problem and given it a friendly name. The tell is that nobody can now state what the system is allowed to get wrong.';
const SENTENCE = 'given it a friendly name';

console.log('anchors');

/* 1. Nothing changed. Offsets still line up. */
{
  const start = ORIGINAL.indexOf(SENTENCE);
  const anchor = makeAnchor('b1', ORIGINAL, start, start + SENTENCE.length);
  const r = resolveAnchor(anchor, ORIGINAL);
  check('unchanged block resolves exact', r, { status: 'exact', start, end: start + SENTENCE.length });
}

/* 2. Text inserted *before* the sentence. Offsets shifted; the sentence is
      still findable. This is the case a bare offset cannot survive. */
{
  const start = ORIGINAL.indexOf(SENTENCE);
  const anchor = makeAnchor('b1', ORIGINAL, start, start + SENTENCE.length);
  const edited = 'Read the room. ' + ORIGINAL;
  const r = resolveAnchor(anchor, edited);
  const expected = edited.indexOf(SENTENCE);
  check('insertion before shifts but resolves', r, { status: 'moved', start: expected, end: expected + SENTENCE.length });
}

/* 3. Text appended after. Offsets unchanged. */
{
  const start = ORIGINAL.indexOf(SENTENCE);
  const anchor = makeAnchor('b1', ORIGINAL, start, start + SENTENCE.length);
  const edited = ORIGINAL + ' And that was the entire value of the local version.';
  const r = resolveAnchor(anchor, edited);
  check('append after stays exact', r.status, 'exact');
}

/* 4. The sentence was rewritten. It must report lost, never re-attach. */
{
  const start = ORIGINAL.indexOf(SENTENCE);
  const anchor = makeAnchor('b1', ORIGINAL, start, start + SENTENCE.length);
  const rewritten = ORIGINAL.replace(SENTENCE, 'given an affectionate nickname');
  const r = resolveAnchor(anchor, rewritten);
  check('rewritten sentence is lost, not reattached', r.status, 'lost');
}

/* 5. The same sentence now appears twice. Context must disambiguate. */
{
  const dup = `${SENTENCE} is the first one and it is mentioned again: ${SENTENCE} is the second.`;
  const secondAt = dup.indexOf(SENTENCE, 5);
  const anchor = makeAnchor('b1', dup, secondAt, secondAt + SENTENCE.length);
  const r = resolveAnchor(anchor, dup);
  check('duplicate resolved by context', r.start, secondAt);
  // Now remove the first occurrence: only the second survives, and it moves.
  const firstGone = `Some other opening. ${SENTENCE} is the second.`;
  const r2 = resolveAnchor(anchor, firstGone);
  const expected = firstGone.indexOf(SENTENCE);
  check('duplicate after first removed moves to survivor', r2, { status: 'moved', start: expected, end: expected + SENTENCE.length });
}

/* 6. A sentence containing an inline code span still anchors cleanly, because
      the client sends the rendered text and the server matches against source. */
{
  const src = 'When `invalidate` returns, every subsequent get sees the new value.';
  const quote = 'every subsequent get sees the new value';
  const at = src.indexOf(quote);
  const anchor: Anchor = makeAnchor('b1', src, at, at + quote.length);
  check('code span: resolves in place', resolveAnchor(anchor, src).status, 'exact');
  const inserted = 'In practice, ' + src;
  const r = resolveAnchor(anchor, inserted);
  check('code span: survives insertion before', r.start, inserted.indexOf(quote));
}

/* 7. Empty selection is handled rather than throwing. */
{
  const anchor = makeAnchor('b1', ORIGINAL, 0, 0);
  check('empty quote is lost, not a crash', resolveAnchor(anchor, ORIGINAL).status, 'lost');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
