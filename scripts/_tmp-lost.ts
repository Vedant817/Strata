/**
 * Does a reader keep their words when a form refuses the post?
 *
 * The core interaction on this site is leaving a note in the margin, and it is a
 * plain form post so it works with scripting off (§1.3). That has a cost nobody
 * tends to look at: a refused post redirects back to the article, and the textarea
 * that held the reader's sentence starts empty again. Someone who spent three
 * minutes on a considered note loses all of it because it was 4,001 characters.
 *
 * This drives the real endpoints and reports what the reader would actually see.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const PORT = process.env.P ?? '4720';
const HOST = '127.0.0.1';
const base = `http://${HOST}:${PORT}`;
const RUN = Date.now().toString(36).slice(-5);
const TEST_DB = path.join(os.tmpdir(), `strata-lost-${RUN}.db`);
process.env.DATABASE_URL = `file:${TEST_DB}`;

const server = spawn(process.execPath, [path.join(ROOT, 'dist', 'server', 'entry.mjs')], {
  cwd: ROOT, env: { ...process.env, PORT, HOST },
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
let boot = '';
server.stdout.on('data', (d) => (boot += d));
server.stderr.on('data', (d) => (boot += d));

async function up() {
  const until = Date.now() + 60_000;
  while (Date.now() < until) {
    try { if ((await fetch(base, { redirect: 'manual' })).status > 0) return true; } catch { /* */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}
function seed() {
  return new Promise<void>((res, rej) => {
    const p = spawn(process.execPath,
      [path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(ROOT, 'scripts', 'seed.ts')],
      { cwd: ROOT, env: { ...process.env }, stdio: 'ignore', windowsHide: true });
    p.on('exit', (c) => (c === 0 ? res() : rej(new Error(`seed ${c}`))));
    p.on('error', rej);
  });
}

const out: string[] = [];
const say = (s: string) => out.push(s);
const SLUG = 'cache-invalidation-is-a-distributed-problem';
const anon = `lost-${RUN}`;
const cookie = `strata_anon=${anon}`;

function text(s: string): string {
  return s.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, '').replace(/<[^>]+>/g, '\n')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ').split('\n').map((x) => x.trim()).filter(Boolean).join('\n');
}

