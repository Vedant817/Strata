/**
 * Ask citation-card copy.
 *
 * The share image is a research object: question + quotes from this post.
 * These assertions are the cases a social unfurl must not get wrong — markup
 * leaking into PNG text, a reader id on the card, a generated summary standing
 * in for the source.
 *
 * Run: npx tsx scripts/check-citation-card.ts
 */

import {
  citationCard,
  citationOgPath,
  citationSharePath,
  stripAskMarkup,
} from '../src/lib/citation-card';

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

{
  const text = stripAskMarkup('A <mark>p99</mark> is not a mean. &amp; never was.');
  ok('strips mark tags', text === 'A p99 is not a mean. & never was.', text);
}

{
  const card = citationCard({
    question: '  Why is summing p99s a mistake?  ',
    postTitle: 'The p99 is a lie you tell yourself',
    authorName: 'Mira',
    passages: [
      { blockId: 'b1', quote: 'Summing <mark>p99</mark> latencies is a documented error.' },
      { blockId: 'b2', quote: '' },
      { blockId: 'b3', quote: 'The tail of the sum is not the sum of the tails.' },
    ],
  });
  ok('trims the question', card.question === 'Why is summing p99s a mistake?');
  ok('matched when a quote survives', card.matched === true);
  ok('drops empty quotes', card.quotes.length === 2, String(card.quotes.length));
  ok('kicker names the source', card.kicker === 'Cited from this article');
  ok('matched dek is the post title', card.dek === 'The p99 is a lie you tell yourself');
  ok('footer is the author, not a reader', card.footerLeft === 'by Mira');
  ok('site, not a handle, on the right', card.footerRight === 'strata.pub');
  ok('quotes are plain text', card.quotes[0]?.text.includes('<mark>') === false);
}

{
  const long = 'x'.repeat(400);
  const card = citationCard({
    question: 'What is the budget?',
    postTitle: 'Cache invalidation',
    authorName: 'Vedant',
    passages: [{ blockId: 'b1', quote: long }],
  });
  ok('quotes cap at 170 characters', card.quotes[0]?.text.length === 170);
}

{
  const card = citationCard({
    question: 'Did this mention Kubernetes?',
    postTitle: 'We deleted our staging environment',
    authorName: 'Sam',
    passages: [],
  });
  ok('unmatched is still a card', card.matched === false);
  ok('unmatched kicker is asked-of, not cited', card.kicker === 'Asked of this article');
  ok(
    'unmatched dek refuses to invent an answer',
    card.dek === "This isn't covered in the article.",
  );
  ok('unmatched has no quotes to fake a source', card.quotes.length === 0);
}

{
  const q = 'why p99?';
  const share = citationSharePath('the-p99-is-a-lie-you-tell-yourself', q);
  const og = citationOgPath('the-p99-is-a-lie-you-tell-yourself', q);
  ok('share path is a GET ask on the article', share.startsWith('/w/the-p99-is-a-lie-you-tell-yourself?ask='));
  ok('share path lands on the answer', share.endsWith('#ask'));
  ok('og path is a png, not the article', og.startsWith('/og/the-p99-is-a-lie-you-tell-yourself-ask.png?q='));
  ok('share encodes the question', share.includes('why+p99') || share.includes('why%20p99'));
}

{
  const q = 'a'.repeat(600);
  const card = citationCard({
    question: q,
    postTitle: 'T',
    authorName: 'A',
    passages: [],
  });
  ok('question caps at 500', card.question.length === 500);
}

{
  const card = citationCard({
    question: 'who asked this?',
    postTitle: 'T',
    authorName: 'A',
    passages: [{ blockId: 'b1', quote: 'the article' }],
  });
  const blob = JSON.stringify(card);
  ok('card JSON has no anon id field', blob.includes('anon') === false);
  ok('card JSON has no askedBy field', blob.includes('askedBy') === false);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
