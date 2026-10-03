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
  citationIsShareable,
  citationOgPath,
  citationSharePath,
  citationShareText,
  isUnfurlCrawler,
  stripAskMarkup,
} from '../src/lib/citation-card';
import { safeJsonLd } from '../src/lib/jsonld';

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

/* -------------------------------------------------------------------------- */
/* Injection: the question is a reader-controlled URL parameter, and it ends up */
/* in a `<script type="application/ld+json">` on the article page              */
/* -------------------------------------------------------------------------- */

{
  const payload = `</script><script>alert(1)</script>`;
  const card = citationCard({
    question: payload,
    postTitle: 'T',
    authorName: 'A',
    passages: [{ blockId: 'b1', quote: 'the article' }],
  });
  ok('a script-closing question does not survive into the card', !card.question.includes('<script'), card.question);
  ok('nor as markup at all', !/[<>]/.test(card.question), card.question);
  /* The browser tab reads the title. Astro escapes it, so this is cosmetic —
     but a tab showing `</script><script>alert(1)</script>` is a bad
     advertisement, and an escape sequence does not help in a tab. */
  ok('a share title built from it carries no markup', !/“[^”]*[<>]/.test(`“${card.question}” — T`), `“${card.question}”`);

  /* The real shape of the bug: JSON.stringify does not escape `<`, so the
     rendered `<script>` block can be closed from inside the data. Asserted on
     the actual rendered string, not on the escape helper in isolation. */
  const graph = safeJsonLd({
    '@context': 'https://schema.org',
    '@graph': [{ '@type': 'QAPage', mainEntity: { name: payload } }],
  });
  const rendered = `<script type="application/ld+json">${graph}</script>`;
  ok('the JSON-LD block is the only script in the document', (rendered.match(/<script/g) ?? []).length === 1, rendered);
  ok('nothing after the payload position is parsed as markup', rendered.indexOf('</script>') === rendered.length - '</script>'.length);

  /* And it must still parse as the JSON it claims to be, or escaping the tag
     would have corrupted the structured data to buy security. */
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(graph);
  } catch (err) {
    ok('escaped JSON-LD still parses', false, String(err));
  }
  ok('escaped JSON-LD still parses', parsed !== null);
  ok(
    'and the payload survives intact as data',
    JSON.stringify(parsed).includes('</script><script>alert(1)</script>'),
  );
}

{
  /* An entity-encoded payload must not survive decoding into a tag. Decoding
     before stripping would turn `&lt;script&gt;` into a real tag on a second
     pass, which is why stripAskMarkup strips twice. */
  const card = citationCard({
    question: 'what does &lt;script&gt; do?',
    postTitle: 'T',
    authorName: 'A',
    passages: [{ blockId: 'b1', quote: '&lt;mark&gt;not a tag&lt;/mark&gt; &amp; not markup' }],
  });
  ok('an encoded tag in the question is not markup', !/[<>]/.test(card.question), card.question);
  ok('an encoded tag in a quote is not markup', !/[<>]/.test(card.quotes[0]?.text ?? 'x'), card.quotes[0]?.text);
  ok('but the ampersand entity still decodes', (card.quotes[0]?.text ?? '').includes('&'), card.quotes[0]?.text);
}

/* -------------------------------------------------------------------------- */
/* A shared link must not look like a reader asking a question                 */
/* -------------------------------------------------------------------------- */

for (const ua of [
  'Twitterbot/1.0',
  'facebookexternalhit/1.1',
  'Slackbot-LinkExpanding 1.0',
  'Discordbot/2.0',
  'Mozilla/5.0 (compatible; Googlebot/2.1)',
  'WhatsApp/2.0',
  'LinkedInBot/1.0',
  'TelegramBot',
  'redditbot',
  'Slack-ImgProxy',
]) {
  ok(`recognises ${ua.split('/')[0]}`, isUnfurlCrawler(ua));
}
ok('a real browser is not treated as a crawler', !isUnfurlCrawler('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/140 Safari/537.36'));
ok('a missing user-agent is not treated as a crawler', !isUnfurlCrawler(null));
ok('an empty user-agent is not treated as a crawler', !isUnfurlCrawler(''));

{
  ok('a matched answer is shareable', citationIsShareable({ matched: true }));
  ok('an unmatched question is not', !citationIsShareable({ matched: false }));
  ok('a rate-limited answer is not', !citationIsShareable({ matched: true, error: 'limit' }));
  ok('a refused answer is not', !citationIsShareable({ matched: false, error: 'expired' }));
}

{
  /* The share description is the quotes. If it ever came from the model prose
     instead, a crawler would cache a generated summary as if it were the post. */
  const text = citationShareText([
    { quote: 'Summing <mark>p99</mark> latencies is a documented error.' },
    { quote: 'The tail of the sum is not the sum of the tails.' },
  ]);
  ok('share text is the quotes, plain', !text.includes('<mark>') && text.includes('p99'), text);
  ok('share text is capped', citationShareText([{ quote: 'x'.repeat(500) }]).length <= 240);
  ok('empty passages give an empty string', citationShareText([]) === '');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
