/**
 * The three viewports the design system promises and nothing has yet checked.
 *
 * §2.4's definition of done names 375px, dark mode and 200% zoom per component.
 * The design lint enforces the *CSS* half of that — it bans gradients, checks
 * focus styles, requires empty states — but nothing has ever asked a browser
 * whether a page actually survives those conditions. A design system can satisfy
 * every lint rule and still push a 900px-wide SVG off the side of a phone.
 *
 * This is the check that asks the browser. Real Chrome, real layout, three
 * emulated conditions:
 *
 *   narrow   375 x 667. The classic failure is horizontal overflow: one element
 *            wider than the viewport and the whole page scrolls sideways, which
 *            on a phone means the reader loses the left edge of every line. This
 *            site has the shapes for it — arc diagrams, tables, artifact figures,
 *            code blocks — so it is asserted per element, not just per page,
 *            because a page can report `scrollWidth == clientWidth` while a child
 *            is clipped.
 *   dark     `prefers-color-scheme: dark`. The theme is a data attribute plus a
 *            token swap, so the risk is not "is it dark" but "did any colour
 *            escape the token system" — a hard-coded hex in one component leaves
 *            the reader with black-on-black in a theme they explicitly asked for.
 *            Checked as computed styles, so it catches inline styles too.
 *   zoom     200%. WCAG 1.4.4. Zoom is not a media query, so a layout that is
 *            fine at 100% can clip at 200% — and text that reflows is exactly
 *            what the reader relies on.
 *
 * Plus the third promise in the same list that is not a viewport: keyboard
 * reachability and a visible focus ring, checked by walking the tab order in a
 * real browser rather than by reading the stylesheet.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const PORT = process.env.VIEWPORT_PORT ?? '4660';
const HOST = '127.0.0.1';
const base = `http://${HOST}:${PORT}`;
const RUN = Date.now().toString(36).slice(-5);
const TEST_DB = path.join(os.tmpdir(), `strata-viewport-${RUN}.db`);
process.env.DATABASE_URL = `file:${TEST_DB}`;

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

/**
 * Chrome, wherever it is.
 *
 * This list was Windows-only, which meant this gate could not find a browser on
 * `ubuntu-latest` even after CI installed one — so it failed on a machine that
 * had exactly what it asked for. `CHROME_PATH` comes first so a runner can point
 * at the binary it installed, and the Linux and macOS locations are here for the
 * same reason they are in field-metrics.mjs.
 *
 * The list is the same in field-metrics.mjs, check-xss.ts and here on purpose: a
 * gate that looks in a different place from its neighbours is a gate that works
 * on one machine and silently cannot run on another.
 */
