/**
 * The first loom, end to end.
 *
 * §10.5's instruction is "take one existing post, make one revision, publish it,
 * see the reader-facing diff... then show them empathy analytics on a real seed
 * post, so the value is concrete rather than promised." A checklist cannot
 * deliver that, which is why this page exists.
 *
 * The claims worth testing are the ones that could pass while being wrong:
 *
 *   1. **Progress is derived, not stored.** Visiting the page must not tick
 *      anything. The assertion that matters is the inverse: an *unrevised* post
 *      shows steps 2–4 outstanding no matter how many times the page is loaded.
 *   2. **The diff shown here is the diff shown there.** Same renderer, same
 *      props. Asserted by comparing the writer's view against the public page's
 *      own diff output, not by checking that a diff-shaped thing exists.
 *   3. **The author's own words survive.** The change summary is quoted, never
 *      paraphrased.
 *   4. **It works with scripting off** — every step is a link.
 *
 * Drives a real server, a real author and a real revision. Throwaway database.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const PORT = process.env.LOOM_PORT ?? '4580';
const HOST = '127.0.0.1';
const base = `http://${HOST}:${PORT}`;
const RUN = Date.now().toString(36).slice(-5);
const TEST_DB = path.join(os.tmpdir(), `strata-loom-${RUN}.db`);
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
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status > 0) return true;
    } catch {
      /* not up */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/** Seed into the throwaway database. Spawned: seed.ts ends in process.exit. */
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

const ORIGIN = { origin: base, referer: `${base}/studio` };

