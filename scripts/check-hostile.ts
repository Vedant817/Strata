/**
 * The app, used badly.
 *
 * `smoke.mjs` walks 35 routes and checks they return 200. That answers "does it
 * come up". It does not answer anything a reader with devtools, a crawler, or a
 * bored person with curl actually does — and the failures worth finding are
 * there. A route that 500s on the wrong content type is invisible to a status
 * check; a response that lies about its own `Vary` will hand gzip to a client
 * that cannot read it; a page whose prose only exists after a script runs breaks
 * the product's central promise.
 *
 * Nothing here needs a valid session. Every probe is read-only, or is a write
 * that *should* be refused.
 *
 * What was wrong the first time round is worth recording, because it shaped this
 * file:
 *
 *   - The reflection checks asked "is this substring in the body?" and reported a
 *     reflected-XSS vulnerability that does not exist — Astro escapes `"` to
 *     `&quot;`, so the payload sits inertly inside an attribute value. Substring
 *     matching cannot tell an inert reflection from a live one. That check now
 *     lives in `check-xss.ts`, which loads each payload in Chrome and asks
 *     whether it *ran*.
 *   - The auth checks assumed routes needed a session that several of them are
 *     designed not to need: claiming a handle, subscribing to the newsletter and
 *     posting a margin note are all anonymous-first, by §1.1. Asserting 401 there
 *     would have been asserting the opposite of the product. So the auth section
 *     only covers the two routes that genuinely are writer-scoped, and the rest
 *     of the API is covered by the claim that actually holds: *nothing* 5xxes,
 *     whatever you send it.
 *   - Half the route names were wrong. The assertions passed and failed for
 *     reasons unrelated to the thing being tested, which is worse than no
 *     assertions at all.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import path from 'node:path';

const ROOT = process.cwd();
const PORT = process.env.HOSTILE_PORT ?? '4600';
const HOST = '127.0.0.1';
const base = `http://${HOST}:${PORT}`;

/* A throwaway database, because this check claims a handle in order to test the
   signed-in branch of /api/sessions. Pointed at before the DB module is
   evaluated, which is why it is an assignment here rather than a spawn option. */
const RUN = Date.now().toString(36).slice(-5);
const TEST_DB = path.join(os.tmpdir(), `strata-hostile-${RUN}.db`);
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
  cwd: ROOT,
  env: { ...process.env, PORT, HOST },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let boot = '';
server.stdout.on('data', (d) => (boot += d));
server.stderr.on('data', (d) => (boot += d));

async function waitForServer(url: string, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      if ((await fetch(url, { redirect: 'manual' })).status > 0) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/** Seed into the throwaway database. Spawned: seed.ts ends in process.exit. */
function seed() {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(
      process.execPath,
      [path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(ROOT, 'scripts', 'seed.ts')],
      { cwd: ROOT, env: { ...process.env }, stdio: 'ignore', windowsHide: true },
    );
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`seed exited ${code}`))));
    p.on('error', reject);
  });
}

/**
 * Become a signed-in writer.
 *
 * Needed because one of the two bugs this check found was invisible from the
 * outside: `/api/sessions` answers 401 before it ever reads the body, so an
 * anonymous probe sees a clean 401 whether or not the `formData()` call below it
 * throws. The crash was real and it was one header away from being visible.
 */
async function signIn() {
  const { requestHandleClaim, redeemHandleClaim, SESSION_COOKIE } = await import(
    '../src/lib/repo/auth.ts'
  );
  const handle = `hostile${RUN}`;
  const anonId = `hostile-${RUN}`;
  const requested = await requestHandleClaim({ handle, email: `${handle}@example.com`, anonId });
  if (!requested.ok) throw new Error(`handle claim: ${requested.error}`);
  const jar = new Map<string, { value: string }>();
  const cookies = {
    get: (k: string) => jar.get(k),
    set: (k: string, v: string) => void jar.set(k, { value: v }),
    delete: (k: string) => void jar.delete(k),
    has: (k: string) => void jar.has(k),
  };
  const redeemed = await redeemHandleClaim(requested.token, cookies as never);
  if (!redeemed.ok) throw new Error(`redeem: ${redeemed.error}`);
  return { handle, cookie: `strata_anon=${anonId}; ${SESSION_COOKIE}=${jar.get(SESSION_COOKIE)!.value}` };
}