try {
  if (!(await up())) say('server never came up:\n' + boot.slice(0, 600));
  else {
    await seed();

    const form = (p: string, fields: Record<string, string>) =>
      fetch(new URL(p, base), {
        method: 'POST', redirect: 'manual',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie, origin: base, referer: `${base}/w/${SLUG}`,
        },
        body: new URLSearchParams(fields).toString(),
      });

    const art = await (await fetch(`${base}/w/${SLUG}`, { headers: { cookie } })).text();
    const parentId = /name="parentId" value="([^"]+)"/.exec(art)?.[1] ?? '';
    const noteId = /name="noteId" value="([^"]+)"/.exec(art)?.[1] ?? '';
    const versionId = /(?:const|let|var)\s+versionId\s*=\s*["']([^"']+)["']/.exec(art)?.[1] ?? '';
    const postId = /(?:const|let|var)\s+postId\s*=\s*["']([^"']+)["']/.exec(art)?.[1] ?? '';
    const blockId = /data-block-id="([^"]+)"/.exec(art)?.[1] ?? '';

    /* The maxlength the form itself advertises. */
    const maxlength = /name="body"[\s\S]{0,200}?maxlength="(\d+)"/.exec(art)?.[1]
      ?? /maxlength="(\d+)"[\s\S]{0,200}?name="body"/.exec(art)?.[1] ?? '?';
    say(`the reply textarea advertises maxlength=${maxlength}`);

    const CAREFUL = `A note I spent three minutes on. ${'Detail that matters. '.repeat(30)}`;

    /* ---- 1. a reply that is over the limit ---- */
    say('');
    say('--- a reply the form would have let you start, posted over the limit ---');
    const tooLong = 'x'.repeat(Number(maxlength) + 500 || 5000);
    const res1 = await form('/api/notes', { action: 'reply', parentId, returnTo: `/w/${SLUG}`, body: tooLong });
    const loc1 = res1.headers.get('location') ?? '';
    say(`  POST -> ${res1.status} ${loc1}`);
    const after1 = await (await fetch(new URL(loc1 || `/w/${SLUG}`, base), { headers: { cookie } })).text();
    say(`  error shown to the reader? ${/noteError|too (long|many)|under \d+ characters|4000/i.test(text(after1))}`);
    say(`  is their text still in the form? ${after1.includes(tooLong.slice(0, 200))}`);
    const ta = /<textarea[^>]*name="body"[^>]*>([\s\S]*?)<\/textarea>/.exec(after1)?.[1] ?? '';
    say(`  textarea contents length after refusal: ${ta.trim().length}`);

    /* ---- 2. an empty reply ---- */
    say('');
    say('--- an empty reply ---');
    const res2 = await form('/api/notes', { action: 'reply', parentId, returnTo: `/w/${SLUG}`, body: '' });
    const loc2 = res2.headers.get('location') ?? '';
    say(`  POST -> ${res2.status} ${loc2}`);
    const after2 = await (await fetch(new URL(loc2 || `/w/${SLUG}`, base), { headers: { cookie } })).text();
    say(`  error shown? ${/say something|empty|required/i.test(text(after2))}`);

    /* ---- 3. a reply to a note that no longer exists ---- */
    say('');
    say('--- a reply whose parent has been deleted ---');
    const res3 = await form('/api/notes', { action: 'reply', parentId: 'no-such-note-id', returnTo: `/w/${SLUG}`, body: 'orphaned reply' });
    const loc3 = res3.headers.get('location') ?? '';
    say(`  POST -> ${res3.status} ${loc3}`);
    const after3 = await (await fetch(new URL(loc3 || `/w/${SLUG}`, base), { headers: { cookie } })).text();
    say(`  error shown? ${/gone|no longer|not found/i.test(text(after3))}`);
    say(`  and the reader's text preserved? ${after3.includes('orphaned reply')}`);

    /* ---- 4. a margin note whose anchor no longer resolves ---- */
    say('');
    say('--- a margin note against a sentence that has since changed ---');
    if (blockId && versionId && postId) {
      const res4 = await fetch(new URL('/api/annotations', base), {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, origin: base, referer: `${base}/w/${SLUG}` },
        body: JSON.stringify({
          postId, versionId, blockId,
          quote: 'a sentence that was edited out of the post long ago',
          body: CAREFUL,
        }),
      });
      const j4 = await res4.json().catch(() => ({}));
      say(`  POST -> ${res4.status} ${JSON.stringify(j4).slice(0, 160)}`);
    }

    /* ---- 5. does a successful post confirm itself? ---- */
    say('');
    say('--- a reply that succeeds ---');
    const res5 = await form('/api/notes', { action: 'reply', parentId, returnTo: `/w/${SLUG}`, body: CAREFUL });
    const after5 = await (await fetch(new URL(res5.headers.get('location') || `/w/${SLUG}`, base), { headers: { cookie } })).text();
    say(`  their reply is on the page? ${after5.includes('Detail that matters')}`);
    const t5 = text(after5);
    say(`  is there any confirmation of the new reply? ${/\bsent\b|\bposted\b|\bsaved\b|thank you|added/i.test(t5.slice(0, 900))}`);

    /* ---- 6. what a *reader* sees when the whole thing 500s is someone else's problem,
           but a missing field is ours ---- */
    say('');
    say('--- a post with a field missing entirely ---');
    const res6 = await form('/api/notes', { action: 'reply', returnTo: `/w/${SLUG}` });
    say(`  POST -> ${res6.status} ${res6.headers.get('location') ?? ''}`);
  }
} catch (err) {
  say(`THREW: ${(err as Error).stack?.slice(0, 900)}`);
} finally {
  server.kill();
  for (const s of ['', '-wal', '-shm']) { try { fs.rmSync(TEST_DB + s, { force: true, maxRetries: 3 }); } catch { /* temp */ } }
  fs.writeFileSync(path.join(process.env.TEMP!, 'lost.txt'), out.join('\n'));
}