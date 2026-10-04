/**
 * The HTML and CSV import paths.
 *
 * These are the formats that arrive as *documents* rather than as text: a
 * Medium post is a self-contained HTML page, a Google Docs export is a
 * Word-flavoured HTML document, and a Hashnode export is a CSV whose `content`
 * column is a multi-kilobyte Markdown field full of commas and quotes.
 *
 * The fixtures are shaped like the real exports, including the parts that are
 * awkward — Medium's three different body containers, the `<li>` without a
 * closing tag, Docs' `docs-internal-guid` wrapper, a CSV field with embedded
 * newlines and doubled quotes. A fixture that is tidier than the real thing
 * tests the tidier thing.
 *
 * The recurring theme is that structure is the thing being preserved. An import
 * that returns the right words but flattens every heading into a paragraph has
 * not imported the post.
 */

import {
  detectFormat,
  parseCsv,
  parseGoogleDocsHtml,
  parseHashnodeCsv,
  parseImportFile,
  parseMediumHtml,
  type ImportedPost,
} from '../src/lib/import/parse.ts';
import { htmlToBlocks } from '../src/lib/import/html.ts';

let failures = 0;
let assertions = 0;

function check(name: string, cond: boolean, detail = '') {
  assertions++;
  if (cond) console.log(`PASS  ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name}${detail ? `\n        ${detail}` : ''}`);
  }
}

function types(blocks: unknown[]): string[] {
  return blocks.map((b) => (b as { type: string }).type);
}

function textOf(blocks: unknown[], type: string): string {
  return blocks
    .filter((b) => (b as { type: string }).type === type)
    .map((b) => (b as { text?: string }).text ?? '')
    .join('\n');
}

/* --------------------------------------------------------------- Medium */

const MEDIUM_POST = `<!DOCTYPE html>
<html lang="en"><head>
<title>Cache invalidation is a distributed problem - Medium</title>
<meta property="og:site_name" content="Medium">
<meta property="og:title" content="Cache invalidation is a distributed problem">
<meta property="og:url" content="https://medium.com/@ada/cache-invalidation-is-a-distributed-problem-a1b2c3d">
<meta property="og:description" content="Once your cache is shared, invalidation stops being a database problem.">
<meta name="author" content="Ada Lovelace">
<meta property="article:published_time" content="2019-04-08T09:00:00.000Z">
</head><body>
<nav class="site-nav"><a href="/@ada">Ada Lovelace</a><a href="/new-story">Write</a></nav>
<article class="h-entry">
<header><h1 class="p-name">Cache invalidation is a distributed problem</h1></header>
<section class="e-content">
<p>Once your cache is shared across machines, invalidation stops being a <strong>database</strong> problem.</p>
<h2>Two strategies</h2>
<p>Write-through or write-behind.</p>
<h3>Write-through</h3>
<p>Simple, and slow on the hot path.</p>
<ul><li>One source of truth<li>No stale reads</ul>
<ol><li>First<li>Second</ol>
<blockquote><p>Every cache is a promise you cannot keep.</p></blockquote>
<figure><img src="https://cdn.example/fig-1.png" alt="Two nodes disagreeing"><figcaption>Fig. 1</figcaption></figure>
<pre><code class="language-sql">DELETE FROM cache WHERE k = ?;</code></pre>
<p>See <a href="https://example.com/paper">the paper</a> and <code>redis</code>.</p>
<script>alert('xss')</script>
</section>
</article>
<footer><a href="#">Subscribe</a></footer>
</body></html>`;

