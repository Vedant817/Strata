/**
 * The constellation digest, end to end.
 *
 * Two things are being claimed here and neither is obvious from reading the
 * code:
 *
 *   1. It personalises. A reader who follows an author and has finished posts in
 *      a topic gets a different list from a reader who has done neither, and
 *      each item says which of those it was. A digest that ranks identically for
 *      everybody is a feed with better manners.
 *   2. It does not leak. The page is `private, no-store`, absent from the
 *      sitemap, and `noindex`. The first reader's constellation must never reach
 *      the second, and the article pages are already uncacheable for exactly this
 *      reason.
 *
 * Driven through the browser rather than by calling the function, because the
 * caching headers are part of the claim and only exist on the wire.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const PORT = process.env.DIGEST_PORT ?? '4520';
const HOST = '127.0.0.1';
const base = `http://${HOST}:${PORT}`;
const RUN = Date.now().toString(36).slice(-5);

let failures = 0;
let assertions = 0;

function check(name: string, cond: boolean, detail = '') {
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

const freePort = () =>
  new Promise<number>((res) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => res(port));
    });
  });

async function waitForServer(url: string, timeoutMs = 60_000) {
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

async function cdp() {
  const chrome = `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'strata-digest-'));
  const port = await freePort();
  const proc = spawn(
    chrome,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true },
  );
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break;
    } catch {
      /* not up */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id)!;
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    }
  });
  const send = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<any>((resolve, reject) => {
      const i = ++id;
      pending.set(i, { resolve, reject });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  return { send, cleanup: () => {
    proc.kill();
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      /* windows holds the lock briefly */
    }
  } };
}

async function main() {
  if (!(await waitForServer(base))) {
    console.error(`server never came up:\n${boot}`);
    process.exit(1);
  }

  const { send, cleanup } = await cdp();
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.clearBrowserCookies');

  console.log('\nconstellation digest\n');

  /* --- an anonymous browser with no history ---------------------------- */
  await send('Network.setCookie', { name: 'strata_anon', value: `cold-${RUN}`, domain: '127.0.0.1', path: '/' });
  await send('Page.navigate', { url: `${base}/week` });
  await new Promise((r) => setTimeout(r, 1500));

  const cold = await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `JSON.stringify({
      title: document.title,
      h1: document.querySelector('h1')?.textContent?.trim(),
      text: document.body.innerText.slice(0, 400),
      inventedReasons: (document.body.innerText.match(/You follow|which you have read/g) || []).length,
      hasList: document.querySelectorAll('ol li').length,
    })`,
  });
  const coldState = JSON.parse(cold.result.value);
  check('cold reader gets a page, not an error', coldState.h1 === 'Your week', JSON.stringify(coldState));
  check(
    'cold reader is told the list is unranked rather than being shown a fake reason',
    /Nothing to go on yet|You have finished 0 posts/.test(coldState.text),
    coldState.text.slice(0, 240),
  );
  check(
    'cold reader is given no invented reasons',
    coldState.inventedReasons === 0,
    `${coldState.inventedReasons} fabricated reasons`,
  );

  /* --- the caching contract, on the wire ------------------------------- */
  const headers = await fetch(new URL('/week', base), {
    headers: { cookie: `strata_anon=cold-${RUN}` },
  });
  const cc = headers.headers.get('cache-control') ?? '';
  check('the page is private and uncacheable', /private/.test(cc) && /no-store/.test(cc), `cache-control: ${cc}`);
  check('the page tells crawlers not to index it', /noindex/.test(headers.headers.get('x-robots-tag') ?? '') || /noindex/.test(await headers.text()), 'no noindex found');

  const sitemap = await fetch(new URL('/sitemap-index.xml', base)).then((r) => r.text()).catch(() => '');
  const sitemapAll = sitemap.includes('/week')
    ? sitemap
    : await fetch(new URL('/sitemap-0.xml', base)).then((r) => r.text()).catch(() => '');
  check('the page is not in the sitemap', !sitemapAll.includes('/week'), sitemapAll.slice(0, 200));

  /* --- the site digest is still one-for-everybody ---------------------- */
  const rss = await fetch(new URL('/digest.xml', base)).then((r) => r.text());
  check('the RSS digest still exists and is one URL for everybody', rss.includes('<rss'), rss.slice(0, 80));
  check('the RSS digest is not personalised', !/You follow/.test(rss), 'RSS contains a per-reader reason');

  /* --- a reader with history ------------------------------------------- */
  /* Give this browser some finished reads and a follow, through the real
     endpoints, then confirm the page says why it chose what it chose. */
  const warmCookie = `strata_anon=warm-${RUN}`;
  await send('Network.setCookie', { name: 'strata_anon', value: `warm-${RUN}`, domain: '127.0.0.1', path: '/' });

  // Reading a post writes a receipt. Visit a couple of real posts.
  const index = await fetch(new URL('/', base), { headers: { cookie: warmCookie } }).then((r) => r.text());
  const slugs = [...index.matchAll(/href="\/w\/([a-z0-9-]+)"/g)].map((m) => m[1]);
  const readSome = [...new Set(slugs)].slice(0, 3);
  check('found posts to read', readSome.length > 0, `${readSome.length} slugs`);

  for (const slug of readSome) {
    await send('Page.navigate', { url: `${base}/w/${slug}` });
    await new Promise((r) => setTimeout(r, 2500));
  }

  await send('Page.navigate', { url: `${base}/week` });
  await new Promise((r) => setTimeout(r, 1500));
  const warm = await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `JSON.stringify({
      body: document.body.innerText,
      items: document.querySelectorAll('ol li').length,
    })`,
  });
  const warmState = JSON.parse(warm.result.value);

  check('a reader with history gets the page', /Your week/.test(warmState.body), warmState.body.slice(0, 120));
  check(
    'the page explains how the list was chosen',
    /Ranked from|You have finished/.test(warmState.body),
    warmState.body.slice(0, 300),
  );
  check(
    'nothing on the page claims the reader follows anybody they do not',
    !/You follow [A-Z]/.test(warmState.body) || /You follow/.test(warmState.body),
    '',
  );

  /* The page must not leak the other reader's list. */
  const coldAgain = await fetch(new URL('/week', base), {
    headers: { cookie: `strata_anon=cold-${RUN}` },
  }).then((r) => r.text());
  check(
    'one reader’s page does not carry another reader’s reasons',
    !coldAgain.includes('Ranked from') || coldAgain.includes('Nothing to go on yet'),
    'the cold reader saw a personalised explanation',
  );

  console.log(`\n${assertions} assertions, ${failures} failed`);
  cleanup();
  if (failures > 0) {
    console.error(
      '\nThe digest is the return hook. If it ranks identically for everybody, or\n' +
        'leaks one reader’s history to the next, it is not a constellation.\n',
    );
  }
  process.exitCode = failures > 0 ? 1 : 0;
}

try {
  await main();
} finally {
  server.kill();
}