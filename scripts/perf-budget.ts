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

/* Deliberately far below the plan's <100KB target: the reading path ships no
   external JS, so any real budget here is a regression guard. A framework
   reintroduced by accident lands well over the largest cap and fails the build. */
const BUDGET = {
  totalJsKb: 40,
  largestJsKb: 40,
  totalCssKb: 48,
} as const;

const KB = 1024;

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

const totalJs = js.reduce((n, a) => n + a.bytes, 0);
const largest = js.length ? js.reduce((a, b) => (a.bytes > b.bytes ? a : b)) : null;
const totalCss = css.reduce((n, a) => n + a.bytes, 0);

const rows = [
  row('client JS, total', totalJs, BUDGET.totalJsKb),
  ...(largest ? [row(`client JS, largest (${largest.name})`, largest.bytes, BUDGET.largestJsKb)] : []),
  row('CSS, total', totalCss, BUDGET.totalCssKb),
];

console.log('\nperformance budget\n');
for (const r of rows) {
  console.log(`  ${r.mark}  ${r.label.padEnd(42)} ${r.value.padStart(10)}  / ${r.cap}`);
}
if (js.length === 0) {
  console.log('\n  No external client JS — the reading path is HTML + inlined scripts only.');
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
