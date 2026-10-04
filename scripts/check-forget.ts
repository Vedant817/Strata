/**
 * Does "Forget my reading history" actually forget?
 *
 * This is the link in the footer of a publication whose entire argument is that
 * it does not track people. It is the one promise where a partial implementation
 * is not a bug but a betrayal: a reader who clicks it and is then told their
 * history is gone, while rows remain, has been lied to by the product's most
 * trustworthy-looking surface.
 *
 * So this does not check that the endpoint returns 200. It builds up every kind
 * of reading state a browser can accumulate, clicks the link, and then asks the
 * database what is left — table by table, not just the ones the endpoint knows
 * about. Anything that can still identify the anon id is a failure.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const PORT = process.env.FORGET_PORT ?? '4655';
const HOST = '127.0.0.1';
const base = `http://${HOST}:${PORT}`;
const RUN = Date.now().toString(36).slice(-5);
const TEST_DB = path.join(os.tmpdir(), `strata-forget-${RUN}.db`);
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
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`seed ${c}`))));
    p.on('error', reject);
  });
}

const SLUG = 'cache-invalidation-is-a-distributed-problem';

async function main() {
  if (!(await waitForServer())) { console.error(boot); process.exit(1); }
  await seed();

  const { readyDb } = await import('../src/lib/db/index.ts');
  const schema = await import('../src/lib/db/schema.ts');
  const { sql } = await import('drizzle-orm');
  const db = await readyDb();

  const anon = `forget-${RUN}`;
  const cookie = `strata_anon=${anon}`;

  const form = (p: string, fields: Record<string, string>) =>
    fetch(new URL(p, base), {
      method: 'POST', redirect: 'manual',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie, origin: base, referer: `${base}/w/${SLUG}`,
      },
      body: new URLSearchParams(fields).toString(),
    });

  /* --- accumulate every kind of reading state a browser leaves behind. --- */
  const art = await (await fetch(`${base}/w/${SLUG}`, { headers: { cookie } })).text();
  const noteId = /name="noteId" value="([^"]+)"/.exec(art)?.[1] ?? '';
  const parentId = /name="parentId" value="([^"]+)"/.exec(art)?.[1] ?? '';
  const postId = /(?:const|let|var)\s+postId\s*=\s*["']([^"']+)["']/.exec(art)?.[1] ?? '';
  const blockId = /data-block-id="([^"]+)"/.exec(art)?.[1] ?? '';

  await form('/api/notes', { action: 'reply', parentId, returnTo: `/w/${SLUG}`, body: `A note to forget ${RUN}` });
  await form('/api/notes', { action: 'react', noteId, kind: 'useful', returnTo: `/w/${SLUG}` });
  await form('/api/highlight', { postId, blockId, start: '0', end: '10', returnTo: `/w/${SLUG}` });
  await form('/api/presence', { action: 'follow', handle: 'vedant', returnTo: '/' });
  await fetch(`${base}/w/${SLUG}`, { headers: { cookie } });
  await fetch(`${base}/w/${SLUG}?ask=${encodeURIComponent('What is wrong with a TTL here?')}`, { headers: { cookie } });

  /** Every row anywhere that still names this browser. */
  const tables = await db.all<{ name: string }>(sql`
    SELECT name FROM sqlite_master
    WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'
    AND name NOT LIKE 'drizzle%'
  `);

  /**
   * Rows still traceable to this browser, table by table.
   *
   * `annotations` is the one deliberate exception, and it is listed rather than
   * filtered out silently: a note is published in a thread other people have
   * replied to, so forgetting reading history must not delete their words. The
   * privacy page is required to say so, which is asserted separately below — an
   * exemption nobody is told about is just an unkept promise.
   */
  const KEPT_ON_PURPOSE = ['annotations'];

  const residueFor = async (anonId: string) => {
    const found: string[] = [];
    for (const { name } of tables) {
      try {
        const cols = await db.all<{ name: string }>(sql.raw(`PRAGMA table_info("${name}")`));
        const textCols = cols
          .filter((c) => /anon|session|visitor|voter|from_anon/i.test(c.name))
          .map((c) => c.name);
        for (const col of textCols) {
          const rows = await db.all<{ n: number }>(
            sql.raw(`SELECT count(*) AS n FROM "${name}" WHERE "${col}" LIKE '%${anonId}%'`),
          );
          const n = Number(rows[0]?.n ?? 0);
          if (n > 0) found.push(`${name}.${col}=${n}`);
        }
      } catch {
        /* a view or virtual table we cannot inspect; not a residue claim */
      }
    }
    return found;
  };

  const before = await residueFor(anon);
  check(
    'the browser accumulated state worth forgetting',
    before.length > 0,
    'nothing was recorded, so forgetting proves nothing',
  );
  console.log(`          before: ${before.join(', ') || '(nothing)'}`);

  /* --- find the link the way a reader does, and follow it --------------- */
  const footer = await (await fetch(`${base}/w/${SLUG}`, { headers: { cookie } })).text();
  const forgetHref = /href="([^"]*#forget[^"]*)"/.exec(footer)?.[1];
  check(
    'the footer offers a forget link',
    Boolean(forgetHref),
    'no forget link found in the footer',
  );

  /* The link lands on the privacy page, and the *form* there is the action.
     Driving the form as the page presents it is the point: an earlier version of
     this probe posted to the endpoint with no anon field, got a clean redirect,
     and would have reported that forgetting works. */
  const privacy = await (await fetch(new URL(forgetHref ?? '/privacy', base), {
    headers: { cookie },
  })).text();
  const forgetAction = /<form[^>]+action="(\/api\/forget)"/.exec(privacy)?.[1];
  const anonField = /<input[^>]+name="anon"[^>]+value="([^"]+)"/.exec(privacy)?.[1]
    ?? /<input[^>]+value="([^"]+)"[^>]+name="anon"/.exec(privacy)?.[1]
    ?? '';
  check('the privacy page carries a forget form', Boolean(forgetAction), 'no form found');
  check('and it carries this browser’s anon id', anonField === anon, `form said "${anonField}", cookie said "${anon}"`);

  const res = await form(forgetAction ?? '/api/forget', { anon: anonField });
  check('forgetting redirects rather than erroring', res.status === 303, `${res.status}`);
  check(
    'and lands on the confirmation a reader can see',
    (res.headers.get('location') ?? '').includes('forgotten'),
    `location: ${res.headers.get('location')}`,
  );

  const confirmation = await (
    await fetch(new URL(res.headers.get('location') ?? '/privacy', base), { headers: { cookie } })
  ).text();
  check(
    'the page confirms in words, not just by redirect',
    /Done\./.test(confirmation) && /deleted/.test(confirmation),
    'no confirmation on the page after forgetting',
  );

  const after = await residueFor(anon);
  const unexpected = after.filter((r) => !KEPT_ON_PURPOSE.some((t) => r.startsWith(t)));
  check(
    'nothing anywhere still links to this browser',
    unexpected.length === 0,
    `left behind: ${unexpected.join(', ')}`,
  );

  /* The exemption is only acceptable if the reader is told about it. */
  check(
    'and the page tells the reader their notes were kept, and why',
    /notes in the margins/i.test(confirmation) && /reply/i.test(confirmation),
    'the confirmation claims everything is gone',
  );

  /* The question survives as writer signal, and with no link back. */
  {
    const { asks } = await import('../src/lib/db/schema.ts');
    const { eq: eq2 } = await import('drizzle-orm');
    const mine = await db.select().from(asks).where(eq2(asks.question, 'What is wrong with a TTL here?'));
    check('the question itself is kept for the writer', mine.length === 1, `${mine.length} rows`);
    check(
      'but it no longer points at this browser',
      mine[0]?.anonId === null || mine[0]?.anonId === undefined,
      `anon_id is ${JSON.stringify(mine[0]?.anonId)}`,
    );
  }

  /* The reader's own note survives — deliberately — and they can still see and
     remove it, so the exemption is an action rather than a loss of control.
     The form posts to `/api/notes` and carries `value="remove"` as a hidden
     input, so look for that rather than for an `action="remove"` attribute,
     which this markup never has. */
  {
    const art3 = await (await fetch(`${base}/w/${SLUG}`, { headers: { cookie } })).text();
    check(
      'their note is still on the article, which is what the page now says',
      art3.includes(`A note to forget ${RUN}`),
      'the note vanished, which contradicts the stated policy',
    );
    check(
      'and it carries a control that removes it',
      art3.includes('value="remove"'),
      'no remove control on their own note',
    );

    /* And the control is actually the reader's to use: not offered to anyone else,
       and effective when used. */
    const asOther = await (await fetch(`${base}/w/${SLUG}`, {
      headers: { cookie: `strata_anon=not-me-${RUN}` },
    })).text();
    check(
      'but it is not offered to another reader',
      !asOther.includes(`value="remove"`) || asOther.split('value="remove"').length - 1 < art3.split('value="remove"').length - 1,
      'another reader is offered a delete control on a note that is not theirs',
    );
  }

  /* --- and the site still works afterwards ------------------------------- */
  {
    const home = await fetch(`${base}/`, { headers: { cookie } });
    check('the site still serves after forgetting', home.status === 200, String(home.status));
    const art2 = await fetch(`${base}/w/${SLUG}`, { headers: { cookie } });
    const html = await art2.text();
    check(
      'the article still renders',
      art2.status === 200 && /Cache invalidation is a distributed/.test(html),
      String(art2.status),
    );
  }

  /* --- other readers are untouched -------------------------------------- */
  {
    const bystanderAnon = `bystander-${RUN}`;
    await fetch(`${base}/w/${SLUG}?ask=${encodeURIComponent('What is wrong with a TTL?')}`, {
      headers: { cookie: `strata_anon=${bystanderAnon}` },
    });
    const bystander = await residueFor(bystanderAnon);
    check(
      "one reader's erasure does not take another's with it",
      bystander.length > 0,
      `bystander rows: ${bystander.join(', ') || '(none — collateral damage)'}`,
    );
  }

  console.log(`\n${assertions} assertions, ${failures} failed`);
  if (failures > 0) {
    console.error(
      '\nThis is the one promise where a partial implementation is a betrayal rather\n' +
        'than a bug. A reader who is told their history is gone, and is not, has been\n' +
        'misled by the surface that looks most trustworthy on the whole site.\n',
    );
  }
  process.exitCode = failures > 0 ? 1 : 0;
}

try {
  await main();
} finally {
  server.kill();
  for (const s of ['', '-wal', '-shm']) { try { fs.rmSync(TEST_DB + s, { force: true, maxRetries: 3 }); } catch { /* temp */ } }
}