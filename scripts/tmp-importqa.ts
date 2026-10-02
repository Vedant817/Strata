import {
  parseImportFile,
  parseWordpressXml,
  markdownToBlocks,
  htmlToText,
  parseDate,
  slugify,
  parseFrontMatter,
  IMPORT_LIMITS,
} from '../src/lib/import/parse';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (!cond) {
    failures++;
    console.log(`FAIL  ${name} ${detail}`);
  } else {
    console.log(`PASS  ${name}`);
  }
}

/* ---- markdown with front matter ---- */
const md = `---
title: "Percentiles do not add"
date: 2019-04-05T10:30:00Z
url: https://old.blog/percentiles
tags: latency, systems
description: Why p99 cannot be summed.
---

# Percentiles do not add

An opening paragraph that matters.

## The inequality

\`\`\`ts
const x = p99(a) + p99(b);
\`\`\`

- first point
- second point

> a quoted line

| head a | head b |
| --- | --- |
| 1 | 2 |

Closing paragraph with **bold** and \`code\`.
`;

const r = parseImportFile('post.md', md);
const p = r.posts[0];
check('markdown: one post', r.posts.length === 1, JSON.stringify(r.warnings));
check('markdown: title from front matter', p?.title === 'Percentiles do not add', p?.title);
check('markdown: h1 consumed as title', !p?.body.some((b) => b.type === 'heading' && /Percentiles do not add/.test((b as {text:string}).text)));
check('markdown: original date preserved', p?.publishedAt === Date.parse('2019-04-05T10:30:00Z'), String(p?.publishedAt));
check('markdown: original url preserved', p?.originalUrl === 'https://old.blog/percentiles', p?.originalUrl);
check('markdown: categories split', p?.categories.join(',') === 'latency,systems', p?.categories.join(','));
check('markdown: dek from description', p?.dek === 'Why p99 cannot be summed.', p?.dek);
const types = (p?.body ?? []).map((b) => b.type);
check('markdown: block types', ['heading','paragraph','heading','code','list','quote','table','paragraph'].every((t) => types.includes(t as never)), types.join(','));
const code = (p?.body ?? []).find((b) => b.type === 'code') as { lang: string; code: string } | undefined;
check('markdown: code lang + body', code?.lang === 'ts' && code.code.includes('p99(a)'), `${code?.lang}`);
check('markdown: inline markup preserved', (p?.body ?? []).some((b) => b.type === 'paragraph' && (b as {text:string}).text.includes('**bold**')));
check('markdown: no warnings', r.warnings.length === 0, r.warnings.join('; '));

/* ---- title fallback from filename, date fallback to filename mtime absent ---- */
const noFm = parseImportFile('my-first-essay.md', 'Just a body paragraph with no front matter at all.');
check('fallback: title from filename', noFm.posts[0]?.title === 'my first essay', noFm.posts[0]?.title);
check('fallback: no invented date', noFm.posts[0]?.publishedAt === undefined);

/* ---- wordpress ---- */
const wxr = `<?xml version="1.0"?>
<rss version="2.0" xmlns:wp="http://wordpress.com/export/1.2/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
<item>
  <title>Latency budgets are fiction</title>
  <link>https://old.blog/latency-budgets</link>
  <pubDate>Mon, 08 Apr 2019 09:00:00 +0000</pubDate>
  <wp:post_name>latency-budgets</wp:post_name>
  <wp:status>publish</wp:status>
  <category><![CDATA[systems]]></category>
  <content:encoded><![CDATA[<p>First para.</p><script>alert(1)</script><p>Second para with <strong>bold</strong>.</p>]]></content:encoded>
  <excerpt:encoded><![CDATA[The short version.]]></excerpt:encoded>
</item>
</channel></rss>`;
const w = parseWordpressXml(wxr);
check('wxr: one post', w.length === 1);
check('wxr: title', w[0]?.title === 'Latency budgets are fiction', w[0]?.title);
check('wxr: slug from post_name', w[0]?.slug === 'latency-budgets', w[0]?.slug);
check('wxr: original link kept', w[0]?.originalUrl === 'https://old.blog/latency-budgets', w[0]?.originalUrl);
check('wxr: date parsed', w[0]?.publishedAt === Date.parse('2019-04-08T09:00:00Z'), String(w[0]?.publishedAt));
check('wxr: excerpt becomes dek', w[0]?.dek === 'The short version.', w[0]?.dek);
check('wxr: category kept', w[0]?.categories.includes('systems'));
const allText = (w[0]?.body ?? []).map((b) => JSON.stringify(b)).join('');
check('wxr: script contents dropped', !allText.includes('alert(1)'), allText.slice(0, 120));
check('wxr: two paragraphs', (w[0]?.body ?? []).filter((b) => b.type === 'paragraph').length === 2);

/* ---- hostile / hostile edge input ---- */
check('html: script stripped', !htmlToText('<p>a</p><script>evil()</script>').includes('evil'));
check('html: style stripped', !htmlToText('<style>x{}</style><p>b</p>').includes('x{}'));
check('date: bare year', parseDate('2019') === Date.UTC(2019, 0, 1));
check('date: junk rejected', parseDate('not a date') === undefined);
check('date: null safe', parseDate(undefined) === undefined);
check('slug: unicode falls back', slugify('日本語') === 'imported-post', slugify('日本語'));
check('slug: accents folded', slugify('Café Latencia') === 'cafe-latencia', slugify('Café Latencia'));
check('slug: length capped', slugify('x'.repeat(300)).length <= 80);

const huge = 'a'.repeat(IMPORT_LIMITS.maxBytesPerPost + 10);
check('limit: oversized file refused', parseImportFile('big.md', huge).posts.length === 0);

const bomb = Array.from({ length: 1200 }, () => 'para').join('\n\n');
const blocks = markdownToBlocks(bomb, []);
check('limit: block cap enforced', blocks.length <= IMPORT_LIMITS.maxBlocksPerPost, String(blocks.length));

check('detect: junk rejected', parseImportFile('photo.png', '\x89PNG\r\n').posts.length === 0);
check('front matter: nested list ignored', parseFrontMatter('---\ntitle: x\ntags:\n  - a\n  - b\n---\nbody').data.title === 'x');

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);