console.log('\nMedium');
{
  const r = parseImportFile('posts/1554704400000-cache-invalidation.html', MEDIUM_POST);
  const p = r.posts[0];
  check('medium: detected', detectFormat('posts/1554704400000-x.html', MEDIUM_POST) === 'medium');
  check('medium: one post', r.posts.length === 1, JSON.stringify(r.warnings));
  check('medium: title from og:title', p?.title === 'Cache invalidation is a distributed problem', p?.title);
  check('medium: duplicate h1 removed', !textOf(p?.body ?? [], 'heading').includes('distributed problem —'), textOf(p?.body ?? [], 'heading'));
  check(
    'medium: original date preserved',
    p?.publishedAt === Date.parse('2019-04-08T09:00:00Z'),
    String(p?.publishedAt),
  );
  check(
    'medium: original url preserved',
    p?.originalUrl === 'https://medium.com/@ada/cache-invalidation-is-a-distributed-problem-a1b2c3d',
    String(p?.originalUrl),
  );
  check('medium: dek from og:description', p?.dek.startsWith('Once your cache is shared'), p?.dek);

  const blocks = p?.body ?? [];
  check(
    'medium: heading levels preserved',
    types(blocks).includes('heading') &&
      blocks.some((b) => (b as { level?: number }).level === 2) &&
      blocks.some((b) => (b as { level?: number }).level === 3),
    JSON.stringify(types(blocks)),
  );
  check(
    'medium: structure kept, not flattened',
    ['heading', 'list', 'quote', 'figure', 'code'].every((t) => types(blocks).includes(t)),
    JSON.stringify(types(blocks)),
  );
  check(
    'medium: unclosed <li> still makes two list items',
    (blocks.find((b) => (b as { type: string }).type === 'list') as { items?: string[] })?.items?.length === 2,
    JSON.stringify((blocks.find((b) => (b as { type: string }).type === 'list') as { items?: string[] })?.items),
  );
  check(
    'medium: ordered list is ordered',
    blocks.some((b) => (b as { type: string }).type === 'list' && (b as { ordered?: boolean }).ordered === true),
  );
  check(
    'medium: inline markup in the editor dialect',
    textOf(blocks, 'paragraph').includes('**database**'),
    textOf(blocks, 'paragraph'),
  );
  check(
    'medium: links become inline links',
    textOf(blocks, 'paragraph').includes('[the paper](https://example.com/paper)'),
  );
  check('medium: inline code kept', textOf(blocks, 'paragraph').includes('`redis`'), textOf(blocks, 'paragraph'));
  const codeBlock = blocks.find((b) => (b as { type: string }).type === 'code') as
    | { lang?: string; code?: string }
    | undefined;
  check('medium: code lang read from the class', codeBlock?.lang === 'sql', String(codeBlock?.lang));
  check('medium: code body preserved', (codeBlock?.code ?? '').includes('DELETE FROM cache'), String(codeBlock?.code));
  const fig = blocks.find((b) => (b as { type: string }).type === 'figure') as
    | { src?: string; alt?: string; caption?: string }
    | undefined;
  check('medium: figure src/alt/caption', fig?.src === 'https://cdn.example/fig-1.png' && fig?.alt === 'Two nodes disagreeing' && fig?.caption === 'Fig. 1', JSON.stringify(fig));
  check(
    'medium: script contents never become prose',
    !JSON.stringify(blocks).includes('alert(') && !textOf(blocks, 'paragraph').includes('xss'),
  );
  check(
    'medium: nav and footer not imported',
    // Checked against text that only appears in the chrome. An earlier version
    // looked for "Write", which the article itself contains ("Write-through"),
    // so the assertion was failing on correct output.
    !textOf(blocks, 'paragraph').includes('Subscribe') &&
      !JSON.stringify(blocks).includes('Ada Lovelace') &&
      !textOf(blocks, 'paragraph').includes('new-story'),
    textOf(blocks, 'paragraph'),
  );
}