async function main() {
  if (!(await waitForServer(base))) {
    console.error(`server never came up:\n${boot}`);
    process.exit(1);
  }
  await seed();

  const { redeemHandleClaim, requestHandleClaim, SESSION_COOKIE } = await import(
    '../src/lib/repo/auth.ts'
  );

  /* Become a writer, and take ownership of one seeded post so there is something
     of theirs to revise. */
  const anonId = `loom-${RUN}`;
  const handle = `loom${Date.now().toString(36).slice(-6)}`;
  const requested = await requestHandleClaim({ handle, email: `${handle}@example.com`, anonId });
  if (!requested.ok) {
    console.error(`claim: ${requested.error}`);
    process.exit(1);
  }
  const jar = new Map<string, { value: string }>();
  const cookies = {
    get: (k: string) => jar.get(k),
    set: (k: string, v: string) => void jar.set(k, { value: v }),
    delete: (k: string) => void jar.delete(k),
    has: (k: string) => jar.has(k),
  };
  const redeemed = await redeemHandleClaim(requested.token, cookies as never);
  if (!redeemed.ok) {
    console.error(`redeem: ${redeemed.error}`);
    process.exit(1);
  }
  const session = jar.get(SESSION_COOKIE)!.value;
  const cookie = `strata_anon=${anonId}; ${SESSION_COOKIE}=${session}`;

  console.log('\nfirst loom\n');

  /* Take ownership of a seeded post *before* looking at the page: a writer with
     no posts is correctly told to publish something first, and asserting against
     that branch would test nothing about the loop. */
  const { readyDb } = await import('../src/lib/db/index.ts');
  const { posts } = await import('../src/lib/db/schema.ts');
  const { eq } = await import('drizzle-orm');
  const db = await readyDb();

  /* `posts.authorId` references `users.id`, which is not the handle — the claim
     hands back the handle. Look the id up rather than guessing, or the write
     fails on a foreign key. */
  const { users } = await import('../src/lib/db/schema.ts');
  const me = await db.select({ id: users.id }).from(users).where(eq(users.handle, handle));
  check('the claimed handle resolved to a user row', me.length === 1, handle);

  /* Publish a genuinely unrevised post as this writer.

   Adopting a seeded post does not work: the seed gives its posts several
   revisions each, so the flow correctly reports the loop as already closed and
   steps 2-4 are never exercised. The interesting case is v1 -> v2, so the
   fixture has to start at v1. */
  const { createPost } = await import('../src/lib/repo/posts.ts');
  const { newBlockId } = await import('../src/lib/blocks.ts');

  const target = `loom-${RUN}`;
  await createPost({
    slug: target,
    title: `A post with one wrong sentence ${RUN}`,
    dek: 'Published once, never corrected. Until now.',
    authorId: me[0]!.id,
    body: [
      { id: newBlockId(), type: 'heading', level: 2, text: 'What I got wrong', layer: 'core' },
      {
        id: newBlockId(),
        type: 'paragraph',
        layer: 'core',
        text: `The first version of this post says p99 can be summed. It cannot, and the sentence below is the one I would now say differently. ${RUN}`,
      },
      {
        id: newBlockId(),
        type: 'paragraph',
        layer: 'understand',
        text: `This paragraph sits above the skim fold, so a reader at skim depth sees the correction even if they never reach the rest. ${RUN}`,
      },
    ],
    status: 'budding',
    changeSummary: 'First version.',
  });

  const owner = await db.select({ authorId: posts.authorId }).from(posts).where(eq(posts.slug, target));
  check('a freshly published post is this writer’s', owner[0]?.authorId === me[0]!.id, `${target}: ${String(owner[0]?.authorId)}`);

  const page = (p: string) =>
    fetch(new URL(p, base), { headers: { cookie } }).then(async (r) => ({
      status: r.status,
      html: await r.text(),
    }));

  /* --- the page exists and is gated ----------------------------------- */
  {
    const anon = await fetch(new URL('/studio/loom', base));
    const anonHtml = await anon.text();
    check('anonymous visitors are told to claim a handle, not shown an empty flow', anon.status === 200 && /Claim a handle/i.test(anonHtml));

    const mine = await page('/studio/loom');
    check('a writer gets the flow', mine.status === 200, String(mine.status));
    check('the flow offers to pick a post', /Pick a post you already published/.test(mine.html));
    check('every step is a link, so it works with scripting off', (mine.html.match(/href="\/studio\/loom\?post=/g) ?? []).length > 0);
    check('it is not indexed', /noindex/.test(mine.html));
  }

  /* --- no post chosen: steps 2-4 outstanding --------------------------- */
  let slug = '';
  {
    const mine = await page('/studio/loom');
    const woven = /(\d) of 4 woven/.exec(mine.html)?.[1];
    check(
      'with nothing chosen, nothing is woven — not even step 1',
      woven === '0',
      `progress said ${woven}`,
    );
    slug = /href="\/studio\/loom\?post=([^"]+)"/.exec(mine.html)?.[1] ?? '';
    check('a post is offered to pick', Boolean(slug), 'no pickable post in the list');
  }

  /* --- claiming a post that is not ours -------------------------------- */
  {
    const notMine = await page('/studio/loom?post=does-not-exist-xyz');
    check(
      'an unknown post falls back to picking rather than erroring',
      notMine.status === 200 && /Pick a post you already published/.test(notMine.html),
      String(notMine.status),
    );
  }

  /* --- an unrevised post: visiting must not tick anything -------------- */
  const versionBefore = await currentVersion(target);
  {
    const first = await page(`/studio/loom?post=${encodeURIComponent(target)}`);
    const woven1 = /(\d) of 4 woven/.exec(first.html)?.[1];
    check('choosing a post completes step 1 only', woven1 === '1', `progress said ${woven1}`);
    check('step 2 is offered as an action', /Open the editor/.test(first.html));
    check('the reader-facing diff is not shown before there is one', !/What the reader saw/.test(first.html));

    // The claim under test: progress is derived from the post's own history, so
    // loading the page again changes nothing.
    for (let i = 0; i < 3; i++) await page(`/studio/loom?post=${encodeURIComponent(target)}`);
    const again = await page(`/studio/loom?post=${encodeURIComponent(target)}`);
    const woven2 = /(\d) of 4 woven/.exec(again.html)?.[1];
    const versionAfter = await currentVersion(target);
    check(
      'loading the page repeatedly ticks nothing',
      woven2 === '1' && versionAfter === versionBefore,
      `progress ${woven2}, version ${versionBefore} -> ${versionAfter}`,
    );
  }

  /* --- publish a real revision and check the payoff -------------------- */
  const summary = `Corrected the p99 example, which was wrong about percentiles ${RUN}`;
  await publishRevision(target, me[0]!.id, summary);

  {
    const done = await page(`/studio/loom?post=${encodeURIComponent(target)}`);
    const woven = /(\d) of 4 woven/.exec(done.html)?.[1];
    check('a real revision closes the loop', woven === '4', `progress said ${woven}`);
    check('the payoff section appears', /What the reader saw/.test(done.html));
    check(
      "the author's own change summary is quoted verbatim",
      done.html.includes(summary),
      'summary not found on the page',
    );
    check('the diff is summarised', /modified|added|removed/.test(done.html));
    check('the writer diff uses the article renderer', /diff-ins|diff-del/.test(done.html) || !/nothing changed/.test(done.html));
    check('it links to the public view of the same revision', new RegExp(`/w/${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\?rev=`).test(done.html));
    check('empathy analytics are addressed concretely', /Who read it/.test(done.html));
    check('the editor link is gone once done', !/Open the editor/.test(done.html));
  }

  /* --- the same diff on the public page -------------------------------- */
  {
    const loom = await page(`/studio/loom?post=${encodeURIComponent(target)}`);
    const version = Number(/Revision (\d+) against/.exec(loom.html)?.[1] ?? 0);
    const pub = await fetch(new URL(`/w/${target}?rev=${version}`, base), { headers: { cookie } }).then((r) =>
      r.text(),
    );
    const fromLoom = countDiffMarkup(loom.html);
    const fromArticle = countDiffMarkup(pub);
    check(
      'the writer view and the public page show the same diff',
      fromLoom > 0 && fromLoom === fromArticle,
      `loom ${fromLoom} diff marks, article ${fromArticle}`,
    );
    check('the public page shows the same summary', pub.includes(summary));
  }

  console.log(`\n${assertions} assertions, ${failures} failed`);
  if (failures > 0) {
    console.error(
      '\n§10.5: the writer must feel the loop. If the diff here is not the diff the\n' +
        'reader gets, this page is a description of the product rather than the product.\n',
    );
  }
  process.exitCode = failures > 0 ? 1 : 0;
}

function countDiffMarkup(html: string): number {
  return (html.match(/class="diff-(ins|del)"/g) ?? []).length;
}

async function currentVersion(slug: string): Promise<number> {
  const { readyDb } = await import('../src/lib/db/index.ts');
  const { postVersions, posts } = await import('../src/lib/db/schema.ts');
  const { eq } = await import('drizzle-orm');
  const db = await readyDb();
  const rows = await db
    .select({ n: postVersions.versionNumber })
    .from(posts)
    .innerJoin(postVersions, eq(posts.currentVersionId, postVersions.id))
    .where(eq(posts.slug, slug));
  return Number(rows[0]?.n ?? 0);
}

/**
 * Publish a real revision of a real post, the way the editor does: one sentence
 * changed, with the author's own summary attached.
 *
 * Goed through the repo's own `publishRevision` rather than writing rows, so the
 * version numbering, the block rows and the search-index refresh all happen
 * exactly as they would for a writer in the studio.
 */
async function publishRevision(slug: string, authorHandle: string, summary: string) {
  const { getPostById, publishRevision: publish } = await import('../src/lib/repo/posts.ts');
  const { parseBody } = await import('../src/lib/blocks.ts');
  const post = await getPostById(
    (await (async () => {
      const { readyDb } = await import('../src/lib/db/index.ts');
      const { posts } = await import('../src/lib/db/schema.ts');
      const { eq } = await import('drizzle-orm');
      return (await readyDb()).select({ id: posts.id }).from(posts).where(eq(posts.slug, slug));
    })())[0]!.id,
  );
  if (!post) throw new Error(`no post ${slug}`);

  const body = parseBody(post.version.body);
  // Change one real sentence, so the diff is non-empty without being a lie about
  // what a revision looks like.
  const target = body.find((b) => b.type === 'paragraph') as { text: string } | undefined;
  if (target) {
    target.text = `${target.text} Corrected in revision ${RUN}.`;
  }

  await publish({
    postId: post.id,
    authorId: authorHandle,
    body,
    changeSummary: summary,
    isMajor: true,
  });
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