/** Never throws: a probe that dies is a finding, not a crash. */
async function probe(pathname: string, init: RequestInit = {}) {
  try {
    const res = await fetch(new URL(pathname, base), { redirect: 'manual', ...init });
    return { status: res.status, headers: res.headers, body: await res.text(), error: '' };
  } catch (err) {
    return { status: 0, headers: new Headers(), body: '', error: (err as Error).message };
  }
}

/**
 * Raw bytes over a raw socket, for anything that has to be decoded rather than
 * read.
 *
 * `probe` above goes through `res.text()`, which decodes bytes as UTF-8 — right
 * for HTML, badly wrong for a gzip body, since compressed bytes are not valid
 * UTF-8 and come back mangled.
 *
 * `probeBytes` is not enough either, for a subtler reason: Node's `fetch`
 * transparently decompresses. It hands back inflated bytes while leaving
 * `content-encoding: gzip` on the response, so gunzipping them fails and the
 * failure looks exactly like a server sending corrupt gzip. `node:http` does no
 * such thing, which is the only way to see what is actually on the wire — and
 * what is on the wire is the thing a CDN would cache.
 */
function rawGet(pathname: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; buf: Buffer }>(
    (resolve, reject) => {
      const req = http.request(
        { host: HOST, port: PORT, path: pathname, method: 'GET', headers },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              buf: Buffer.concat(chunks),
            }),
          );
        },
      );
      req.on('error', reject);
      req.end();
    },
  );
}

type Probe = Awaited<ReturnType<typeof probe>>;

/** Every API route, discovered rather than remembered. */
const API_ROUTES = [
  'annotations',
  'artifact-preview',
  'claim',
  'fork',
  'forget',
  'highlight',
  'import',
  'keys',
  'lists',
  'memory',
  'newsletter',
  'notes',
  'notifications',
  'passkey',
  'presence',
  'search-index',
  'sessions',
  'settings',
  'studio',
  'subscribe',
  'telemetry',
  'webmention',
];

/**
 * The claim this whole section rests on: no API route answers a malformed
 * request with a server error.
 *
 * Three content types, because each takes a different parse path and each had
 * its own way of throwing. A JSON body to a form endpoint makes `formData()`
 * throw; a form body to a JSON endpoint makes `json()` throw. Two of these were
 * live 500s before this existed — `/api/notifications` and `/api/sessions` — and
 * the anonymous case is the one that mattered, since anyone could reach it.
 */
const CONTENT_TYPES: Array<[string, string]> = [
  ['application/json', '{}'],
  ['application/x-www-form-urlencoded', 'a=1'],
  ['text/plain', 'a=1'],
];

