/**
 * Route smoke test against the real built server.
 *
 * A build that compiles and a site that serves are different claims. This boots
 * `dist/server/entry.mjs` — the artifact that would actually be deployed, not the
 * dev server — waits for it, and checks that the routes the publication links to
 * between actually answer, and that the ones it says are missing stay missing.
 *
 *   node scripts/smoke.mjs
 *   BASE_URL=http://localhost:4321 node scripts/smoke.mjs   # test a running server
 */

import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const PORT = process.env.SMOKE_PORT ?? '4399';
const EXTERNAL = process.env.BASE_URL ?? null;
const BOOT_TIMEOUT_MS = 30_000;

const OK = [
  '/',
  '/writing',
  '/topics',
  '/lists',
  '/lists/start-here',
  '/about',
  '/privacy',
  '/write',
  '/constellations',
  '/search',
  '/search?q=caching',
  '/rss.xml',
  '/robots.txt',
  '/w/cache-invalidation-is-a-distributed-problem',
  '/w/the-p99-is-a-lie-you-tell-yourself',
  '/w/we-deleted-our-staging-environment',
  '/w/field-guide-to-evaluating-retrieval',
  '/w/why-your-embeddings-are-worse-than-you-think',
  '/w/cache-invalidation-is-a-distributed-problem?rev=2',
  '/a/vedant',
  '/a/mira',
  '/a/sam',
  '/claim/badtoken',
];

/* The 404 page is load-bearing — it is what a renamed post or a burned claim
   link lands on — so a route quietly becoming a 200 would be a regression. */
const NOT_FOUND = ['/nope', '/a/nosuchhandle', '/w/no-such-post', '/lists/nope'];

let base = EXTERNAL;
let child = null;

function waitForServer(url) {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      try {
        const res = await fetch(url, { redirect: 'manual' });
        if (res.status < 500) return resolve();
        throw new Error(`status ${res.status}`);
      } catch (err) {
        if (Date.now() > deadline) {
          return reject(new Error(`server not ready after ${BOOT_TIMEOUT_MS}ms: ${err.message}`));
        }
        setTimeout(attempt, 250);
      }
    };
    attempt();
  });
}

async function status(pathname) {
  const res = await fetch(new URL(pathname, base), { redirect: 'manual' });
  return res.status;
}

async function main() {
  if (!base) {
    const entry = path.join(ROOT, 'dist', 'server', 'entry.mjs');
    child = spawn(process.execPath, [entry], {
      cwd: ROOT,
      env: { ...process.env, PORT, HOST: '127.0.0.1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let bootLog = '';
    child.stdout.on('data', (d) => (bootLog += d));
    child.stderr.on('data', (d) => (bootLog += d));
    child.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error('server exited during boot:\n' + bootLog);
        process.exit(1);
      }
    });
    base = `http://127.0.0.1:${PORT}`;
  }

  await waitForServer(base);
  console.log(`smoke: ${base}\n`);

  let failures = 0;

  for (const route of OK) {
    const code = await status(route);
    if (code === 200) {
      console.log(`  ok    200  ${route}`);
    } else {
      failures++;
      console.error(`  FAIL  ${code}  ${route} (expected 200)`);
    }
  }

  for (const route of NOT_FOUND) {
    const code = await status(route);
    if (code === 404) {
      console.log(`  ok    404  ${route}`);
    } else {
      failures++;
      console.error(`  FAIL  ${code}  ${route} (expected 404)`);
    }
  }

  console.log(`\n${OK.length + NOT_FOUND.length} routes, ${failures} failed`);
  process.exitCode = failures > 0 ? 1 : 0;
}

try {
  await main();
} catch (err) {
  console.error(`\nsmoke: ${err.message}`);
  process.exitCode = 1;
} finally {
  if (child) child.kill();
}
