/**
 * Does the app ever show a reader the machinery?
 *
 * A rejected form is the one moment a product talks *about* itself instead of to
 * the person in front of it, which makes it where internal wording leaks. Five
 * endpoints were putting Zod's own complaint into a `?noteError=` or
 * `?studioError=` and rendering it on the page: "Invalid input: expected string,
 * received undefined", "Too big: expected string to have <=4000 characters".
 *
 * That is bad twice over. It tells a reader nothing they can act on, and it
 * describes the shape of the schema to anyone who posts one bad field.
 *
 * So this asserts the *user-visible* surface: post a malformed form to every
 * endpoint that redirects with an error, follow the redirect, and require that
 * what the page says contains no validator vocabulary. A control case proves the
 * detector works, because "no bad words" is otherwise also what a blank page says.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const PORT = process.env.READER_PORT ?? '4680';
const HOST = '127.0.0.1';
const base = `http://${HOST}:${PORT}`;
const RUN = Date.now().toString(36).slice(-5);
const TEST_DB = path.join(os.tmpdir(), `strata-reader-${RUN}.db`);
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

const server = spawn(process.execPath, [path.join(ROOT, 'dist', 'server', 'entry.mjs')], {
  cwd: ROOT, env: { ...process.env, PORT, HOST },
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
let boot = '';
server.stdout.on('data', (d) => (boot += d));
server.stderr.on('data', (d) => (boot += d));

async function waitForServer() {
  const until = Date.now() + 60_000;
  while (Date.now() < until) {
    try { if ((await fetch(base, { redirect: 'manual' })).status > 0) return true; } catch { /* */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}
async function seed() {
  await new Promise<void>((resolve, reject) => {
    const p = spawn(process.execPath,
      [path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(ROOT, 'scripts', 'seed.ts')],
      { cwd: ROOT, env: { ...process.env }, stdio: 'ignore', windowsHide: true });
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`seed exited ${c}`))));
    p.on('error', reject);
  });
}

/**
 * Vocabulary only a validator would use.
 *
 * Deliberately specific: "expected" and "invalid" appear in perfectly good prose,
 * so they are only counted as a finding next to the other tells.
 */
const MACHINE_WORDS =
  /expected (string|number|boolean|array|object)|received (undefined|null|never|NaN)|invalid_(input|type|enum|literal|union)|too_(big|small):|ZodError|schema|safeParse|parse failed|instance of/i;

const anon = `reader-${RUN}`;
const cookie = `strata_anon=${anon}`;
const SLUG = 'cache-invalidation-is-a-distributed-problem';

function text(s: string): string {
  return s
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)
    .join(' ');
}

async function postForm(p: string, fields: Record<string, string>) {
  const res = await fetch(new URL(p, base), {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie,
      origin: base,
      referer: `${base}${p}`,
    },
    body: new URLSearchParams(fields).toString(),
  });
  return { status: res.status, location: res.headers.get('location') ?? '', body: await res.text() };
}