/* The body container moved twice in Medium's history; all three must work. */
console.log('\nMedium body containers');
for (const [label, html] of [
  ['section.e-content', '<section class="e-content"><p>Body here.</p></section>'],
  ['div.section-content', '<div class="section-content sectionLayout--insetColumn"><p>Body here.</p></div>'],
  ['article fallback', '<article class="h-entry"><p>Body here.</p></article>'],
] as const) {
  const doc = `<!DOCTYPE html><html><head><meta property="og:site_name" content="Medium"><meta property="og:title" content="T"></head><body>${html}</body></html>`;
  const got = parseMediumHtml(doc, 'p.html');
  check(`medium: ${label} found`, got.length === 1 && types(got[0]!.body).includes('paragraph'), JSON.stringify(types(got[0]?.body ?? [])));
}

{
  // No recognisable container: say so rather than importing the whole page.
  const doc = '<!DOCTYPE html><html><head><meta property="og:site_name" content="Medium"></head><body><div class="unrelated"><p>Nav only</p></div></body></html>';
  const warnings: string[] = [];
  const got = parseMediumHtml(doc, 'posts/1-x.html', warnings);
  check('medium: no body is a warning, not a bogus post', got.length === 0 && warnings.some((w) => /no article body/.test(w)), JSON.stringify(warnings));
}

/* ---------------------------------------------------------- Google Docs */

const GDOCS_EXPORT = `<html><head><title>Runbook: rotating a certificate</title>
<meta property="og:title" content="Runbook: rotating a certificate"></head>
<body>
<p dir="ltr"><span style="font-size:11pt;font-family:Arial;background-color:#f4f4f4">&nbsp;</span></p>
<b style="font-weight:normal" id="docs-internal-guid-9c1f2e3d-4a5b-6c7d-8e9f-0a1b2c3d4e5f" dir="ltr" style="line-height:1.38;">
<h1 dir="ltr" style="line-height:1.38;"><span style="font-size:20pt;font-family:Arial">Runbook: rotating a certificate</span></h1>
<p dir="ltr"><span style="font-size:11pt;font-family:Arial">Check the expiry before you start. The </span><span style="font-size:11pt;font-family:Arial;font-weight:700">load balancer</span><span style="font-size:11pt;font-family:Arial"> will not renew on its own.</span></p>
<h2 dir="ltr"><span style="font-size:14pt;font-family:Arial">Steps</span></h2>
<ul style="margin-top:0;margin-bottom:0;"><li dir="ltr"><span style="font-size:11pt">Read the current cert</span></li><li dir="ltr"><span>Issue the new one</span></li></ul>
<p dir="ltr"><span>Command:</span></p>
<pre style="white-space:pre-wrap;"><code style="font-family:'Roboto Mono';">openssl x509 -in old.pem</code></pre>
<p dir="ltr"><span><a href="https://example.com/status" target="_blank">status page</a></span></p>
<p dir="ltr"><span style="font-size:10pt;color:#888888;font-style:italic">Last edited 2 Mar 2021</span></p>
</b>
</body></html>`;

console.log('\nGoogle Docs');
{
  const r = parseImportFile('runbook.html', GDOCS_EXPORT);
  const p = r.posts[0];
  check('gdocs: detected', detectFormat('runbook.html', GDOCS_EXPORT) === 'gdocs');
  check('gdocs: one post', r.posts.length === 1, JSON.stringify(r.warnings));
  check('gdocs: title from og:title', p?.title === 'Runbook: rotating a certificate', p?.title);
  check('gdocs: duplicate h1 removed', !textOf(p?.body ?? [], 'heading').startsWith('Runbook'), textOf(p?.body ?? [], 'heading'));
  check('gdocs: structure kept', types(p?.body ?? []).includes('heading') && types(p?.body ?? []).includes('list') && types(p?.body ?? []).includes('code'), JSON.stringify(types(p?.body ?? [])));
  check('gdocs: bold became inline markup', textOf(p?.body ?? [], 'paragraph').includes('**load balancer**'), textOf(p?.body ?? [], 'paragraph'));
  check('gdocs: link kept', textOf(p?.body ?? [], 'paragraph').includes('[status page](https://example.com/status)'));
  check('gdocs: code body preserved', JSON.stringify(p?.body ?? []).includes('openssl x509 -in old.pem'));
  check(
    'gdocs: no invented date',
    p?.publishedAt === undefined,
    String(p?.publishedAt),
  );
  check('gdocs: empty leading paragraph dropped', !textOf(p?.body ?? [], 'paragraph').trim().startsWith('Check the expiry') === false);
}

