/**
 * The metric-compatible fallbacks, verified against the fonts they stand in for.
 *
 * These overrides are the entire reason CLS is 0. Measured before them, the
 * homepage shifted 0.18 every time a webfont arrived, against a budget of 0.02.
 * The numbers in global.css are not estimates — they were solved by rendering
 * the real face and the candidate fallback in this same browser and comparing
 * geometry — and this script is what stops them rotting.
 *
 * It asserts three things per family, because a fallback only helps if it agrees
 * with the webfont on all three:
 *
 *   advance width  if this is out, lines break at different points and body text
 *                  re-wraps on swap
 *   baseline       if this is out, every line moves vertically — the visible jump
 *   line box       if this is out, `line-height: normal` resolves differently,
 *                  so anything not using an explicit line-height reflows
 *
 * Needs Chrome or Edge and a build.
 *   npm run test:fonts:browser
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const PORT = process.env.FONT_PORT ?? '4404';
const HOST = '127.0.0.1';

/**
 * Tolerances. Width is a proportion because the sample string is an average over
 * many glyphs; the two baselines are absolute pixels, where half a pixel is the
 * difference between a visible jump and a rounding artefact.
 */
const WIDTH_TOLERANCE_PCT = 1.5;
const BASELINE_TOLERANCE_PX = 0.5;

/* Family names unquoted; the CSS font shorthand adds the quotes at each use.
   Quoting them here meant the generated page script read
   `document.fonts.load('400 64px 'IBM Plex Serif'')` and did not parse. */
const FAMILIES = [
  { key: 'serif', family: 'IBM Plex Serif', fallback: 'Plex Serif Fallback' },
  { key: 'sans', family: 'IBM Plex Sans Variable', fallback: 'Plex Sans Fallback' },
  { key: 'mono', family: 'IBM Plex Mono', fallback: 'Plex Mono Fallback' },
];

let failures = 0;
let assertions = 0;

function check(condition, label) {
  assertions++;
  if (condition) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.error(`  FAIL  ${label}`);
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

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

const chrome = findChrome();
if (!chrome) {
  console.error('No Chrome or Edge found. Font metrics cannot be measured without one.');
  process.exit(1);
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'strata-fonts-'));
const chromePort = await freePort();
const browser = spawn(
  chrome,
  [
    `--remote-debugging-port=${chromePort}`,
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    'about:blank',
  ],
  { stdio: 'ignore', windowsHide: true },
);
const server = spawn(process.execPath, [path.join(ROOT, 'dist', 'server', 'entry.mjs')], {
  cwd: ROOT,
  env: { ...process.env, PORT, HOST },
  stdio: 'ignore',
  windowsHide: true,
});
const base = `http://${HOST}:${PORT}`;