async function main() {
  if (!(await waitForServer())) {
    console.error(`server never came up:\n${boot}`);
    process.exit(1);
  }
  await seed();

  console.log('\nwhat the reader is shown\n');

  /* The humaniser itself, and the control. */
  const { humanIssue, humanIssues } = await import('../src/lib/validation.ts');
  check(
    'an over-long value quotes the limit back',
    /4,000/.test(humanIssue({ code: 'too_big', maximum: 4000 })),
    humanIssue({ code: 'too_big', maximum: 4000 }),
  );
  check(
    'a missing field reads as a missing field',
    /missing/i.test(humanIssue({ code: 'invalid_type' })),
    humanIssue({ code: 'invalid_type' }),
  );
  check(
    'an unknown issue code does not fall through to the validator text',
    !MACHINE_WORDS.test(humanIssue({ code: 'something_new_in_zod_v5', message: 'expected string' })),
    humanIssue({ code: 'something_new_in_zod_v5', message: 'expected string' }),
  );
  check(
    'an email field says so',
    /email address/i.test(humanIssue({ code: 'invalid_format', path: ['email'] })),
    humanIssue({ code: 'invalid_format', path: ['email'] }),
  );

  /* --- every endpoint that redirects with an error ---------------------- */
  const art = await (await fetch(`${base}/w/${SLUG}`, { headers: { cookie } })).text();
  const parentId = /name="parentId" value="([^"]+)"/.exec(art)?.[1] ?? '';

  const cases: Array<[string, string, Record<string, string>]> = [
    ['/api/notes reply with no body field', '/api/notes', { action: 'reply', parentId, returnTo: `/w/${SLUG}` }],
    ['/api/notes reply over the limit', '/api/notes', { action: 'reply', parentId, returnTo: `/w/${SLUG}`, body: 'x'.repeat(4500) }],
    ['/api/notes with no action', '/api/notes', { returnTo: `/w/${SLUG}` }],
    ['/api/notes with a nonsense action', '/api/notes', { action: 'obliterate', returnTo: `/w/${SLUG}` }],
    ['/api/studio with no action', '/api/studio', { returnTo: '/studio' }],
    ['/api/lists with no action', '/api/lists', { returnTo: '/lists' }],
    ['/api/keys with no action', '/api/keys', { returnTo: '/settings' }],
    ['/api/settings with a bad density', '/api/settings', { density: 'enormous', returnTo: '/settings' }],
    ['/api/memory with no action', '/api/memory', { returnTo: '/reader' }],
  ];

  for (const [label, endpoint, fields] of cases) {
    const res = await postForm(endpoint, fields);
    check(`${label} is refused, not accepted`, res.status === 303, `${res.status}`);
    const err = /[?&](noteError|studioError|error)=([^&]*)/.exec(res.location)?.[2] ?? '';
    check(
      `${label} does not put validator wording in the redirect`,
      !MACHINE_WORDS.test(decodeURIComponent(err)),
      `redirect said: ${decodeURIComponent(err).slice(0, 140)}`,
    );

    /* And what the page then renders, which is the part a reader actually reads. */
    if (res.location) {
      const page = await (
        await fetch(new URL(res.location, base), { headers: { cookie } })
      ).text();
      check(
        `${label} shows nothing machine-made on the page`,
        !MACHINE_WORDS.test(text(page)),
        `page text near: ${(MACHINE_WORDS.exec(text(page)) ?? ['', ''])[0]}`,
      );
    }
  }

  /* --- the JSON endpoints, which answer writers rather than readers ------ */
  {
    /* Import is writer-scoped, so this needs a handle. Asserting on the 401 would
       pass without ever reaching the error message being examined. */
    const { requestHandleClaim, redeemHandleClaim, SESSION_COOKIE } = await import(
      '../src/lib/repo/auth.ts'
    );
    const handle = `reader${RUN}`;
    const requested = await requestHandleClaim({
      handle,
      email: `${handle}@example.com`,
      anonId: anon,
    });
    if (!requested.ok) {
      check('a handle could be claimed for the import check', false, requested.error);
    } else {
      const jar = new Map<string, { value: string }>();
      const cookies = {
        get: (k: string) => jar.get(k),
        set: (k: string, v: string) => void jar.set(k, { value: v }),
        delete: (k: string) => void jar.delete(k),
        has: (k: string) => void jar.has(k),
      };
      const redeemed = await redeemHandleClaim(requested.token, cookies as never);
      check('a handle could be claimed for the import check', redeemed.ok, redeemed.ok ? '' : redeemed.error);
      const writerCookie = `${cookie}; ${SESSION_COOKIE}=${jar.get(SESSION_COOKIE)!.value}`;

      const res = await fetch(new URL('/api/import', base), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: writerCookie,
          origin: base,
          referer: `${base}/write`,
        },
        body: JSON.stringify({ files: 'not an array' }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      check('/api/import refuses a malformed body from a writer', res.status === 400, `${res.status}`);
      check(
        '/api/import does not answer with validator wording',
        !MACHINE_WORDS.test(j.error ?? ''),
        `error said: ${(j.error ?? '').slice(0, 140)}`,
      );
      check('/api/import says something a writer can act on', (j.error ?? '').length > 8, JSON.stringify(j));
    }
  }

  console.log(`\n${assertions} assertions, ${failures} failed`);
  if (failures > 0) {
    console.error(
      '\nA rejected form is the one moment a product talks about itself instead of\n' +
        'to the person in front of it. That is where internal wording reaches the\n' +
        'screen, and it reaches the screen in front of a reader.\n',
    );
  }
  process.exitCode = failures > 0 ? 1 : 0;
}

try {
  await main();
} finally {
  server.kill();
  for (const s of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(TEST_DB + s, { force: true, maxRetries: 3 });
    } catch {
      /* the OS temp directory will get it */
    }
  }
}