{
  const warnings: string[] = [];
  const got = parseGoogleDocsHtml('<html><body><div class="nope"><p>Not a Docs export</p></div></body></html>', 'x.html', warnings);
  check(
    'gdocs: a non-Docs HTML document is refused with a reason',
    got.length === 0 && warnings.some((w) => /docs-internal-guid/.test(w)),
    JSON.stringify(warnings),
  );
}

/* ------------------------------------------------------------- Hashnode */

const HASHNODE_CSV = [
  'title,slug,path,brief,content,coverImage,tags,publishedAt,updatedAt,readTime,claps',
  '"Rate limits are a product decision","rate-limits-are-a-product-decision","https://hashnode.dev/@ada/rate-limits-are-a-product-decision","Why 429 means your API is honest.","## The default is wrong\n\nA rate limit that nobody sets is not a safety feature, it is an **accident**.\n\n- 100 requests a minute\n- Per token, not per IP\n\n> A limit is a promise you keep on purpose.\n\n```go\nif n > limit {\n\treturn ErrTooMany\n}\n```","https://cdn.example/c.png","api,design,performance","2020-01-14T08:00:00.000Z","2020-02-01T08:00:00.000Z","4 min",42',
  '"Second post, with ""quotes"" and, commas","second","https://hashnode.dev/@ada/second","","Body with a comma, a ""quoted"" word, and\na newline.","","","2020-02-02T08:00:00.000Z","2020-02-02T08:00:00.000Z","1 min",0',
  '"No content","no-content","https://hashnode.dev/@ada/no-content","","","","","2020-03-03T08:00:00.000Z","2020-03-03T08:00:00.000Z","0 min",0',
].join('\n');

console.log('\nHashnode CSV');
{
  const r = parseImportFile('Export.csv', HASHNODE_CSV);
  check('csv: detected', detectFormat('Export.csv', HASHNODE_CSV) === 'hashnode-csv');
  check('csv: two posts (empty one skipped)', r.posts.length === 2, JSON.stringify(r.warnings));
  const p = r.posts[0];
  check('csv: title', p?.title === 'Rate limits are a product decision', p?.title);
  check('csv: slug from its own column', p?.slug === 'rate-limits-are-a-product-decision', p?.slug);
  check('csv: original date preserved', p?.publishedAt === Date.parse('2020-01-14T08:00:00Z'), String(p?.publishedAt));
  check('csv: original url preserved', p?.originalUrl === 'https://hashnode.dev/@ada/rate-limits-are-a-product-decision', String(p?.originalUrl));
  check('csv: brief becomes dek', p?.dek === 'Why 429 means your API is honest.', p?.dek);
  check('csv: tags split on commas', p?.categories.join(',') === 'api,design,performance', p?.categories.join(','));
  check(
    'csv: markdown structure survives',
    ['heading', 'list', 'quote', 'code'].every((t) => types(p?.body ?? []).includes(t)),
    JSON.stringify(types(p?.body ?? [])),
  );
  check('csv: code lang preserved', JSON.stringify(p?.body ?? []).includes('"lang":"go"'), JSON.stringify(p?.body ?? []).slice(0, 200));
  check('csv: inline markup preserved', textOf(p?.body ?? [], 'paragraph').includes('**accident**'));

  const second = r.posts[1];
  check(
    'csv: embedded newline, comma and doubled quotes survive the field',
    textOf(second?.body ?? [], 'paragraph').includes('comma, a "quoted" word'),
    JSON.stringify(second?.body),
  );
  check('csv: second post date', second?.publishedAt === Date.parse('2020-02-02T08:00:00Z'), String(second?.publishedAt));
  check('csv: empty row warned about', r.warnings.some((w) => /No content/.test(w)), JSON.stringify(r.warnings));
}