async function main() {
  if (!(await waitForServer(base))) {
    console.error(`server never came up:\n${boot}`);
    process.exit(1);
  }
  await seed();

  /* ---------------------------------------------------------------- paths */
  console.log('\npaths\n');
  {
    const hostile = [
      '/../package.json',
      '/..%2fpackage.json',
      '/w/../../../package.json',
      '/w/..%2f..%2fpackage.json',
      '/w/%00',
      '/w/cache-invalidation%00.png',
      `/${'a'.repeat(3000)}`,
      `/w/${'a'.repeat(3000)}`,
      '/w/缓存失效',
      '/w/../../',
      '/w//cache-invalidation-is-a-distributed-problem',
      '/./w/./cache-invalidation-is-a-distributed-problem',
      '/w/cache-invalidation-is-a-distributed-problem.',
      '/W/CACHE-INVALIDATION-IS-A-DISTRIBUTED-PROBLEM',
      '/studio/loom/../../..',
      '/w/cache-invalidation-is-a-distributed-problem/../../../../../../etc/passwd',
      '/%2e%2e%2f%2e%2e%2fpackage.json',
      '/api/../../package.json',
    ];
    const results: Array<[string, Probe]> = [];
    for (const p of hostile) results.push([p, await probe(p)]);

    const crashed = results.filter(([, r]) => r.status >= 500);
    check(
      `no hostile path returns a 5xx (${hostile.length} paths)`,
      crashed.length === 0,
      crashed.map(([p, r]) => `${p} -> ${r.status}`).join(', '),
    );
    const dropped = results.filter(([, r]) => r.error);
    check(
      'no hostile path drops the connection',
      dropped.length === 0,
      dropped.map(([p, r]) => `${p} -> ${r.error}`).join('; '),
    );
    const leaked = results.filter(
      ([, r]) => r.body.includes('DATABASE_AUTH_TOKEN') || r.body.includes('"dependencies"'),
    );
    check('no path serves file contents', leaked.length === 0, leaked.map(([p]) => p).join(', '));

    const pkg = results.find(([p]) => p === '/../package.json')![1];
    check(
      'traversal does not serve package.json',
      !pkg.body.includes('"name"'),
      `status ${pkg.status}: ${pkg.body.slice(0, 80)}`,
    );

    /* A 404 is the right answer for a missing post; a 200 with an empty body is a
       soft failure that reads fine in a status check and looks broken to a person. */
    const missing = results.find(([p]) => p.includes('a'.repeat(3000)))![1];
    check('an over-long path is a 404, not an empty 200', missing.status === 404, String(missing.status));

    const upper = results.find(([p]) => p === '/W/CACHE-INVALIDATION-IS-A-DISTRIBUTED-PROBLEM')![1];
    check('slug casing is not silently accepted', upper.status === 404, String(upper.status));

    const nul = results.find(([p]) => p === '/w/%00')![1];
    check('a null byte is refused, not truncated', nul.status !== 200, String(nul.status));
  }

  /* --------------------------------------------------------------- queries */
  console.log('\nqueries\n');
  {
    const payloads = [
      `<script>alert('xss')</script>`,
      `${'${7*7}'}`,
      `' OR 1=1 --`,
      `'; DROP TABLE posts; --`,
      `%3Cscript%3Ealert(1)%3C/script%3E`,
      `\\u0000`,
      `a`.repeat(5000),
    ];
    /* Reflection is not asserted here. It is asserted in `check-xss.ts`, against
       a real DOM, because the question "did this become markup" cannot be
       answered by looking at bytes. What matters on this side is that no
       parameter, however hostile, turns a read into a server error. */
    for (const surface of [
      { path: '/search', key: 'q' },
      { path: '/w/cache-invalidation-is-a-distributed-problem', key: 'rev' },
      { path: '/w/cache-invalidation-is-a-distributed-problem', key: 'ask' },
      { path: '/w/cache-invalidation-is-a-distributed-problem', key: 'stress' },
      { path: '/constellations', key: 'q' },
      { path: '/topics', key: 'q' },
      { path: '/lists/start-here', key: 'q' },
      { path: '/capture', key: 'q' },
      { path: '/reader', key: 'q' },
      { path: '/a/vedant', key: 'q' },
      { path: '/privacy', key: 'q' },
      { path: '/404', key: 'q' },
    ]) {
      let worst = 0;
      let worstPayload = '';
      for (const payload of payloads) {
        const r = await probe(`${surface.path}?${surface.key}=${encodeURIComponent(payload)}`);
        if (r.status >= 500) {
          worst = r.status;
          worstPayload = payload.slice(0, 40);
        }
      }
      check(
        `${surface.path}?${surface.key} survives ${payloads.length} hostile values`,
        worst < 500,
        worst ? `${worstPayload} -> ${worst}` : '',
      );
    }

    /* Odd shapes rather than odd values. */
    for (const q of [
      '?rev=1&rev=2',
      '?rev=abc',
      '?rev=-1',
      '?rev=999999',
      '?rev=1.5',
      '?rev=NaN',
      '?ask=&ask=x',
      `?utm_source=${'z'.repeat(2000)}`,
      '?q=' + '%'.repeat(500),
    ]) {
      const r = await probe(`/w/cache-invalidation-is-a-distributed-problem${q}`);
      check(`/w${q.slice(0, 30)} is handled`, r.status < 500, String(r.status));
    }
  }

  /* ------------------------------------------------------------------- api */
  console.log('\napi — no route 5xxes whatever you send it\n');
  {
    for (const route of API_ROUTES) {
      for (const [type, body] of CONTENT_TYPES) {
        const r = await probe(`/api/${route}`, {
          method: 'POST',
          headers: { 'content-type': type, origin: base, referer: `${base}/` },
          body,
        });
        check(
          `POST /api/${route} as ${type.split(';')[0]} is not a server error`,
          r.status < 500,
          `${r.status} ${r.error || r.body.slice(0, 80)}`,
        );
      }
    }

    /* GET on a POST-only endpoint must not perform the work. The observed
       contract is a 303 back to the page that owns the form, so assert that it
       redirects somewhere rather than hard-coding a status that would break the
       moment a route grows a GET. */
    for (const route of ['import', 'notes', 'studio', 'settings', 'newsletter']) {
      const r = await probe(`/api/${route}`, { headers: { origin: base } });
      check(
        `GET /api/${route} does not do the work`,
        r.status !== 200 && (r.status === 303 || r.status === 404 || r.status === 405),
        `${r.status} ${r.body.slice(0, 70)}`,
      );
    }

    /* Malformed JSON in detail, on the routes that parse JSON. */
    /* artifact-preview is not a validator: a preview with nothing to preview is
       meant to render the default figure, so it answers 200 to garbage. What it
       must do is render whatever it echoes, escaped — it is anonymous, and the
       title and field values are the caller's. */
    for (const payload of ['<img src=x onerror=alert(1)>', '"><script>alert(1)</script>']) {
      const r = await probe('/api/artifact-preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: base },
        body: JSON.stringify({ component: 'curve', title: payload, fields: { label: payload } }),
      });
      check(
        'artifact-preview does not echo hostile input as markup',
        !r.body.includes(payload) && (r.body.includes('&lt;') || !r.body.includes('<')),
        r.body.slice(0, 120),
      );
    }
    for (const bad of ['[]', '{"artifact":"not an object"}', '{}', '{"fields":7}', 'null']) {
      const r = await probe('/api/artifact-preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: base },
        body: bad,
      });
      check(`artifact-preview survives ${bad.slice(0, 26)}`, r.status < 500, `${r.status}`);
    }

    for (const [route, body] of [
      ['import', 'not json at all'],
      ['import', '{"files":"not an array"}'],
      ['import', '{"files":[null]}'],
      ['import', '{"__proto__":{"admin":true},"files":[]}'],
      ['import', '{"files":[{"filename":"../../x.md","content":"# hi"}]}'],
      ['import', '{"files":[{"filename":"a.md"}]}'],
      ['passkey', '{"action":"nonsense"}'],
      ['annotations', '{"postId":"x"}'],
    ] as Array<[string, string]>) {
      const r = await probe(`/api/${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: base, referer: `${base}/` },
        body,
      });
      check(
        `/api/${route} rejects ${body.slice(0, 34)}`,
        r.status >= 400 && r.status < 500,
        `${r.status} ${r.body.slice(0, 80)}`,
      );
    }

    /* Size, not a crash: a body large enough to matter must be refused by limit
       rather than taking the process down. */
    const huge = JSON.stringify({ files: [{ filename: 'a.md', content: 'x'.repeat(3 * 1024 * 1024) }] });
    const big = await probe('/api/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base, referer: `${base}/` },
      body: huge,
    });
    check('a 3MB body is refused, not crashed on', big.status < 500, String(big.status));
  }

  /* ------------------------------------------------------------------ auth */
  console.log('\nauth\n');
  {
    /* Only the routes that are genuinely writer-scoped. Claiming a handle,
       subscribing and leaving a margin note are anonymous-first by §1.1, so
       demanding 401 there would assert the opposite of the product. */
    for (const [route, payload] of [
      ['import', { files: [{ filename: 'x.md', content: '# hi' }] }],
      ['sessions', { action: 'revoke-others' }],
    ] as Array<[string, unknown]>) {
      const r = await probe(`/api/${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: base, referer: `${base}/` },
        body: JSON.stringify(payload),
      });
      check(`POST /api/${route} refuses an anonymous caller`, r.status === 401, `${r.status}`);
    }

    /* A forged or malformed session must not authenticate anything. */
    for (const cookie of [
      'strata_session=forged',
      'strata_session=',
      `strata_session=${'A'.repeat(200)}`,
      'strata_session=null',
      'strata_session=../..',
    ]) {
      const r = await probe('/api/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, origin: base, referer: `${base}/` },
        body: JSON.stringify({ files: [{ filename: 'x.md', content: '# hi' }] }),
      });
      check(
        `a forged session is refused (${cookie.slice(0, 22)})`,
        r.status === 401,
        `${r.status}`,
      );
    }

    /* The writer surfaces must not hand a stranger anybody's drafts, readers or
       questions. Checked structurally — the studio's own copy says "unanswered
       questions", so matching on words would fail for the right reason. */
    const anonStudio = await probe('/studio');
    check(
      'the studio does not hand an anonymous browser writer data',
      /Claim a handle|claim a handle|belongs to a named writer/i.test(anonStudio.body),
      anonStudio.body.slice(0, 140),
    );
    check(
      'and the studio is not indexed',
      /noindex/.test(anonStudio.headers.get('x-robots-tag') ?? '') ||
        /noindex/.test(anonStudio.body),
      'no noindex on /studio',
    );

    /* Cross-origin form posts are Astro's CSRF guard. */
    const crossOrigin = await probe('/api/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://evil.example' },
      body: new URLSearchParams({ anon: 'a', handle: 'x', email: 'a@b.co' }).toString(),
    });
    check(
      'a cross-origin form post is refused',
      crossOrigin.status === 403,
      `${crossOrigin.status} ${crossOrigin.body.slice(0, 80)}`,
    );

    /* The signed-in branch, which is where the second bug lived. Anonymous probes
       cannot reach it: /api/sessions answers 401 first, so this looks identical
       before and after the fix unless someone actually holds a session. */
    const me = await signIn();
    for (const [type, body] of CONTENT_TYPES) {
      const r = await probe('/api/sessions', {
        method: 'POST',
        headers: {
          'content-type': type,
          cookie: me.cookie,
          origin: base,
          referer: `${base}/settings`,
        },
        body,
      });
      check(
        `POST /api/sessions as a signed-in writer, ${type.split(';')[0]}, is not a server error`,
        r.status < 500,
        `${r.status} ${r.error || r.body.slice(0, 80)}`,
      );
    }
    /* And the writer's own surfaces answer a signed-in browser, which is the only
       way to know the private pages render rather than error. */
    for (const p of ['/studio', '/studio/loom', '/settings', '/reader', '/notifications', '/capture']) {
      const r = await probe(p, { headers: { cookie: me.cookie } });
      check(`${p} renders for a signed-in writer`, r.status === 200, `${r.status}`);
      check(`${p} tells an indexer to stay away`, /noindex/.test(r.body), 'no noindex on a private page');
    }
  }

  /* --------------------------------------------------------------- methods */
  console.log('\nmethods\n');
  {
    for (const p of ['/', '/w/cache-invalidation-is-a-distributed-problem', '/rss.xml', '/robots.txt']) {
      const res = await probe(p, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: base },
        body: '{}',
      });
      check(`POST ${p} is inert`, res.status < 500, String(res.status));
    }
    const head = await probe('/', { method: 'HEAD' });
    check('HEAD works on a page', head.status === 200, String(head.status));
    const headFeed = await probe('/rss.xml', { method: 'HEAD' });
    check('HEAD works on a feed', headFeed.status === 200, String(headFeed.status));
  }

  /* ------------------------------------------------------------------ nojs */
  console.log('\nno-js\n');
  {
    /* The product's claim is that the article is complete without scripting. So
       strip every <script> and check the prose is still there. */
    for (const p of [
      '/w/cache-invalidation-is-a-distributed-problem',
      '/',
      '/constellations',
      '/week',
      '/studio',
      '/lists/start-here',
      '/topics',
      '/thesis',
      '/about',
    ]) {
      const res = await probe(p);
      const stripped = res.body.replace(/<script\b[\s\S]*?<\/script>/gi, '');
      const text = stripped
        .replace(/<style\b[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      check(`${p} still has prose with scripting removed`, text.length > 400, `${text.length} chars`);
    }

    /* The depth dial is the one thing JavaScript genuinely drives, so the served
       HTML has to say something about it — otherwise the no-script claim is
       hollow for the one control the product is built around. */
    const article = await probe('/w/cache-invalidation-is-a-distributed-problem');
    check(
      'the article states its depth without scripting',
      /depth/i.test(article.body),
      'no depth affordance in the served HTML',
    );

    /* The forms are ordinary posts, so the no-script claim extends to writing:
       each mutating form must name its method and target. */
    for (const p of ['/write', '/capture', '/studio']) {
      const res = await probe(p);
      check(`${p} uses ordinary forms, not scripted submits`, /<form[^>]+method="post"/i.test(res.body) || /Claim a handle|claim a handle/i.test(res.body), 'no form post found');
    }
  }

  /* --------------------------------------------------------------- caching */
  console.log('\ncaching\n');
  {
    for (const p of ['/studio', '/studio/loom', '/week', '/reader', '/notifications']) {
      const res = await probe(p);
      const cc = res.headers.get('cache-control') ?? '';
      check(`${p} is not publicly cacheable`, !/\bpublic\b/.test(cc) || /no-store/.test(cc), `cache-control: ${cc || '(none)'}`);
    }

    /* `Vary: Accept-Encoding` is a promise. If a response says it and then sends
       the same bytes regardless, a shared cache will hand gzip to a client that
       cannot read it. */
    for (const p of ['/', '/w/cache-invalidation-is-a-distributed-problem', '/rss.xml']) {
      const identity = await probe(p, { headers: { 'accept-encoding': 'identity' } });
      const gzip = await probe(p, { headers: { 'accept-encoding': 'gzip' } });
      const varies = (identity.headers.get('vary') ?? '').toLowerCase();
      if (!varies.includes('accept-encoding')) {
        check(`${p} does not claim a Vary it cannot honour`, true);
        continue;
      }
      check(
        `${p} honours the Vary it declares`,
        gzip.headers.get('content-encoding') === 'gzip',
        `gzip request got content-encoding '${gzip.headers.get('content-encoding')}'`,
      );
      check(
        `${p} sends nothing encoded when the client will not read it`,
        identity.headers.get('content-encoding') === null,
        String(identity.headers.get('content-encoding')),
      );
    }
  }

  /* ------------------------------------------------------------- integrity */
  console.log('\nintegrity\n');
  {
    /* A compressed body must decompress to exactly the identity bytes. The bug
       this catches is the one that shipped once: read the body, decide not to
       compress, and return the drained response — which truncated everything
       under a kilobyte and looked like "the small routes are broken". */
    const surfaces = [
      '/',
      '/rss.xml',
      '/robots.txt',
      '/digest.xml',
      '/manifest.webmanifest',
      '/w/cache-invalidation-is-a-distributed-problem',
    ];
    for (const p of surfaces) {
      const id = (await rawGet(p, { 'accept-encoding': 'identity' })).buf.toString('utf8');
      for (const [enc, decode] of [
        ['gzip', gunzipSync],
        ['br', brotliDecompressSync],
      ] as const) {
        const res = await rawGet(p, { 'accept-encoding': enc });
        const declared = res.headers['content-encoding'];
        if (declared !== enc) {
          check(
            `${p} responds unencoded when ${enc} is not smaller`,
            res.status < 500,
            `${res.status}`,
          );
          continue;
        }
        let decoded = '';
        let ok = true;
        try {
          decoded = decode(res.buf).toString('utf8');
        } catch {
          ok = false;
        }
        check(
          `${p} as ${enc} decompresses to the identity body`,
          ok && decoded === id,
          ok ? `${decoded.length} vs ${id.length} chars` : `the ${enc} body on the wire would not decompress`,
        );
      }
    }

    /* Content-Length has to describe the body that was actually sent, or a client
       waits for bytes that are not coming. */
    for (const p of ['/', '/robots.txt', '/rss.xml']) {
      const res = await rawGet(p, { 'accept-encoding': 'identity' });
      const declared = res.headers['content-length'];
      if (declared === undefined) continue;
      check(
        `${p} content-length matches the body`,
        Number(declared) === res.buf.length,
        `declared ${declared}, sent ${res.buf.length}`,
      );
    }
  }

  console.log(`\n${assertions} assertions, ${failures} failed`);
  if (failures > 0) {
    console.error(
      '\nThese are the things a reader with devtools, a crawler, or five spare\n' +
        'minutes does. A 500 here is invisible to a status-code smoke test.\n',
    );
  }
  process.exitCode = failures > 0 ? 1 : 0;
}

try {
  await main();
} finally {
  server.kill();
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(TEST_DB + suffix, { force: true, maxRetries: 3 });
    } catch {
      /* the OS temp directory will get it */
    }
  }
}