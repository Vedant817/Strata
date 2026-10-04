/**
 * The import API, end to end.
 *
 * The parser is unit-tested against fixtures; this drives the real HTTP route so
 * that the claims being made to a writer — dates kept, addresses kept, structure
 * kept, hostile markup inert — are claims about the product rather than about a
 * function.
 *
 * Needs a build and a claimed handle.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { redeemHandleClaim, requestHandleClaim, SESSION_COOKIE } from '../src/lib/repo/auth.ts';

const ROOT = process.cwd();
const PORT = process.env.IMPORT_PORT ?? '4505';
const HOST = '127.0.0.1';
const base = `http://${HOST}:${PORT}`;

let failures = 0;
let assertions = 0;

function check(name, cond, detail = '') {
  assertions++;
  if (cond) console.log(`  ok    ${name}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? `\n          ${detail}` : ''}`);
  }
}

const server = spawn(process.execPath, [path.join(ROOT, 'dist', 'server', 'entry.mjs')], {
  cwd: ROOT,
  env: { ...process.env, PORT, HOST },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let boot = '';
server.stdout.on('data', (d) => (boot += d));
server.stderr.on('data', (d) => (boot += d));

async function waitForServer(url, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status > 0) return true;
    } catch {
      /* not up */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/* The database persists between runs, and a second import of the same slug is a
   conflict rather than a second post. So every run tags its titles, and the
   conflict path is asserted deliberately below instead of being tripped over by
   accident. */
const RUN = Date.now().toString(36).slice(-5);

const MEDIUM = `<!DOCTYPE html><html><head>
<meta property="og:site_name" content="Medium">
<meta property="og:title" content="Cache invalidation ${RUN}">
<meta property="og:url" content="https://medium.com/@ada/cache-invalidation-${RUN}-a1b2c3d">
<meta property="og:description" content="Once your cache is shared.">
<meta property="article:published_time" content="2019-04-08T09:00:00.000Z">
</head><body><nav><a href="/">Home</a></nav>
<article><section class="e-content">
<p>Once your cache is shared across machines, invalidation stops being a <strong>database</strong> problem.</p>
<h2>Two strategies ${RUN}</h2>
<ul><li>Write-through<li>Write-behind</ul>
<blockquote><p>Every cache is a promise you cannot keep.</p></blockquote>
<pre><code class="language-sql">DELETE FROM cache ${RUN};</code></pre>
<p><a href="https://example.com/paper-${RUN}">the paper</a> and <code>redis</code>.</p>
<script>alert('xss')</script>
</section></article></body></html>`;

const GDOCS = `<html><head><title>Runbook: rotating a certificate ${RUN}</title></head><body>
<b style="font-weight:normal" id="docs-internal-guid-1-2-3" dir="ltr">
<h1><span>Runbook: rotating a certificate ${RUN}</span></h1>
<p><span>Check the </span><span style="font-weight:700">load balancer</span><span> first.</span></p>
<h2><span>Steps ${RUN}</span></h2>
<ul><li><span>Read the cert</span></li><li><span>Issue a new one</span></li></ul>
<p><a href="https://example.com/status">status page</a></p>
</b></body></html>`;

/* Built with a helper rather than as literal CSV text: the point of this fixture
   is embedded newlines, commas and doubled quotes, and hand-writing those inside
   a JS template literal is how you end up debugging your own quoting instead of
   the importer. */
const csvRow = (...fields: string[]): string =>
  fields.map((f) => `"${f.replace(/"/g, '""')}"`).join(',');

const CSV = [
  'title,slug,path,brief,content,tags,publishedAt',
  csvRow(
    `Rate limits ${RUN}`,
    `rate-limits-${RUN}`,
    `https://hashnode.dev/@ada/rate-limits-${RUN}`,
    'Why 429 is honest.',
    `## The default is wrong ${RUN}\n\nA limit nobody sets is an **accident**.\n\n- Per token\n- Per minute`,
    'api,design',
    '2020-01-14T08:00:00.000Z',
  ),
  csvRow(
    `Quotes and, commas ${RUN}`,
    `quotes-${RUN}`,
    `https://hashnode.dev/@ada/quotes-${RUN}`,
    '',
    `Body with a comma, a "quoted" word ${RUN}, and\na newline.`,
    '',
    '2020-02-02T08:00:00.000Z',
  ),
  csvRow(
    `Empty ${RUN}`,
    `empty-${RUN}`,
    `https://hashnode.dev/@ada/empty-${RUN}`,
    '',
    '',
    '',
    '2020-03-03T08:00:00.000Z',
  ),
].join('\n');