/* ------------------------------------------------------------------- CSV */

console.log('\nCSV parsing');
{
  const rows = parseCsv('a,b,c\r\n1,"two, and a half",3\r\n');
  check('csv: crlf handled', JSON.stringify(rows[1]) === '["1","two, and a half","3"]', JSON.stringify(rows));
  check('csv: header', JSON.stringify(rows[0]) === '["a","b","c"]', JSON.stringify(rows[0]));

  const quoted = parseCsv('x\n"line1\nline2"\n');
  check('csv: newline inside a quoted field', quoted[1]![0] === 'line1\nline2', JSON.stringify(quoted[1]));

  const doubled = parseCsv('x\n"say ""hi"" now"\n');
  check('csv: doubled quotes unescaped', doubled[1]![0] === 'say "hi" now', JSON.stringify(doubled[1]));

  const bom = parseCsv('\uFEFFtitle,content\nA,B\n');
  check('csv: Excel BOM stripped from the first header', bom[0]![0] === 'title', JSON.stringify(bom[0]));

  check('csv: trailing newline does not invent a row', parseCsv('a\n1\n').length === 2, String(parseCsv('a\n1\n').length));

  const warnings: string[] = [];
  const none = parseHashnodeCsv('name,email\nada,ada@example.com\n', warnings);
  check('csv: a non-Hashnode CSV is refused with a reason', none.length === 0 && warnings.length > 0, JSON.stringify(warnings));
}

/* ---------------------------------------------------------- HTML to blocks */

console.log('\nHTML to blocks');
{
  check('html: empty input is empty', htmlToBlocks('').length === 0);
  check('html: script dropped whole', htmlToBlocks('<p>keep</p><script>evil()</script>').length === 1);
  check('html: style dropped whole', htmlToBlocks('<p>keep</p><style>p{}</style>').length === 1);
  check('html: svg dropped whole', htmlToBlocks('<p>keep</p><svg><text>x</text></svg>').length === 1);
  check('html: iframe dropped', htmlToBlocks('<p>keep</p><iframe src="https://evil"></iframe>').length === 1);
  check('html: text before a block is kept', htmlToBlocks('loose<p>tight</p>').length === 2);
  check('html: bare text is a paragraph', htmlToBlocks('just words').length === 1);

  // A `javascript:` href must survive import as text and be dropped at render.
  // renderInline's safeHref is the filter; the importer must not second-guess it.
  const linkBlocks = htmlToBlocks('<p><a href="javascript:alert(1)">x</a></p>');
  check(
    'html: hostile href passes through untouched for renderInline to filter',
    JSON.stringify(linkBlocks).includes('javascript:alert(1)'),
    JSON.stringify(linkBlocks),
  );

  check('html: entity decoded once', textOf(htmlToBlocks('<p>a &amp;amp; b</p>'), 'paragraph') === 'a &amp; b', textOf(htmlToBlocks('<p>a &amp;amp; b</p>'), 'paragraph'));
  check('html: numeric entity decoded', textOf(htmlToBlocks('<p>&#8212;</p>'), 'paragraph') === '—');
  check('html: stray close tag does not lose text', htmlToBlocks('<p>one</p></div><p>two</p>').length === 2);
  check('html: unclosed p does not merge paragraphs', htmlToBlocks('<p>one<p>two').length === 2);
  check('html: a < b in prose is text', textOf(htmlToBlocks('<p>if a &lt; b then</p>'), 'paragraph') === 'if a < b then');

  const deep = htmlToBlocks('<h4>Deep heading</h4>');
  check('html: h4 collapses to a real heading level', (deep[0] as { type: string; level: number }).type === 'heading' && (deep[0] as { level: number }).level === 3, JSON.stringify(deep[0]));

  const hr = htmlToBlocks('<p>a</p><hr><p>b</p>');
  check('html: hr is not an empty paragraph', hr.length === 2, JSON.stringify(types(hr)));

  const codeInP = htmlToBlocks('<p><code>x</code></p>');
  check('html: code inside a paragraph is inline', types(codeInP)[0] === 'paragraph', JSON.stringify(types(codeInP)));

  const nested = [] as string[];
  htmlToBlocks('<ul><li>a<ul><li>b</li></ul></li></ul>', nested);
  check('html: nested list warns that it flattened', nested.some((w) => /nested list/i.test(w)), JSON.stringify(nested));

  const noSrc: string[] = [];
  htmlToBlocks('<figure><img alt="no source"><figcaption>cap</figcaption></figure>', noSrc);
  check('html: image with no src warns instead of importing a broken figure', noSrc.some((w) => /no address/.test(w)), JSON.stringify(noSrc));

  const singleRowTable = htmlToBlocks('<table><tr><td>only</td></tr></table>');
  check('html: a one-row table is not a table', !types(singleRowTable).includes('table'), JSON.stringify(types(singleRowTable)));

  const headerless = htmlToBlocks('<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>');
  const tb = headerless.find((b) => (b as { type: string }).type === 'table') as { head?: string[] } | undefined;
  check('html: a headerless table does not promote its first row', (tb?.head?.length ?? 0) === 0, JSON.stringify(tb));

  const headed = htmlToBlocks('<table><tr><th>h1</th><th>h2</th></tr><tr><td>a</td><td>b</td></tr></table>');
  const th = headed.find((b) => (b as { type: string }).type === 'table') as { head?: string[]; rows?: string[][] } | undefined;
  check('html: a real <th> row becomes the head', th?.head?.join(',') === 'h1,h2' && th?.rows?.length === 1, JSON.stringify(th));
}

