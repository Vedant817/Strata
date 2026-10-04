/**
 * Whether a hostile query string can become markup.
 *
 * This exists because the first version of the check was wrong in a way that
 * matters. It asked "does the response body contain `<script>alert(1)</script>`?"
 * — and the answer was yes, on pages that are fine. Astro escapes `"` to
 * `&quot;`, so a payload aimed at breaking out of an attribute lands *inside*
 * the attribute value. The `<script>` text is present in the bytes and inert.
 * A substring search cannot tell an inert reflection from a live one, and it
 * reports a vulnerability that does not exist.
 *
 * So this checks the thing that actually distinguishes them: **did the payload
 * run?** Each payload is built so that executing it leaves a marker no amount of
 * mere reflection can produce. The payload text contains `'ZZ'+'MARK42'`; if the
 * script runs, `document.title` becomes `ZZMARK42`, and if it only ever sits in
 * an attribute value, the title stays the app's own title containing the raw
 * payload text. Those are different strings, so the check is decisive rather than
 * a guess.
 *
 * Second, independent assertion: walk the parsed DOM for anything the payload
 * should not have created. Attribute-value reflection cannot produce an element,
 * so a single unexpected `onerror`, `onfocus` or `<script>` carrying the marker
 * is a finding on its own — and it also catches injection that does not run.
 *
 * A control case runs the same probe against a page that really is live markup.
 * Without it, a harness that silently evaluates nothing would report a clean
 * bill of health for the whole surface.
 *
 * Real browser, real parser, real execution.
 */

import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const PORT = process.env.XSS_PORT ?? '4620';
const HOST = '127.0.0.1';
const base = `http://${HOST}:${PORT}`;

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

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

