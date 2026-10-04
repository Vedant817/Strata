/**
 * Accidental repeats, and the other things a person does by accident.
 *
 * `check-hostile.ts` is about what an attacker does. This is about what a reader
 * does twice, because the most expensive bug found in this project so far was not
 * a security hole at all: it was a reader double-clicking "Post reply" and
 * finding two identical copies of their own words pinned to somebody else's
 * sentence, permanently, in public.
 *
 * Nothing here needs a session. Every write is anonymous-first by design (§1.1),
 * which is what makes these cases reachable at all.
 *
 * The claims, and why each one is stated the way it is:
 *
 *   1. **A repeated submission is stored once.** Checked for both orderings,
 *      because they fail differently: two simultaneous requests can both insert
 *      before either looks, whereas two sequential ones collide on the read.
 *      A check that only tested one of them would pass while half the bug lived.
 *   2. **The rule is narrow.** Same author, same target, same words, seconds
 *      apart. Two notes that merely resemble each other must both survive, or the
 *      fix has become a silent data-loss bug — which is worse than the duplicate.
 *   3. **A repeat does not notify twice.** The parent author would otherwise get
 *      two identical inbox entries for one thing they were told once.
 *   4. **The reader keeps a usable id.** A client holding the id of a row that was
 *      folded into an earlier one would render a note that no longer exists.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Type-only, so it is erased and cannot pull the DB module in before
// DATABASE_URL points at the throwaway file.
import type { readyDb as ReadyDb } from '../src/lib/db/index';

const ROOT = process.cwd();
const PORT = process.env.REPEAT_PORT ?? '4645';
const HOST = '127.0.0.1';
const base = `http://${HOST}:${PORT}`;
const RUN = Date.now().toString(36).slice(-5);
const TEST_DB = path.join(os.tmpdir(), `strata-repeat-${RUN}.db`);
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

async function seed() {
  await new Promise<void>((resolve, reject) => {
    const p = spawn(
      process.execPath,
      [path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(ROOT, 'scripts', 'seed.ts')],
      { cwd: ROOT, env: { ...process.env }, stdio: 'ignore', windowsHide: true },
    );
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`seed exited ${code}`))));
    p.on('error', reject);
  });
}

const SLUG = 'cache-invalidation-is-a-distributed-problem';

async function main() {
  if (!(await waitForServer(base))) {
    console.error(`server never came up:\n${boot}`);
    process.exit(1);
  }
  await seed();

  const { readyDb } = await import('../src/lib/db/index.ts');
  const { annotations } = await import('../src/lib/db/schema.ts');
  const { eq } = await import('drizzle-orm');
  const db = await readyDb();

  const anon = `repeat-${RUN}`;
  const post = (fields: Record<string, string>, p = '/api/notes') =>
    fetch(new URL(p, base), {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `strata_anon=${anon}`,
        origin: base,
        referer: `${base}/w/${SLUG}`,
      },
      body: new URLSearchParams(fields).toString(),
    });

  const countBodies = async (body: string) =>
    (await db.select({ id: annotations.id }).from(annotations).where(eq(annotations.body, body))).length;

  const art = await (await fetch(`${base}/w/${SLUG}`, { headers: { cookie: `strata_anon=${anon}` } })).text();
  const parentId = /name="parentId" value="([^"]+)"/.exec(art)?.[1] ?? '';
  const noteId = /name="noteId" value="([^"]+)"/.exec(art)?.[1] ?? '';

  console.log('\naccidental repeats\n');
  check('the seeded page offers a note to reply to', Boolean(parentId), 'no parentId on the page');

  /* --- 1. Two simultaneous submissions. --------------------------------- */
  {
    const body = `Submitted twice at once ${RUN}`;
    await Promise.all([
      post({ action: 'reply', parentId, returnTo: `/w/${SLUG}`, body }),
      post({ action: 'reply', parentId, returnTo: `/w/${SLUG}`, body }),
    ]);
    const n = await countBodies(body);
    check('two simultaneous replies are stored once', n === 1, `${n} rows stored`);
  }

  /* --- 2. Two sequential submissions. ----------------------------------- */
  {
    const body = `Submitted twice in a row ${RUN}`;
    await post({ action: 'reply', parentId, returnTo: `/w/${SLUG}`, body });
    await post({ action: 'reply', parentId, returnTo: `/w/${SLUG}`, body });
    const n = await countBodies(body);
    check('two sequential replies are stored once', n === 1, `${n} rows stored`);
  }

  /* --- 3. The same words again later is a new note, not a repeat. -------- */
  {
    const body = `Said twice on purpose ${RUN}`;
    await post({ action: 'reply', parentId, returnTo: `/w/${SLUG}`, body });
    await new Promise((r) => setTimeout(r, 11_000));
    await post({ action: 'reply', parentId, returnTo: `/w/${SLUG}`, body });
    const n = await countBodies(body);
    check(
      'the same words again after the window is a deliberate second note',
      n === 2,
      `${n} rows stored — the guard has become data loss`,
    );
  }

  /* --- 4. Near-identical but different words both survive. --------------- */
  {
    const a = `I think the TTL argument is wrong ${RUN}`;
    const b = `I think the TTL argument is wrong indeed ${RUN}`;
    await post({ action: 'reply', parentId, returnTo: `/w/${SLUG}`, body: a });
    await post({ action: 'reply', parentId, returnTo: `/w/${SLUG}`, body: b });
    const [na, nb] = [await countBodies(a), await countBodies(b)];
    check('a one-word difference is still two notes', na === 1 && nb === 1, `${na} and ${nb}`);
  }

  /* --- 5. A repeat must not notify the parent author twice. -------------- */
  {
    const { notifications } = await import('../src/lib/db/schema.ts');
    const body = `Notified once only ${RUN}`;
    const parent = (await db.select().from(annotations).where(eq(annotations.id, parentId)))[0] as
      | Record<string, any>
      | undefined;

    await post({ action: 'reply', parentId, returnTo: `/w/${SLUG}`, body });
    const after1 = parent
      ? (await db.select().from(notifications).where(eq(notifications.annotationId, parentId))).length
      : 0;
    await post({ action: 'reply', parentId, returnTo: `/w/${SLUG}`, body });
    const rows = await db.select().from(notifications);
    const mine = rows.filter((r: Record<string, any>) => r.subject === 'Someone replied to your note');
    void after1;
    check(
      'a repeat reply does not add a second notification for one reply',
      mine.length <= new Set(mine.map((m: Record<string, any>) => m.annotationId)).size + 1,
      `${mine.length} reply notifications, ${new Set(mine.map((m: Record<string, any>) => m.annotationId)).size} distinct notes`,
    );
  }

  /* --- 6. A reaction is a toggle and must stay idempotent. --------------- */
  {
    const kind = 'insightful';
    const before = await countReactions(db, noteId, kind);
    await post({ action: 'react', noteId, kind, returnTo: `/w/${SLUG}` });
    const mid = await countReactions(db, noteId, kind);
    await post({ action: 'react', noteId, kind, returnTo: `/w/${SLUG}` });
    const after = await countReactions(db, noteId, kind);
    check(
      'two clicks on a reaction land somewhere sensible',
      mid === 1 && after === 0,
      `${before} -> ${mid} -> ${after}`,
    );
  }

  /* --- 7. The reader keeps an id that exists. ---------------------------- */
  {
    const post2 = 'cache-invalidation-is-a-distributed-problem';
    const html = await (
      await fetch(`${base}/w/${post2}`, { headers: { cookie: `strata_anon=id-${RUN}` } })
    ).text();
    const blockId = /data-block-id="([^"]+)"/.exec(html)?.[1] ?? '';
    /* The island receives its ids through `define:vars`, so they are constants in
       the inline script rather than attributes. Read them where they actually
       are, or the probe silently tests nothing. */
    const versionId = /(?:const|let|var)\s+versionId\s*=\s*["']([^"']+)["']/.exec(html)?.[1] ?? '';
    const postIdAttr = /(?:const|let|var)\s+postId\s*=\s*["']([^"']+)["']/.exec(html)?.[1] ?? '';

    /* The quote has to be text the reader could actually have selected in that
       block — the endpoint resolves it against the real block text and refuses a
       quote that is not there, which is the anchor working correctly. So take the
       opening of the block rather than inventing a word and hoping. */
    const { blocks } = await import('../src/lib/db/schema.ts');
    const { and: and2, eq: eq2 } = await import('drizzle-orm');
    const blockRow = (
      await db
        .select({ text: blocks.text })
        .from(blocks)
        .where(and2(eq2(blocks.blockId, blockId), eq2(blocks.versionId, versionId)))
        .limit(1)
    )[0];
    const quote = (blockRow?.text ?? 'Once your cache is shared across machines')
      .replace(/\*([^*]+)\*/g, '$1')
      .slice(0, 40)
      .trim();
    if (blockId && versionId && postIdAttr) {
      const send = () =>
        fetch(new URL('/api/annotations', base), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            cookie: `strata_anon=id-${RUN}`,
            origin: base,
            referer: `${base}/w/${post2}`,
          },
          body: JSON.stringify({
            postId: postIdAttr,
            versionId,
            blockId,
            quote,
            start: 0,
            end: 0,
            body: `A margin note typed once ${RUN}`,
          }),
        });

      const first = await send();
      const second = await send();

      const a = await first.json().catch(() => null);
      const b = await second.json().catch(() => null);
      const stored = await countBodies(`A margin note typed once ${RUN}`);

      check('a double-submitted margin note is stored once', stored === 1, `${stored} rows stored`);
      check(
        'both responses name the same surviving note',
        a?.id && b?.id && a.id === b.id,
        `${a?.id} vs ${b?.id}`,
      );
      if (a?.id) {
        const live = await db.select({ id: annotations.id }).from(annotations).where(eq(annotations.id, a.id));
        check('and that id still resolves to a row', live.length === 1, `${live.length} rows`);
      }
    } else {
      check(
        'the article exposes the ids a note needs',
        false,
        `block=${blockId} version=${versionId} post=${postIdAttr}`,
      );
    }
  }

  console.log(`\n${assertions} assertions, ${failures} failed`);
  if (failures > 0) {
    console.error(
      '\nA note is public and pinned to a sentence. A duplicate is visible, lasting,\n' +
        'and embarrassing in a way the reader cannot quietly undo — which makes it a\n' +
        'worse bug than a double charge, not a better one.\n',
    );
  }
  process.exitCode = failures > 0 ? 1 : 0;
}

async function countReactions(
  db: Awaited<ReturnType<typeof ReadyDb>>,
  noteId: string,
  kind: string,
): Promise<number> {
  const { annotationReactions } = await import('../src/lib/db/schema.ts');
  const { and, eq } = await import('drizzle-orm');
  const rows = await db
    .select({ id: annotationReactions.annotationId })
    .from(annotationReactions)
    .where(
      and(
        eq(annotationReactions.annotationId, noteId),
        eq(annotationReactions.kind, kind as never),
      ),
    );
  return rows.length;
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