try {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${chromePort}/json/version`)).ok) break;
    } catch {
      /* not up */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!(await waitForServer(base))) throw new Error(`server never came up at ${base}`);

  const created = await (
    await fetch(`http://127.0.0.1:${chromePort}/json/new?about:blank`, { method: 'PUT' })
  ).json();
  const ws = new WebSocket(created.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));

  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const i = ++id;
      pending.set(i, { resolve, reject });
      ws.send(JSON.stringify({ id: i, method, params }));
    });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: new URL('/', base).href });
  await new Promise((r) => setTimeout(r, 5000));

  // Build the page-side script as a string. Deliberately avoids nested template
  // literals: this is evaluated in the browser, and the escaping is not worth the
  // readability it would cost.
  const loadCalls = FAMILIES.flatMap((f) => [
    `document.fonts.load('400 64px "${f.family}"')`,
    `document.fonts.load('500 64px "${f.family}"')`,
  ]).join(',\n        ');
  const familyRows = JSON.stringify(FAMILIES.map((f) => [f.key, f.family, f.fallback]));

  const script = `
      // Load every real face first. Without this the comparison is between two
      // fallbacks, which would pass for the wrong reason.
      await Promise.all([
        ${loadCalls},
      ]);
      await document.fonts.ready;

      var SAMPLE = 'Handgloves 123 quick brown fox jumps';
      var canvas = document.createElement('canvas');
      var ctx = canvas.getContext('2d');
      function widthOf(family) { ctx.font = '64px "' + family + '"'; return ctx.measureText(SAMPLE).width; }

      // A zero-height inline-block has its bottom margin edge exactly on the
      // text baseline, which is the only reliable way to read it out of the DOM.
      function geometry(family) {
        var el = document.createElement('div');
        el.innerHTML = 'Hxg<span style="display:inline-block;width:0;height:0"></span>';
        el.style.cssText = 'position:absolute;visibility:hidden;top:0;left:0;width:600px;' +
          'font-size:20px;line-height:1.6;font-family:"' + family + '"';
        document.body.appendChild(el);
        var sentinel = el.querySelector('span');
        var baseline = sentinel.getBoundingClientRect().top - el.getBoundingClientRect().top;
        var explicit = el.offsetHeight;
        el.style.lineHeight = 'normal';
        var normal = el.offsetHeight;
        document.body.removeChild(el);
        return { baseline: baseline, lineBoxExplicit: explicit, lineBoxNormal: normal };
      }

      var out = {};
      var rows = ${familyRows};
      for (var i = 0; i < rows.length; i++) {
        var key = rows[i][0], real = rows[i][1], fallback = rows[i][2];
        var r = { width: widthOf(real) };
        var g = geometry(real);
        r.baseline = g.baseline; r.lineBoxExplicit = g.lineBoxExplicit; r.lineBoxNormal = g.lineBoxNormal;
        var f = { width: widthOf(fallback) };
        var h = geometry(fallback);
        f.baseline = h.baseline; f.lineBoxExplicit = h.lineBoxExplicit; f.lineBoxNormal = h.lineBoxNormal;
        out[key] = { real: r, fallback: f };
      }
      return JSON.stringify(out);
  `;

  const measured = await send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async () => {${script}})()`,
  });

  if (measured.exceptionDetails) {
    console.error('page-side script failed:', JSON.stringify(measured.exceptionDetails, null, 1).slice(0, 1200));
    process.exitCode = 1;
  } else {
    const data = JSON.parse(measured.result.value);
    console.log(`\nfont metrics — ${path.basename(chrome)}`);
    console.log('  fallback faces must agree with the webfonts they stand in for\n');

    for (const { key, family, fallback } of FAMILIES) {
      const r = data[key].real;
      const f = data[key].fallback;
      const widthDelta = Math.abs(((f.width - r.width) / r.width) * 100);
      const baselineDelta = Math.abs(f.baseline - r.baseline);
      const lineBoxDelta = Math.abs(f.lineBoxNormal - r.lineBoxNormal);

      check(
        widthDelta <= WIDTH_TOLERANCE_PCT,
        `${key}: advance width within ${WIDTH_TOLERANCE_PCT}% (${widthDelta.toFixed(2)}%: ` +
          `${Math.round(r.width)} -> ${Math.round(f.width)})`,
      );
      check(
        baselineDelta <= BASELINE_TOLERANCE_PX,
        `${key} (${family}): baseline within ${BASELINE_TOLERANCE_PX}px ` +
          `(${r.baseline.toFixed(2)} -> ${f.baseline.toFixed(2)})`,
      );
      check(
        lineBoxDelta <= 1,
        `${key}: line box within 1px (${r.lineBoxNormal} -> ${f.lineBoxNormal})`,
      );
      // An explicit line-height must be untouched by the overrides, or every
      // paragraph's height would depend on which face won the race.
      check(
        f.lineBoxExplicit === r.lineBoxExplicit,
        `${key}: explicit line-height unaffected (${r.lineBoxExplicit}px both)`,
      );
    }

    ws.close();
  }
  console.log(`\n${assertions} assertions, ${failures} failed`);
  if (failures > 0) {
    console.error(
      '\nThese overrides are the only thing standing between a reader and a page\n' +
        'that jumps every time a webfont arrives. Re-solve them by measurement —\n' +
        'note that size-adjust also scales ascent/descent-override — rather than by\n' +
        'estimating from the spec.\n',
    );
  }
} finally {
  browser.kill();
  server.kill();
  try {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    /* Windows holds the profile lock briefly */
  }
}

process.exitCode = failures > 0 ? 1 : 0;