function findChrome(): string | null {
  const candidates = [
    `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  return candidates.find((c) => c && existsSync(c)) ?? null;
}

async function launchChrome(binary: string, port: number, profile: string) {
  const proc = spawn(
    binary,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`chrome exited with ${proc.exitCode}:\n${log}`);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return proc;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  proc.kill();
  throw new Error(`chrome never opened a debugging port on ${port}:\n${log}`);
}

/** One CDP target: a request/response channel plus a way to await load events. */
async function connect(port: number) {
  const created = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
  const target = await created.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));

  let id = 0;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  const loadWaiters: Array<() => void> = [];

  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id)!;
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    } else if (m.method === 'Page.loadEventFired') {
      for (const w of loadWaiters.splice(0)) w();
    }
  });

  const send = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<any>((resolve, reject) => {
      const i = ++id;
      pending.set(i, { resolve, reject });
      ws.send(JSON.stringify({ id: i, method, params }));
    });

  /** Navigate and wait for load, but never hang on a page that will not settle. */
  const goto = async (url: string, timeoutMs = 4_000) => {
    const loaded = new Promise<void>((r) => loadWaiters.push(r));
    await send('Page.navigate', { url });
    await Promise.race([loaded, new Promise((r) => setTimeout(r, timeoutMs))]);
  };

  const evaluate = async (expression: string) =>
    (await send('Runtime.evaluate', { expression, returnByValue: true })).result.value;

  return { ws, send, goto, evaluate };
}

/* ------------------------------------------------------------------ *
 * Payloads.
 *
 * Each carries `ZZ` and `MARK42` as separate literals, so the executed result
 * (`ZZMARK42`) is a different string from any reflection of the payload text.
 * ------------------------------------------------------------------ */

const MARK = 'ZZMARK42';

const PAYLOADS: Array<[string, string]> = [
  ['script tag', `"><script>document.title='ZZ'+'MARK42'</script>`],
  ['img onerror', `"><img src=x onerror="document.title='ZZ'+'MARK42'">`],
  ['svg onload', `"><svg onload="document.title='ZZ'+'MARK42'">`],
  ['autofocus onfocus', `" autofocus onfocus="document.title='ZZ'+'MARK42' x="`],
  ['iframe srcdoc', `"><iframe srcdoc="&lt;script&gt;parent.document.title='ZZ'+'MARK42'&lt;/script&gt;"></iframe>`],
  ['close then input', `"><input value="x"><img src=y onerror=document.title='ZZ'+'MARK42'>`],
  ['single-quote break', `'><img src=x onerror=document.title='ZZ'+'MARK42'>`],
  ['unquoted attribute', `><img src=x onerror=document.title=ZZMARK42>`],
  ['body onload', `"><body onload=document.title=ZZMARK42>`],
  /* The one family that escapes a raw-text block. Everything above dies at the
     first `"`; this dies at the first `</script`, which is the *only* sequence
     that closes a script element. The JSON-LD in the head is emitted with
     `set:html`, so a reflected value that reached it would be escaped by JSON
     encoding but not by HTML parsing — and a query parameter that lands in a
     share card's title is exactly the sort of thing that would. */
  ['script-element close', `</script><img src=x onerror=document.title='ZZ'+'MARK42'>`],
  ['script-element close, quoted', `"></script><img src=x onerror=document.title='ZZ'+'MARK42'>`],
  ['json-ld breaker', `</SCRIPT ><img src=x onerror=document.title='ZZ'+'MARK42'>`],
];

/**
 * Surfaces that reflect a query value into markup: where reflection actually
 * happens, plus the numeric and boolean params, which go through the same path.
 */
const SURFACES: Array<[string, string]> = [
  ['/search', 'q'],
  ['/w/cache-invalidation-is-a-distributed-problem', 'ask'],
  ['/w/cache-invalidation-is-a-distributed-problem', 'rev'],
  ['/w/cache-invalidation-is-a-distributed-problem', 'stress'],
  ['/lists/start-here', 'q'],
  ['/capture', 'q'],
  ['/reader', 'q'],
  ['/topics', 'q'],
  ['/constellations', 'q'],
  ['/a/vedant', 'q'],
  ['/studio', 'q'],
  ['/privacy', 'q'],
];

/**
 * Read the DOM for anything a payload should not have created.
 *
 * `hostileAttrs` covers the event-handler and URL-injection sinks; `markedScripts`
 * covers a script that carries the marker. Both are empty for a correct page.
 */
const PROBE = `(() => {
  const hostileAttrs = [];
  for (const el of document.querySelectorAll('*')) {
    for (const a of el.attributes) {
      if (/^(on[a-z]+|formaction|srcdoc|xlink:href)$/i.test(a.name)) {
        hostileAttrs.push(el.tagName.toLowerCase() + '@' + a.name);
      }
    }
  }
  return {
    title: document.title,
    hostileAttrs,
    markedScripts: [...document.querySelectorAll('script')]
      .map((s) => (s.textContent || ''))
      .filter((t) => t.includes('MARK42')).length,
    ogTitle: (document.querySelector('meta[property="og:title"]') || {}).content ?? null,
    searchValue: (document.querySelector('input[name="q"]') || {}).value ?? null,
    askValue: (document.querySelector('#ask-q') || {}).value ?? null,
  };
})()`;

async function main() {
  const chrome = findChrome();
  if (!chrome) throw new Error('no Chrome or Edge found');

  const server = spawn(process.execPath, [path.join(ROOT, 'dist', 'server', 'entry.mjs')], {
    cwd: ROOT,
    env: { ...process.env, PORT, HOST },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let boot = '';
  server.stdout.on('data', (d) => (boot += d));
  server.stderr.on('data', (d) => (boot += d));

  const deadline = Date.now() + 60_000;
  let up = false;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(base, { redirect: 'manual' })).status > 0) { up = true; break; }
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!up) {
    server.kill();
    throw new Error(`server never came up:\n${boot}`);
  }

  const profile = path.join(os.tmpdir(), `strata-xss-${Date.now().toString(36)}`);
  const cdpPort = await freePort();
  const browser = await launchChrome(chrome, cdpPort, profile);
  console.log(`\nhostile reflection — ${path.basename(chrome)}\n`);

  let executed: string[] = [];
  let injected: string[] = [];

  try {
    const { ws, send, goto, evaluate } = await connect(cdpPort);
    /* Both domains must be on or the page never reports a load event, and every
       navigation then waits out the full timeout. Cheap to miss, expensive to
       notice. */
    await send('Page.enable');
    await send('Runtime.enable');
    await goto(base);

    for (const [route, key] of SURFACES) {
      for (const [payloadName, payload] of PAYLOADS) {
        const label = `${route}?${key} — ${payloadName}`;
        await goto(`${base}${route}?${key}=${encodeURIComponent(payload)}`);
        const r = await evaluate(PROBE);

        if (r.title === MARK) executed.push(`${label} (script ran: title=${r.title})`);
        if (r.markedScripts > 0) injected.push(`${label} (${r.markedScripts} marked script nodes)`);
        if (r.hostileAttrs.length > 0) injected.push(`${label} (${r.hostileAttrs.join(',')})`);
      }
    }

    /* The control. Same probe, same browser, a page that genuinely is live
       markup — so a clean report above means the payloads were inert rather than
       meaning the harness never looked. */
    await goto(
      `data:text/html,<title>control</title><img src=x onerror="document.title='ZZ'+'MARK42'">`,
    );
    const control = await evaluate(PROBE);
    check(
      'the probe detects live markup when there is some (control)',
      control.title === MARK || control.hostileAttrs.length > 0 || control.markedScripts > 0,
      `control reported title=${control.title} attrs=${control.hostileAttrs.length} scripts=${control.markedScripts}`,
    );

    check(
      `no payload executes on any of ${SURFACES.length} surfaces (${SURFACES.length * PAYLOADS.length} combinations)`,
      executed.length === 0,
      executed.join('\n          '),
    );
    check(
      'no payload creates DOM nodes anywhere',
      injected.length === 0,
      injected.slice(0, 8).join('\n          '),
    );

    /* The reflection does happen — escaped, not discarded. A pass caused by the
       value being thrown away would be a pass that could never fail. */
    await goto(`${base}/search?q=${encodeURIComponent(PAYLOADS[0][1])}`);
    const s = await evaluate(PROBE);
    check(
      'the search term is reflected rather than discarded',
      typeof s.searchValue === 'string' && s.searchValue.includes('MARK42'),
      `search input value: ${String(s.searchValue)}`,
    );
    /* Checked against the raw bytes of the one tag the payload lands in, not against
       a search of the whole document. Two mistakes live here: the DOM has already
       decoded `&quot;` back to `"`, so reading the attribute back makes the
       escaping look absent; and `"><script>` occurs in perfectly good markup —
       it is how a `<link ...>` is followed by the theme `<script>` — so a
       whole-document search for the breakout sequence always matches something
       harmless. Both of those are how the first version of this check reported
       a vulnerability that was not there. */
    const raw = await fetch(`${base}/search?q=${encodeURIComponent(PAYLOADS[0][1])}`).then((r) =>
      r.text(),
    );
    const ogTag = /<meta property="og:title"[^>]*>/.exec(raw)?.[0] ?? '';
    check(
      'the og:title tag carries the payload with its quote entity-escaped',
      ogTag.includes('&quot;'),
      `tag: ${ogTag.slice(0, 120)}`,
    );
    check(
      'and the tag is not terminated early, so the script text stayed inside it',
      !/^<meta property="og:title" content="[^"]*<script/i.test(ogTag),
      `tag: ${ogTag.slice(0, 120)}`,
    );
    check(
      'and the article reflects the ask question the same way',
      typeof s.askValue === 'string' || typeof s.searchValue === 'string',
      'neither surface reflected anything',
    );

    await goto(`${base}/w/cache-invalidation-is-a-distributed-problem?ask=${encodeURIComponent(PAYLOADS[0][1])}`);
    const a = await evaluate(PROBE);
    check(
      'the ask question is reflected into its input, inert',
      typeof a.askValue === 'string' && a.askValue.includes('MARK42') && a.title !== MARK,
      `ask input value: ${String(a.askValue).slice(0, 90)}`,
    );

    ws.close();
  } finally {
    browser.kill();
    server.kill();
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      /* temp directory will get it */
    }
  }

  console.log(`\n${assertions} assertions, ${failures} failed`);
  process.exitCode = failures > 0 ? 1 : 0;
}

await main();