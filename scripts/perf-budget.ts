/**
 * Performance budget, enforced.
 *
 * This is a text publication. The whole argument is that reading a long post
 * should feel like reading, not like loading an application, so the bundle is
 * a product constraint and not an implementation detail. A budget nobody
 * enforces is a comment, so this fails the build instead.
 *
 *   npm run build && npm run perf:budget
 *
 * It reads the build output rather than driving a browser, so it is
 * deterministic and needs no server. Numbers are raw bytes, before gzip: the
 * point is to catch a dependency that lands, not to model a CDN.
 *
 * Since the last island was removed, there is *no external client JS at all* —
 * the reading path's interactivity is inlined into the HTML. The budget is now
 * a tripwire for that staying true: reintroducing a framework, or even a heavy
 * library, puts a multi-hundred-kilobyte chunk here and fails immediately.
 */

import fs from 'node:fs';
import path from 'node:path';

const DIST = path.resolve(process.cwd(), 'dist/client');
const SERVER = path.resolve(process.cwd(), 'dist/server');

/* Deliberately far below the plan's <100KB target: the reading path ships no
   external JS, so any real budget here is a regression guard. A framework
   reintroduced by accident lands well over the largest cap and fails the build. */
const BUDGET = {
  totalJsKb: 40,
  largestJsKb: 40,
  totalCssKb: 48,
} as const;

const KB = 1024;

/**
 * The size of the stylesheet Astro inlined into the server bundle.
 *
 * astro.config.mjs sets `inlineStylesheets: 'always'`, because a render-blocking
 * `<link>` costs a whole extra round-trip and that was most of the LCP. Counting
 * only dist/client would then report 0KB of CSS and quietly stop enforcing
 * anything, so the stylesheet is measured where it now lives: as a string inside
 * the SSR chunk.
 *
 * The string is located by Tailwind's own licence banner, which is what the
 * built stylesheet starts with, and ends at the first *unescaped* quote — the CSS
 * is full of `\"` inside quoted font names and content values, so a naive scan for
 * the closing quote stops about a kilobyte in.
 */
function inlineStylesheet() {
  if (!fs.existsSync(SERVER)) return { name: '(no server build)', bytes: 0 };
  let best = { name: '(none)', bytes: 0 };
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(mjs|js)$/.test(entry.name)) continue;
      const text = fs.readFileSync(full, 'utf8');
      const start = text.indexOf('/*! tailwindcss');
      if (start === -1) continue;
      let i = start;
      while (i < text.length) {
        const ch = text[i];
        if (ch === '\\') {
          i += 2;
          continue;
        }
        if (ch === '"') break;
        i++;
      }
      const bytes = i - start;
      if (bytes > best.bytes) best = { name: path.relative(SERVER, full), bytes };
    }
  };
  walk(SERVER);
  return best;
}

function assets(ext: string) {
  if (!fs.existsSync(DIST)) return [];
  const out: Array<{ name: string; bytes: number }> = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(ext)) out.push({ name: entry.name, bytes: fs.statSync(full).size });
    }
  };
  walk(DIST);
  return out;
}

function kb(bytes: number) {
  return bytes / KB;
}

function row(label: string, bytes: number, limitKb: number) {
  const limit = limitKb * KB;
  const ok = bytes <= limit;
  const mark = ok ? 'ok  ' : 'OVER';
  return { mark, label, value: `${kb(bytes).toFixed(1)} KB`, cap: `${limitKb} KB`, ok };
}

if (!fs.existsSync(DIST)) {
  console.error('No build output in dist/client — run `npm run build` first.');
  process.exit(1);
}

const js = assets('.js');
const css = assets('.css');
const inlineCss = inlineStylesheet();

const totalJs = js.reduce((n, a) => n + a.bytes, 0);
const largest = js.length ? js.reduce((a, b) => (a.bytes > b.bytes ? a : b)) : null;
// The inlined stylesheet is a per-request cost — every page pays all of it — so
// it is added to the external CSS rather than counted separately.
const totalCss = css.reduce((n, a) => n + a.bytes, 0) + inlineCss.bytes;

const rows = [
  row('client JS, total', totalJs, BUDGET.totalJsKb),
  ...(largest ? [row(`client JS, largest (${largest.name})`, largest.bytes, BUDGET.largestJsKb)] : []),
  row('CSS, every page ships', totalCss, BUDGET.totalCssKb),
];

console.log('\nperformance budget\n');
for (const r of rows) {
  console.log(`  ${r.mark}  ${r.label.padEnd(42)} ${r.value.padStart(10)}  / ${r.cap}`);
}
if (js.length === 0) {
  console.log('\n  No external client JS — the reading path is HTML + inlined scripts only.');
}
if (inlineCss.bytes > 0) {
  console.log(
    `\n  CSS is inlined in ${path.basename(inlineCss.name)}: no stylesheet request blocks first paint.`,
  );
}

const failed = rows.filter((r) => !r.ok);

if (failed.length > 0) {
  console.log('');
  for (const r of failed) console.error(`  over budget: ${r.label} is ${r.value}, limit ${r.cap}`);
  console.error(
    '\nA long-form reader should not pay for a framework to read a paragraph.\n' +
      'Before raising a limit, check whether the weight belongs on the reading\n' +
      'path at all, or whether it can be plain DOM instead.\n',
  );
  process.exit(1);
}

console.log('\nwithin budget ✓\n');
