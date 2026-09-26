#!/usr/bin/env node
/**
 * Design lint.
 *
 * The visual constraints in PLAN.md §1.2 are only real if they are enforced by a machine.
 * This fails the build on the patterns that produce the generic, glossy look this project
 * is explicitly rejecting — gradients, glass, glow, oversized radii, AI-purple.
 *
 * A rule may be waived for a specific line with a trailing `design-allow: <reason>`.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

const ROOT = process.cwd();
const SCAN_DIRS = ['src'];
const EXTENSIONS = new Set(['.astro', '.css', '.tsx', '.ts', '.jsx', '.js', '.mjs']);

const BANNED = [
  { name: 'gradient', re: /\b(?:repeating-)?(?:linear|radial|conic)-gradient\s*\(/g },
  { name: 'backdrop-filter', re: /backdrop-(?:filter|blur)/g },
  { name: 'text-shadow', re: /text-shadow/g },
  { name: 'blur filter', re: /filter:[^;]*\bblur\(/g },
  { name: 'large shadow', re: /box-shadow:[^;]*(\d+)px/g, check: (m, v) => Number(v) > 8, label: 'box-shadow blur > 8px' },
  { name: 'large radius', re: /border-radius:[^;]*(\d+)px/g, check: (m, v) => Number(v) >= 12, label: 'border-radius >= 12px' },
  { name: 'pill radius', re: /border-radius:\s*9999?px/g, label: 'pill radius' },
  { name: 'transition: all', re: /transition:\s*all\b/g },
  { name: 'transition-all', re: /\btransition-all\b/g },
  { name: 'tailwind rounded-2xl+', re: /\brounded-(?:2xl|3xl|full)\b/g },
  { name: 'tailwind heavy shadow', re: /\b(?:drop-)?shadow-(?:lg|xl|2xl|inner)\b/g },
  { name: 'tailwind blur', re: /\bblur-(?:sm|md|lg|xl|2xl|3xl)\b/g },
  { name: 'tailwind gradient', re: /\bbg-gradient-/, label: 'bg-gradient-*' },
  { name: 'tailwind gradient text', re: /\b(?:bg|from|via|to)-linear-/, label: 'gradient text' },
  { name: 'AI purple', re: /#(?:6366f1|8b5cf6|a855f7|7c3aed|818cf8|c084fc|4f46e5)\b/gi, label: 'AI-purple hue' },
  { name: 'spring easing', re: /cubic-bezier\([^)]*0\.[0-9]{2,}\s*,\s*1\.[0-9]/g, label: 'spring/bouncy easing' },
];

/** Awaits a specific token on a line, in any casing. */
const REQUIRED = [
  { name: 'focus-visible', re: /:focus-visible/ },
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) yield* walk(full);
    else if (EXTENSIONS.has(extname(full))) yield full;
  }
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

const violations = [];

for (const dir of SCAN_DIRS) {
  let files;
  try {
    files = [...walk(join(ROOT, dir))];
  } catch {
    continue;
  }

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    const rel = relative(ROOT, file).replace(/\\/g, '/');

    lines.forEach((rawLine, i) => {
      if (rawLine.includes('design-allow')) return;
      // Skip the rule definitions themselves and this file.
      if (rel === 'scripts/lint-design.mjs') return;

      for (const rule of BANNED) {
        rule.re.lastIndex = 0;
        let m;
        while ((m = rule.re.exec(rawLine)) !== null) {
          if (rule.check && !rule.check(m[0], m[1])) continue;
          violations.push({
            file: rel,
            line: i + 1,
            rule: rule.label ?? rule.name,
            snippet: rawLine.trim().slice(0, 90),
          });
        }
      }
    });
  }
}

// Structural checks: a component that *fetches* must handle all three states.
// Components that take their data entirely through props have no loading phase
// and demanding one would push authors to write dead markup.
const REQUIRED_STATES = ['empty', 'loading', 'error'];
const FETCHES = /\bfetch\s*\(|XMLHttpRequest|\bawait\s+[a-z]/i;

const islands = [];
for (const file of walk(join(ROOT, 'src'))) {
  if (extname(file) === '.tsx' && !file.includes('lint-design')) islands.push(file);
}
for (const file of islands) {
  const text = readFileSync(file, 'utf8');
  if (!FETCHES.test(text)) continue;
  if (text.includes('design-allow')) continue;
  const missing = REQUIRED_STATES.filter((s) => !new RegExp(`\\b${s}\\b`, 'i').test(text));
  if (missing.length) {
    violations.push({
      file: relative(ROOT, file).replace(/\\/g, '/'),
      line: 1,
      rule: `data-fetching component missing states: ${missing.join(', ')}`,
      snippet: 'a component that fetches must handle empty, loading and error',
    });
  }
}

if (violations.length === 0) {
  console.log('design lint: clean ✓');
  process.exit(0);
}

console.error(`\ndesign lint: ${violations.length} violation(s)\n`);
const byRule = new Map();
for (const v of violations) {
  if (!byRule.has(v.rule)) byRule.set(v.rule, []);
  byRule.get(v.rule).push(v);
}
for (const [rule, items] of byRule) {
  console.error(`  ${rule}  ×${items.length}`);
  for (const v of items.slice(0, 6)) console.error(`    ${v.file}:${v.line}  ${v.snippet}`);
  if (items.length > 6) console.error(`    …and ${items.length - 6} more`);
}
console.error('\nThese are the patterns this project rejects. Waive a specific line with');
console.error('a trailing `design-allow: <reason>` comment if there is a real justification.\n');
process.exit(1);
