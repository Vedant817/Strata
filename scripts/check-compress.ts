/**
 * Response compression, asserted.
 *
 * The failure this guards against is invisible to every other check in this
 * repo: an uncompressed response is still a 200, still has every byte, and
 * still renders correctly. It just costs a reader on a slow link roughly 110KB
 * more than it needs to — which is most of a second of transfer on the profile
 * PLAN.md §2.5 is written against, and was most of a 2873ms LCP before this
 * existed.
 *
 * Runs against `compressResponse` directly rather than over HTTP, so each
 * assertion names one decision: which encodings are honoured, which content is
 * left alone, and which promises the middleware makes are actually kept.
 */

import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { compressResponse } from '../src/lib/compress.ts';

let failures = 0;
let assertions = 0;

function check(condition: boolean, label: string, detail = '') {
  assertions++;
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}${detail ? `\n          ${detail}` : ''}`);
  }
}

function body(text: string, headers: Record<string, string> = {}) {
  return new Response(text, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
  });
}

/** Decompress so the assertion is about the bytes, not about the header. */
async function decode(res: Response): Promise<string> {
  const encoding = res.headers.get('content-encoding');
  const buf = Buffer.from(await res.arrayBuffer());
  if (encoding === 'gzip') return gunzipSync(buf).toString('utf8');
  if (encoding === 'br') return brotliDecompressSync(buf).toString('utf8');
  return buf.toString('utf8');
}

/* Enough prose that compressing it is a clear win rather than a rounding
   difference, which keeps the "did not get smaller" branch out of the way. */
const LONG = 'Cache invalidation is a distributed systems problem. '.repeat(120);

async function run() {
  console.log('\ncompression\n');

  /* --- the article, which is the case that mattered ------------------- */
  {
    const res = await compressResponse(body(LONG), 'gzip, deflate, br');
    check(res.headers.get('content-encoding') === 'br', 'brotli is preferred when offered');
    check(
      (res.headers.get('content-length') ?? '') !== '' &&
        Number(res.headers.get('content-length')) < LONG.length,
      `br encoded body is smaller than the original (${res.headers.get('content-length')} < ${LONG.length})`,
    );
    check((await decode(res)) === LONG, 'br round-trips to the original bytes');
    check(
      (res.headers.get('vary') ?? '').toLowerCase().includes('accept-encoding'),
      'Vary: Accept-Encoding is set, so a cache cannot mix encodings',
    );
  }

  {
    const res = await compressResponse(body(LONG), 'gzip');
    check(res.headers.get('content-encoding') === 'gzip', 'gzip is used when brotli is not offered');
    check((await decode(res)) === LONG, 'gzip round-trips to the original bytes');
  }

  /* --- when not to compress ------------------------------------------ */
  {
    const res = await compressResponse(body(LONG), null);
    check(res.headers.get('content-encoding') === null, 'no Accept-Encoding means no compression');
  }
  {
    const res = await compressResponse(body(LONG), 'identity');
    check(res.headers.get('content-encoding') === null, 'Accept-Encoding: identity is left alone');
  }
  {
    const res = await compressResponse(body('small', { 'content-encoding': 'gzip' }), 'gzip');
    check(res.headers.get('content-encoding') === 'gzip', 'an already-encoded response is not re-encoded');
  }
  {
    const png = new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), {
      headers: { 'content-type': 'image/png' },
    });
    const res = await compressResponse(png, 'br, gzip');
    check(res.headers.get('content-encoding') === null, 'PNG is not compressed');
  }
  {
    const woff = new Response(Buffer.alloc(4096, 7), { headers: { 'content-type': 'font/woff2' } });
    const res = await compressResponse(woff, 'br, gzip');
    check(res.headers.get('content-encoding') === null, 'woff2 is not compressed');
  }
  {
    const res = await compressResponse(body('x'), 'gzip, br');
    check(res.headers.get('content-encoding') === null, 'a body under 1KB is left alone');
  }
  {
    // Genuinely incompressible. Compressing this would ship a *larger* body,
    // which is a self-inflicted regression that still returns a valid response.
    const noise = randomBytes(4096);
    const res = await compressResponse(
      new Response(noise, { headers: { 'content-type': 'text/html' } }),
      'br, gzip',
    );
    check(
      res.headers.get('content-encoding') === null,
      'an incompressible body is sent as-is rather than grown',
    );
  }

  {
    // The bug this file exists for. Reading the body consumes it, so any branch
    // that decides *not* to compress after that point has to hand back the bytes
    // it read rather than the drained Response. Returning the original truncated
    // every response under a kilobyte: /robots.txt, /rss.xml and /digest.xml all
    // ended their connections early, while article pages were fine because they
    // are large enough to be compressed. It reads as "the XML routes are broken"
    // and is actually "small responses are dropped".
    const tiny = 'User-agent: *\nAllow: /\n';
    const res = await compressResponse(body(tiny), 'gzip, br');
    // Read once: a Response body can only be consumed once, so a second read in
    // the failure detail would throw rather than explain.
    const gotTiny = await decode(res);
    check(gotTiny === tiny, 'a body under 1KB arrives complete', JSON.stringify(gotTiny));
    check(res.headers.get('content-encoding') === null, 'a body under 1KB is not marked encoded');
  }
  {
    // Same class of failure on the other branch: incompressible, so not encoded,
    // but the body was still read to find that out.
    const noise = randomBytes(4096);
    const res = await compressResponse(
      new Response(noise, { headers: { 'content-type': 'text/html' } }),
      'br, gzip',
    );
    const got = Buffer.from(await res.arrayBuffer());
    check(
      Buffer.compare(got, noise) === 0,
      'an incompressible body arrives byte-for-byte',
      `${got.byteLength} of ${noise.length} bytes`,
    );
  }
  {
    // And a compressed one, which is the path everyone assumed was the only one.
    const res = await compressResponse(body(LONG), 'br');
    check((await decode(res)) === LONG, 'a compressed body round-trips');
    check(
      Number(res.headers.get('content-length')) > 0,
      'a compressed body advertises its length honestly',
    );
  }

  /* --- the promises the middleware makes ------------------------------ */
  {
    const res = await compressResponse(body(LONG, { vary: 'Cookie' }), 'gzip');
    const vary = (res.headers.get('vary') ?? '').toLowerCase();
    check(vary.includes('cookie'), 'an existing Vary: Cookie survives compression');
    check(vary.includes('accept-encoding'), 'Accept-Encoding is added alongside it, not instead');
  }
  {
    const res = await compressResponse(body(LONG), 'gzip');
    const vary = res.headers.get('vary') ?? '';
    check(
      vary.toLowerCase().split(',').filter((v) => v.trim() === 'accept-encoding').length === 1,
      'Accept-Encoding appears in Vary exactly once',
    );
  }
  {
    const res = await compressResponse(body(LONG), 'gzip, deflate, br');
    check(res.status === 200, 'status is preserved through compression');
    check(
      (res.headers.get('content-type') ?? '').includes('text/html'),
      'content-type is preserved, so the browser still parses the response',
    );
  }

  /* --- 204 and 304 must not grow a body ------------------------------- */
  for (const status of [204, 304]) {
    const empty = new Response(null, { status, headers: { 'content-type': 'text/html' } });
    const res = await compressResponse(empty, 'gzip');
    check(res.status === status, `${status} keeps its status`);
    check(res.headers.get('content-length') === null, `${status} carries no Content-Length`);
    check(res.body === null, `${status} carries no body`);
  }

  /* --- the platform already compresses -------------------------------- */
  {
    const previous = process.env.VERCEL;
    process.env.VERCEL = '1';
    const res = await compressResponse(body(LONG), 'br, gzip');
    check(res.headers.get('content-encoding') === null, 'on Vercel the edge already compressed, so we do not');
    if (previous === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previous;
  }

  console.log(`\n${assertions} assertions, ${failures} failed`);
  if (failures > 0) {
    console.error(
      '\nAn uncompressed article is still a correct 200, so nothing else in CI\n' +
        'will notice. This check is the only thing standing between the reader and\n' +
        'a second of wasted transfer on a slow connection.\n',
    );
  }
  process.exitCode = failures > 0 ? 1 : 0;
}

await run();