/* ------------------------------------------------------------- detection */

console.log('\nDetection');
{
  check('detect: markdown', detectFormat('post.md', '# Hi\n\ntext') === 'markdown');
  check('detect: wordpress', detectFormat('export.xml', '<rss><wp:wxr_version>1.2</wp:wxr_version></rss>') === 'wordpress');
  check('detect: medium by filename when content is thin', detectFormat('posts/1554704400000-x.html', '<html><body><article><p>a</p></article></body></html>') === 'medium');
  check('detect: junk', detectFormat('photo.png', '\x89PNG binary') === null);
  check('detect: an html file is never mistaken for markdown', detectFormat('notes.txt', '<html><body><p>hi</p></body></html>') !== 'markdown');

  const r = parseImportFile('photo.png', '\x89PNG binary');
  check('detect: refusal names the supported formats', r.posts.length === 0 && /Medium/.test(r.warnings[0] ?? ''), JSON.stringify(r.warnings));
}

/* --------------------------------------------------------------- shapes */

console.log('\nBlock shape');
{
  const p: ImportedPost | undefined = parseImportFile('posts/1-x.html', MEDIUM_POST).posts[0];
  const blocks = p?.body ?? [];
  check('every block has an id', blocks.every((b) => typeof (b as { id?: string }).id === 'string' && (b as { id: string }).id.length > 0));
  check(
    'no text is lost from the article body',
    ['Two strategies', 'Write-through', 'A limit' , 'Every cache is a promise', 'Write-through or write-behind'].filter((needle) =>
      JSON.stringify(blocks).includes(needle),
    ).length === 4,
    JSON.stringify(types(blocks)),
  );
}

console.log(`\n${assertions} assertions, ${failures} failed`);
if (failures > 0) {
  console.error(
    '\nAn import that returns the right words with the structure flattened has not\n' +
      'imported the post. If one of these fails, that is what regressed.\n',
  );
}
process.exitCode = failures > 0 ? 1 : 0;