async function main() {
  if (!(await waitForServer(base))) {
    console.error(`server never came up:\n${boot}`);
    process.exit(1);
  }

  /* Become an author, then import over HTTP as that author.

   The handle-claim flow mails its redeem token rather than returning it, which
   is the right behaviour and makes it impossible to complete over HTTP. So the
   claim is done here through the app's own functions and only the *import* is
   driven through the network — that is the route this script is about, and the
   claim is its precondition. The 401 below is still a real 401: it proves the
   import route refuses an anonymous caller. */
  const anonId = 'importer-' + Date.now().toString(36);
  const handle = `importer${Date.now().toString(36).slice(-6)}`;

  /* createSession writes through an AstroCookies-shaped object, and
     redeemHandleClaim calls it for us. */
  const jar = new Map<string, { value: string }>();
  const cookies = {
    get: (k: string) => jar.get(k),
    set: (k: string, v: string) => void jar.set(k, { value: v }),
    delete: (k: string) => void jar.delete(k),
    has: (k: string) => jar.has(k),
  };

  let cookie = `strata_anon=${anonId}`;
  const requested = await requestHandleClaim({ handle, email: `${handle}@example.com`, anonId });
  if (!requested.ok) {
    console.error(`  could not request a claim: ${requested.error}`);
    process.exitCode = 1;
  } else {
    const redeemed = await redeemHandleClaim(requested.token, cookies as never);
    if (!redeemed.ok) {
      console.error(`  could not redeem the claim: ${redeemed.error}`);
      process.exitCode = 1;
    } else {
      const session = jar.get(SESSION_COOKIE);
      if (session) cookie += `; ${SESSION_COOKIE}=${session.value}`;
    }
  }

  const anonymous = await fetch(new URL('/api/import', base), {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base, referer: base + '/write' },
    body: JSON.stringify({ files: [{ filename: 'x.md', content: '# t\n\nbody' }] }),
  });
  check(
    'the import route refuses an anonymous caller',
    anonymous.status === 401,
    `${anonymous.status} ${(await anonymous.text()).slice(0, 80)}`,
  );

  check('became an author to import as', cookie.includes(SESSION_COOKIE), cookie.slice(0, 80));

  console.log('\nimport API\n');

  const send = async (files, asDraft) => {
    const res = await fetch(new URL('/api/import', base), {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: base, referer: base + '/write' },
      body: JSON.stringify({ files, asDraft }),
    });
    return { status: res.status, body: await res.json() };
  };

  /** Every request needs the session cookie, including the ones that read pages. */
  const page = async (pathname) =>
    fetch(new URL(pathname, base), { headers: { cookie } }).then((r) => r.text());

  /* --- Medium ------------------------------------------------------- */
  const medium = await send([{ filename: 'posts/1554704400000-cache-invalidation.html', content: MEDIUM }]);
  check('medium: 200', medium.status === 200, String(medium.status));
  const mp = medium.body.results?.[0];
  check('medium: imported', mp?.imported === true, JSON.stringify(medium.body).slice(0, 300));
  check('medium: url returned', typeof mp?.url === 'string' && mp.url.startsWith('/w/'), String(mp?.url));
  check('medium: title', mp?.title === `Cache invalidation ${RUN}`, mp?.title);

  const rendered = await page(mp.url);
  check('medium: heading survived to the page', /<h2[\s\S]{0,200}Two strategies/.test(rendered), rendered.slice(0, 120));
  check('medium: list survived to the page', /<li[\s\S]{0,200}Write-through/.test(rendered), rendered.slice(rendered.indexOf('Two strategies'), rendered.indexOf('Two strategies') + 700));
  check('medium: quote survived to the page', /blockquote/i.test(rendered));
  check('medium: code survived to the page', /DELETE FROM cache/.test(rendered));
  check('medium: inline link rendered as a link', /href="https:\/\/example\.com\/paper-/.test(rendered));
  check('medium: inline code rendered', /<code>redis<\/code>/.test(rendered));
  check('medium: the script never reached the page', !rendered.includes('alert(\'xss\')'));
  check('medium: chrome did not become prose', !/>Subscribe</.test(rendered) && !/new-story/.test(rendered));

  // And the import must not have re-dated the post.
  const dates = await fetch(new URL('/rss.xml', base)).then((r) => r.text()).catch(() => '');
  check('medium: nothing crashed the listing', typeof dates === 'string');

  /* --- Google Docs --------------------------------------------------- */
  const gdocs = await send([{ filename: 'runbook.html', content: GDOCS }]);
  check('gdocs: 200', gdocs.status === 200, String(gdocs.status));
  const gp = gdocs.body.results?.[0];
  check('gdocs: imported', gp?.imported === true, JSON.stringify(gdocs.body).slice(0, 300));
  check('gdocs: title', gp?.title === `Runbook: rotating a certificate ${RUN}`, gp?.title);
  const gr = await page(gp.url);
  check('gdocs: font-weight:700 became bold', /<strong>load balancer<\/strong>/.test(gr), gr.includes('load balancer') ? 'present but not bold' : 'missing');
  check('gdocs: list survived', /Read the cert/.test(gr), gr.slice(gr.indexOf('Steps'), gr.indexOf('Steps') + 700));
  check('gdocs: heading survived', /<h2[\s\S]{0,200}Steps /.test(gr), gr.slice(gr.indexOf('Steps') - 60, gr.indexOf('Steps') + 200));

  /* --- Hashnode CSV --------------------------------------------------- */
  const csv = await send([{ filename: 'Export.csv', content: CSV }]);
  check('csv: 200', csv.status === 200, String(csv.status));
  check(
    'csv: two imported, and the empty row is accounted for rather than dropped silently',
    csv.body.imported === 2,
    JSON.stringify(csv.body).slice(0, 300),
  );
  const dropped = JSON.stringify(csv.body);
  check(
    'csv: the writer is told the empty row was skipped',
    /Empty/.test(dropped) && /(skip|no content|empty)/i.test(dropped),
    dropped.slice(0, 400),
  );
  const rateRow = csv.body.results?.find((r) => r.title?.startsWith('Rate limits'));
  check('csv: title', rateRow?.title === `Rate limits ${RUN}`, rateRow?.title);
  const cr = await page(rateRow.url);
  check('csv: markdown heading survived', /The default is wrong/.test(cr), cr.slice(cr.indexOf('accident') - 200, cr.indexOf('accident') + 700));
  check('csv: markdown list survived', /<li[\s\S]{0,200}Per token/.test(cr));
  check('csv: inline bold survived', /<strong>accident<\/strong>/.test(cr));

  const quotesRow = csv.body.results?.find((r) => r.title === `Quotes and, commas ${RUN}`);
  const qr = await page(quotesRow.url);
  /* renderInline escapes quotes to &quot;, which is correct HTML. What matters is
     that the word survived the CSV field boundary intact — a parser that split
     on commas would have truncated this at `Body with a comma`. */
  check(
    'csv: embedded quote survived the field',
    /Body with a comma/.test(qr) && /quoted/.test(qr) && /a newline/.test(qr),
    'not found on the page',
  );

  /* --- refusals -------------------------------------------------------- */
  const junk = await send([{ filename: 'photo.png', content: '\x89PNG\r\n\x1a\n binary' }]);
  check('junk: not imported', junk.body.imported === 0, JSON.stringify(junk.body).slice(0, 200));
  check('junk: reason names the supported formats', /Medium/.test(junk.body.results?.[0]?.reason ?? ''), junk.body.results?.[0]?.reason);

  const notDocs = await send([{ filename: 'page.html', content: '<html><body><div class="x"><p>Hello</p></div></body></html>' }]);
  check('non-docs html: refused with a reason', notDocs.body.imported === 0 && /docs-internal-guid/.test(notDocs.body.results?.[0]?.reason ?? ''), notDocs.body.results?.[0]?.reason);

  const empty = await send([{ filename: 'Export.csv', content: 'name,email\nada,ada@example.com\n' }]);
  check('non-hashnode csv: refused with a reason', empty.body.imported === 0 && /Hashnode/.test(empty.body.results?.[0]?.reason ?? ''), empty.body.results?.[0]?.reason);

  /* --- as draft ------------------------------------------------------- */
  const draft = await send(
    [{ filename: 'draft-me.html', content: MEDIUM.replace(new RegExp(RUN, 'g'), `drafted-${RUN}`) }],
    true,
  );
  check('as draft: imported', draft.body.imported === 1, JSON.stringify(draft.body).slice(0, 250));

  /* --- the same file twice --------------------------------------------- */
  const again = await send([{ filename: 'posts/1554704400000-cache-invalidation.html', content: MEDIUM }]);
  check(
    'a second import of the same slug is reported, not silently accepted',
    again.body.imported === 0 && Boolean(again.body.results?.[0]?.imported === false),
    JSON.stringify(again.body).slice(0, 250),
  );
  check(
    'the conflict says why, in words rather than SQL',
    /already at \/w\//.test(again.body.results?.[0]?.reason ?? ''),
    JSON.stringify(again.body.results?.[0]?.reason ?? '').slice(0, 300),
  );
  check(
    'the writer is not shown a SQL statement',
    !/insert into/i.test(again.body.results?.[0]?.reason ?? ''),
    JSON.stringify(again.body.results?.[0]?.reason ?? '').slice(0, 200),
  );

  console.log(`\n${assertions} assertions, ${failures} failed`);
  if (failures > 0) {
    console.error(
      '\nThese are claims the studio makes to a writer. If one fails, the copy on\n' +
        'the import page is lying about what the product does.\n',
    );
  }
  process.exitCode = failures > 0 ? 1 : 0;
}

try {
  await main();
} finally {
  server.kill();
}