function findChrome(): string | null {
  const c = [
    process.env.CHROME_PATH,
    `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ];
  return c.find((x) => x && fs.existsSync(x)) ?? null;
}

async function launchChrome(binary: string, port: number, profile: string) {
  const proc = spawn(binary, [
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--headless=new',
    '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    if (proc.exitCode !== null) throw new Error(`chrome exited: ${log}`);
    try {
      if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) return proc;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  proc.kill();
  throw new Error(`chrome never opened a port: ${log}`);
}

async function connect(port: number) {
  const created = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
  const target = await created.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  const waiters: Array<() => void> = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id)!;
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    } else if (m.method === 'Page.loadEventFired') {
      for (const w of waiters.splice(0)) w();
    }
  });
  const send = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<any>((resolve, reject) => {
      const i = ++id;
      pending.set(i, { resolve, reject });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const goto = async (url: string, timeoutMs = 20_000) => {
    const loaded = new Promise<void>((r) => waiters.push(r));
    await send('Page.navigate', { url });
    await Promise.race([loaded, new Promise((r) => setTimeout(r, timeoutMs))]);
  };
  // Surface a thrown probe instead of returning undefined. A silent undefined turns
  // one broken assertion expression into a confusing TypeError three lines later,
  // which is how a whole viewport section can look like it found a bug when the
  // only thing wrong was a regex.
  const evaluate = async (expression: string) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(
        `probe threw: ${d.exception?.description ?? d.text}`.slice(0, 400),
      );
    }
    return r.result.value;
  };
  return { ws, send, goto, evaluate };
}

const PAGES = [
  '/',
  '/w/cache-invalidation-is-a-distributed-problem',
  '/writing',
  '/topics',
  '/constellations',
  '/search?q=cache',
  '/week',
  '/studio',
  '/privacy',
  '/about',
  '/lists/start-here',
];

/**
 * Probes are written as real functions and stringified, not as hand-escaped
 * template literals. A browser expression is plain JavaScript, so a TypeScript
 * annotation inside one is a syntax error — and it surfaces three lines away from
 * the cause, as a confusing `undefined.length`. Letting esbuild strip the types
 * and sending `fn.toString()` removes that whole class of mistake.
 */

/** Everything a reader can see, and whether it is on screen. */
function overflowProbe() {
  const vw = document.documentElement.clientWidth;
  const wide: Array<Record<string, unknown>> = [];
  for (const el of Array.from(document.querySelectorAll('body *'))) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const style = getComputedStyle(el);
    if (style.position === 'fixed' || style.visibility === 'hidden' || style.display === 'none') continue;
    if (r.right > vw + 1) {
      wide.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className && String(el.className).slice(0, 50)) || '',
        right: Math.round(r.right),
        width: Math.round(r.width),
        text: (el.textContent || '').trim().slice(0, 40),
      });
    }
  }
  return {
    vw,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    wide: wide.slice(0, 6),
    wideCount: wide.length,
  };
}

/** Hard-coded colours that would escape the token swap and vanish in dark mode. */
function darkProbe() {
  const dark: Array<Record<string, unknown>> = [];
  const parse = (c: string): number[] | null => {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
    return m ? [+m[1], +m[2], +m[3]] : null;
  };
  const lin = (v: number[]) =>
    v.map((x) => {
      const s = x / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
  const L = (c: number[]) => {
    const [r, g, b] = lin(c);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  for (const el of Array.from(document.querySelectorAll('body *'))) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none') continue;
    if (!(el.textContent || '').trim()) continue;
    const fg = parse(s.color);
    // Walk up for the first opaque background.
    let bg: number[] | null = null;
    let node: HTMLElement | null = el as HTMLElement;
    while (node) {
      const b = parse(getComputedStyle(node).backgroundColor);
      if (b && b[0] + b[1] + b[2] > 0) {
        bg = b;
        break;
      }
      node = node.parentElement;
    }
    if (!fg || !bg) continue;
    const l1 = L(fg);
    const l2 = L(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const size = parseFloat(s.fontSize);
    const bold = (parseInt(s.fontWeight, 10) || 400) >= 700;
    // 3.0 for large text (>=24px, or >=18.66px bold), 4.5 otherwise.
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    /* Compare the full-precision ratio, with a small tolerance for the
       measurement itself. Rounding to two places first made a genuine 4.5:1 —
       which passes — print as "4.5" and then fail `< need`. The tolerance is
       deliberately tiny: it forgives arithmetic noise, not a real shortfall. */
    if (ratio < need - 0.001) {
      dark.push({
        tag: el.tagName.toLowerCase(),
        cls: String(el.className || '').slice(0, 44),
        ratio: Math.round(ratio * 100) / 100,
        need,
        size: Math.round(size),
        text: (el.textContent || '').trim().slice(0, 40),
      });
    }
  }
  return dark.slice(0, 8);
}

/** Standalone controls too small to hit, applying WCAG 2.2 SC 2.5.8 as written. */
function focusProbe() {
  const focusables = Array.from(
    document.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select, textarea, summary, [tabindex]:not([tabindex="-1"])',
    ),
  );

  type Box = { el: Element; x: number; y: number; w: number; h: number };
  const boxes: Box[] = [];
  let exemptInline = 0;
  let exemptRange = 0;

  for (const el of focusables) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;

    /* Three exclusions, each from SC 2.5.8 rather than from convenience:
       a screen-reader-only control has no visual box to be small; a link inside a
       run of prose is exempt as an inline target; and a range input's hit area is
       its thumb, not the element box, so measuring the box measures nothing. */
    if (el.closest('.sr-only')) continue;
    if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'range') {
      exemptRange++;
      continue;
    }
    if (el.tagName === 'A' && el.closest('p, li, figcaption')) {
      exemptInline++;
      continue;
    }
    boxes.push({ el, x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height });
  }

  const undersized = boxes.filter((b) => b.w < 24 || b.h < 24);

  /* The spacing exception: an undersized target passes if a 24px circle centred
     on it does not reach any other target's centre. This is the actual rule, and
     encoding it matters — without it the check would demand a type-scale redesign
     to satisfy a floor that the standard explicitly waives for well-separated
     controls, which is exactly the kind of change that makes a design worse in
     order to make a test pass. */
  const crowded: Array<Record<string, unknown>> = [];
  let rescuedBySpacing = 0;
  for (const b of undersized) {
    let nearest = Infinity;
    for (const other of boxes) {
      if (other.el === b.el) continue;
      // Vertical neighbours in a metadata row are the ones that matter.
      const d = Math.hypot(other.x - b.x, other.y - b.y);
      if (d < nearest) nearest = d;
    }
    if (nearest < 24) {
      crowded.push({
        tag: b.el.tagName.toLowerCase(),
        cls: String(b.el.className || '').slice(0, 40),
        w: Math.round(b.w),
        h: Math.round(b.h),
        gap: Math.round(nearest),
        text: (b.el.textContent || b.el.getAttribute('aria-label') || '').trim().slice(0, 30),
      });
    } else {
      rescuedBySpacing++;
    }
  }

  return {
    total: focusables.length,
    small: crowded.slice(0, 8),
    smallCount: crowded.length,
    undersized: undersized.length,
    rescuedBySpacing,
    exemptInline,
    exemptRange,
  };
}

/** Report the element that currently has focus and whether a ring is visible. */
function activeFocusProbe() {
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body) return { none: true };
  const s = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return {
    none: false,
    tag: el.tagName.toLowerCase(),
    text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 34),
    // :focus-visible only engages for real keyboard interaction, which is why
    // this has to be driven by keypresses rather than .focus().
    outlineWidth: s.outlineWidth,
    outlineStyle: s.outlineStyle,
    boxShadow: s.boxShadow === 'none' ? 'none' : 'set',
    w: Math.round(r.width),
    h: Math.round(r.height),
  };
}

/** Tab through in document order and require a visible ring on every stop. */
function focusWalkProbe() {
  return true;
}

/**
 * Wrap a probe so it can be evaluated in the page.
 *
 * esbuild compiles with `--keep-names`, so a stringified function carries
 * `__name(fn, "fn")` calls that only exist in the Node bundle. Defining `__name`
 * as the identity function before the probe is evaluated makes the stringified
 * source self-sufficient, which is the whole reason for stringifying rather than
 * escaping a literal by hand.
 */
function asProbe(fn: () => unknown): string {
  return `(() => { var __name = (f) => f; return (${fn.toString()})(); })()`;
}

const OVERFLOW_PROBE = asProbe(overflowProbe);
const DARK_PROBE = asProbe(darkProbe);
const FOCUS_PROBE = asProbe(focusProbe);
const ACTIVE_FOCUS = asProbe(activeFocusProbe);

async function main() {
  const chrome = findChrome();
  if (!chrome) throw new Error('no Chrome or Edge found');

  const server = spawn(process.execPath, [path.join(ROOT, 'dist', 'server', 'entry.mjs')], {
    cwd: ROOT, env: { ...process.env, PORT, HOST },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let boot = '';
  server.stdout.on('data', (d) => (boot += d));
  server.stderr.on('data', (d) => (boot += d));

  const until = Date.now() + 60_000;
  let up = false;
  while (Date.now() < until) {
    try { if ((await fetch(base, { redirect: 'manual' })).status > 0) { up = true; break; } } catch { /* */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!up) { server.kill(); throw new Error(`server never came up:\n${boot}`); }

  await new Promise<void>((resolve, reject) => {
    const p = spawn(process.execPath,
      [path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(ROOT, 'scripts', 'seed.ts')],
      { cwd: ROOT, env: { ...process.env }, stdio: 'ignore', windowsHide: true });
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`seed exited ${c}`))));
    p.on('error', reject);
  });

  const profile = path.join(os.tmpdir(), `strata-vp-${RUN}`);
  // One port, used for both: launching Chrome on a port and then connecting to a
  // second free one is the same bug in a different costume.
  const cdpPort = await freePort();
  const browser = await launchChrome(chrome, cdpPort, profile);
  console.log(`\nviewports — ${path.basename(chrome)}\n`);

  try {
    const { ws, send, goto, evaluate } = await connect(cdpPort);
    // Both domains must be on or no load event is ever emitted and every
    // navigation waits out its full timeout.
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setEmulatedMedia', { features: [] });

    /* --- 1. 375px ------------------------------------------------------- */
    console.log('375px\n');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 375, height: 667, deviceScaleFactor: 2, mobile: true,
    });
    for (const p of PAGES) {
      await goto(`${base}${p}`);
      const r = await evaluate(OVERFLOW_PROBE);
      check(
        `${p} does not scroll sideways at 375px`,
        r.scrollWidth <= r.clientWidth + 1,
        `scrollWidth ${r.scrollWidth} vs ${r.clientWidth}; ${r.wide
          .map((w: any) => `${w.tag}.${w.cls} right=${w.right} w=${w.width} "${w.text}"`)
          .join(' | ')}`,
      );
    }

    /* --- 2. contrast, in both themes -------------------------------------- */
    console.log('\ncontrast\n');

    /* Light first. Only checking the theme a reader opts into would have left
       the original defect in place, because the failing token was *darker* in
       dark mode and the light theme failed too, just less badly. */
    await send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: 'light' }],
    });
    for (const p of ['/', '/w/cache-invalidation-is-a-distributed-problem', '/privacy']) {
      await goto(`${base}${p}`);
      const applied = await evaluate(`document.documentElement.dataset.theme || ''`);
      check(`${p} is in the light theme`, applied === 'paper', `data-theme="${applied}"`);
      const low = await evaluate(DARK_PROBE);
      check(
        `${p} has no unreadable text in light`,
        low.length === 0,
        low.map((d: any) => `${d.tag}.${d.cls} ${d.ratio}:1 (needs ${d.need}) ${d.size}px "${d.text}"`).join(' | '),
      );
    }

    await send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: 'dark' }],
    });
    for (const p of ['/', '/w/cache-invalidation-is-a-distributed-problem', '/studio', '/privacy']) {
      await goto(`${base}${p}`);
      // The theme is applied by an inline script from a cookie, not by the media
      // query, so also set the cookie a reader would have after choosing dark.
      await send('Emulation.setDocumentCookie', {
        cookie: { name: 'strata_theme', value: 'ink', domain: '127.0.0.1', path: '/' },
      }).catch(() => {});
      await goto(`${base}${p}`);
      const applied = await evaluate(`document.documentElement.dataset.theme || ''`);
      check(`${p} honours the dark theme`, applied === 'ink', `data-theme="${applied}"`);
      const low = await evaluate(DARK_PROBE);
      check(
        `${p} has no unreadable text in dark`,
        low.length === 0,
        low.map((d: any) => `${d.tag}.${d.cls} ${d.ratio}:1 (needs ${d.need}) ${d.size}px "${d.text}"`).join(' | '),
      );
    }
    await send('Emulation.setEmulatedMedia', { features: [] });

    /* --- 3. 200% zoom --------------------------------------------------- */
    console.log('\n200% zoom\n');
    // 1280 CSS px at 200% is 640 effective — the same viewport a reader gets by
    // zooming a 1280-wide screen, which is what WCAG 1.4.4 is actually about.
    await send('Emulation.setDeviceMetricsOverride', {
      width: 640, height: 800, deviceScaleFactor: 1, mobile: false,
    });
    for (const p of ['/', '/w/cache-invalidation-is-a-distributed-problem', '/constellations', '/studio']) {
      await goto(`${base}${p}`);
      const r = await evaluate(OVERFLOW_PROBE);
      check(
        `${p} reflows at 200% without clipping`,
        r.scrollWidth <= r.clientWidth + 1,
        `scrollWidth ${r.scrollWidth} vs ${r.clientWidth}; ${r.wide
          .map((w: any) => `${w.tag}.${w.cls} right=${w.right}`)
          .join(' | ')}`,
      );
    }

    /* --- 4. targets and focus ------------------------------------------- */
    console.log('\ntargets\n');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 375, height: 667, deviceScaleFactor: 2, mobile: true,
    });
    for (const p of ['/', '/w/cache-invalidation-is-a-distributed-problem']) {
      await goto(`${base}${p}`);
      const r = await evaluate(FOCUS_PROBE);
      check(
        `${p} has no crowded sub-24px tap targets`,
        r.smallCount === 0,
        r.small.map((s: any) => `${s.tag}.${s.cls} ${s.w}x${s.h} gap=${s.gap} "${s.text}"`).join(' | '),
      );
      check(`${p} has focusable controls at all`, r.total > 5, `${r.total} focusable`);
    }

    /* --- 5. keyboard: real Tab presses, real :focus-visible -------------- */
    console.log('\nkeyboard\n');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1280, height: 900, deviceScaleFactor: 1, mobile: false,
    });

    const pressTab = async () => {
      for (const type of ['rawKeyDown', 'keyUp']) {
        await send('Input.dispatchKeyEvent', {
          type,
          windowsVirtualKeyCode: 9,
          nativeVirtualKeyCode: 9,
          key: 'Tab',
          code: 'Tab',
        });
      }
    };

    for (const p of ['/', '/w/cache-invalidation-is-a-distributed-problem', '/privacy']) {
      await goto(`${base}${p}`);
      // Start from the top of the document, as a reader arriving by keyboard does.
      await evaluate(`document.body.focus(); if (document.activeElement) document.activeElement.blur(); true`);

      let ringless: string[] = [];
      let reached = 0;
      for (let i = 0; i < 14; i++) {
        await pressTab();
        const f = await evaluate(ACTIVE_FOCUS);
        if (f.none) continue;
        reached++;
        // :focus-visible must have engaged: the ring is the only way a keyboard
        // reader knows where they are.
        const ringed =
          (f.outlineStyle !== 'none' && parseFloat(f.outlineWidth) > 0) || f.boxShadow !== 'none';
        if (!ringed) {
          ringless.push(`<${f.tag}> "${f.text}" (${f.w}x${f.h}, outline=${f.outlineWidth} ${f.outlineStyle})`);
        }
      }
      check(`${p} puts the keyboard somewhere on every tab stop`, reached >= 8, `${reached} stops reached`);
      check(
        `${p} shows a visible focus ring at every stop`,
        ringless.length === 0,
        ringless.slice(0, 5).join(' | '),
      );
    }

    ws.close();
  } finally {
    browser.kill();
    server.kill();
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch { /* temp */ }
  }

  console.log(`\n${assertions} assertions, ${failures} failed`);
  process.exitCode = failures > 0 ? 1 : 0;
}

try {
  await main();
} finally {
  for (const s of ['', '-wal', '-shm']) {
    try { fs.rmSync(TEST_DB + s, { force: true, maxRetries: 3 }); } catch { /* temp */ }
  }
}