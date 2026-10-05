/**
 * What happens when this is deployed wrong.
 *
 * Everything else in this suite starts the server with a working database and
 * checks what it serves. That leaves the two failure modes that never show up in
 * development untested, and they are the ones that decide whether an onboarding
 * reader meets a publication or an empty web page:
 *
 *   1. `DATABASE_URL` unset. The fallback is a local file, which is right on a
 *      laptop and catastrophic on a serverless deploy — ephemeral, so the site
 *      comes up, answers 200, and serves nothing. No error, no log.
 *   2. A migration fails. It used to be caught and logged, so the app carried on
 *      against a schema that did not match the code, turning one clear failure at
 *      boot into unrelated "no such column" errors across whichever requests
 *      touched the affected tables.
 *
 * Both are deployment mistakes rather than runtime conditions, so the right
 * behaviour is to refuse to start and say which variable to set. That is a
 * behaviour change with a real cost — a bad deploy now takes the site down
 * rather than limping — so it is asserted rather than assumed, in both
 * environments: production must refuse, development must still be forgiving.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const PORT = process.env.BOOT_PORT ?? '4675';
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

/** Boot the built server and report what it did within `timeoutMs`. */
function boot(
  env: Record<string, string | undefined>,
  timeoutMs = 25_000,
): Promise<{
  exited: boolean;
  code: number | null;
  output: string;
  answered: boolean;
  status: number;
  body: string;
}> {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [path.join(ROOT, 'dist', 'server', 'entry.mjs')], {
      cwd: ROOT,
      env: { PATH: process.env.PATH ?? '', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (out += d));

    let answered = false;
    let status = 0;
    let body = '';
    const deadline = Date.now() + timeoutMs;
    const poll = setInterval(() => {
      fetch(base, { redirect: 'manual' })
        .then(async (r) => {
          answered = true;
          status = r.status;
          body = (await r.text()).slice(0, 600);
        })
        .catch(() => {
          /* not up yet */
        });
      if (Date.now() > deadline) finish();
    }, 500);

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(poll);
      proc.kill();
      resolve({ exited: proc.exitCode !== null, code: proc.exitCode, output: out, answered, status, body });
    };
    proc.on('exit', () => finish());
    proc.on('error', () => finish());
  });
}

console.log('\ndeployment failure modes\n');

/* --- 1. production without a database URL must fail loudly ------------- */
{
  const r = await boot({ PORT, HOST, NODE_ENV: 'production', VERCEL: '1' });

  /* The guard lives at module scope, and Astro imports route modules lazily — so
     the process binds its port first and throws on the first request rather than
     exiting at boot. That is still the behaviour we want, and it is worth being
     precise about what it is: the site does not serve, and the response says why.
     What must never happen is the old outcome — a 200, and an empty publication. */
  check(
    'production with no DATABASE_URL never returns a successful response',
    !r.answered || r.status >= 500,
    r.answered ? `answered ${r.status}: ${r.body.slice(0, 120)}` : 'did not answer at all',
  );
  check(
    'and it says which variable is missing',
    /DATABASE_URL/.test(r.output) || /DATABASE_URL/.test(r.body),
    `output: ${r.output.slice(0, 260)}`,
  );
  check(
    'and says what would have gone wrong',
    /empty publication|ephemeral|refusing to start/i.test(r.output + r.body),
    `output: ${r.output.slice(0, 260)}`,
  );
  check(
    'and the failure is visible in the log, not only in the response',
    r.output.trim().length > 0,
    'nothing was written to stdout or stderr',
  );
}

/* --- 2. production with a bad URL also refuses, rather than 500ing later -- */
{
  const r = await boot({
    PORT,
    HOST,
    NODE_ENV: 'production',
    DATABASE_URL: 'libsql://not-a-real-host.invalid',
    DATABASE_AUTH_TOKEN: 'irrelevant',
  });
  check(
    'production with an unreachable database does not report success',
    !r.answered || /error|fail|refus/i.test(r.output),
    'it served a request against a database it cannot reach',
  );
}

/* --- 3. development is still forgiving --------------------------------- */
{
  const dbFile = path.join(os.tmpdir(), `strata-boot-${RUN}.db`);
  const dev = boot({ PORT, HOST, NODE_ENV: 'development', DATABASE_URL: `file:${dbFile}` });
  const up = await dev;
  check('development with a local file still starts', up.answered, `output: ${up.output.slice(0, 200)}`);
  check(
    'and says nothing about refusing to start',
    !/refusing to start/i.test(up.output),
    up.output.slice(0, 200),
  );
  for (const s of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(dbFile + s, { force: true, maxRetries: 3 });
    } catch {
      /* temp */
    }
  }
}

/* --- 4. development with no DATABASE_URL at all still gets the fallback -- */
{
  const r = await boot({ PORT, HOST, NODE_ENV: 'development' });
  check(
    'development with no DATABASE_URL falls back to a local file',
    r.answered,
    `output: ${r.output.slice(0, 200)}`,
  );
}

console.log(`\n${assertions} assertions, ${failures} failed`);
if (failures > 0) {
  console.error(
    '\nThese are the failures that never appear locally and decide whether an\n' +
      'onboarding reader meets a publication or an empty page.\n',
  );
}
process.exitCode = failures > 0 ? 1 : 0;