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
 */

import fs from 'node:fs';
import path from 'node:path';

const DIST = path.resolve(process.cwd(), 'dist/client/_astro');

/* Set just above today's build so ordinary work passes and a real regression
   does not. Current: 237.3 KB total JS, 207.9 KB largest, 35.5 KB CSS. */
const BUDGET = {
  totalJsKb: 280,
  largestJsKb: 240,
  totalCssKb: 48,
} as const;

const KB = 1024;

function assets(ext: string) {
  if (!fs.existsSync(DIST)) return [];
  return fs
    .readdirSync(DIST)
    .filter((f) => f.endsWith(ext))
    .map((f) => ({ name: f, bytes: fs.statSync(path.join(DIST, f)).size }));
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

const js = assets('.js');
const css = assets('.css');

if (js.length === 0) {
  console.error('No client JS found in dist/client/_astro — run `npm run build` first.');
  process.exit(1);
}

const totalJs = js.reduce((n, a) => n + a.bytes, 0);
const largest = js.reduce((a, b) => (a.bytes > b.bytes ? a : b));
const totalCss = css.reduce((n, a) => n + a.bytes, 0);

const rows = [
  row('client JS, total', totalJs, BUDGET.totalJsKb),
  row(`client JS, largest (${largest.name})`, largest.bytes, BUDGET.largestJsKb),
  row('CSS, total', totalCss, BUDGET.totalCssKb),
];
console.log('\nperformance budget\n');
for (const r of rows) {
  console.log(`  ${r.mark}  ${r.label.padEnd(42)} ${r.value.padStart(10)}  / ${r.cap}`);
}

const failed = rows.filter((r) => !r.ok);

if (failed.length > 0) {
  console.log('');
  for (const r of failed) console.error(`  over budget: ${r.label} is ${r.value}, limit ${r.cap}`);
  console.error(
    '\nA long-form reader should not pay for a framework to read a paragraph.\n' +
      'Before raising a limit, check whether the weight belongs on the reading\n' +
      'path at all, or whether an island can be plain DOM instead.\n',
  );
  process.exit(1);
}

console.log('\nwithin budget ✓\n');
