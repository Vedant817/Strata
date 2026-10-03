/**
 * Response compression for the standalone Node server.
 *
 * PLAN.md §2.5 sets LCP < 1.5s on 4G. Measured against the built server with
 * Lighthouse (scripts/field-metrics.mjs), the article came out at 2873ms with an
 * 830ms server response — because an article was 138KB of HTML sent uncompressed,
 * which on a 1.6Mbps link is most of a second of transfer before the first word
 * is on screen.
 *
 * The middleware was already appending `Vary: Accept-Encoding`, so the promise
 * was being made and not kept. It was invisible in production because Vercel's
 * edge compresses anything that reaches it, and visible everywhere else: CI's
 * smoke suite, `npm run preview`, and any self-hosted deploy.
 *
 * Skipped deliberately:
 *
 *   - **On Vercel.** The edge has already compressed. Doing it again spends CPU
 *     to save nothing.
 *   - **Already-encoded responses.** PNG cards and any future pre-compressed
 *     asset; gzipping a PNG is a way to make it bigger.
 *   - **Tiny bodies.** Below a kilobyte the framing cost dominates.
 *   - **Non-text.** Images, audio, anything already a compressed format.
 *
 * Brotli where the client offers it, gzip otherwise: brotli is ~15% smaller on
 * HTML and both are one line with `node:zlib`. Quality is the library default
 * rather than the maximum — this runs on every article request, and the
 * difference between q6 and q11 is not worth the CPU on a page that is mostly
 * prose.
 */

import { brotliCompress, gzip, constants } from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(gzip);
const brotliAsync = promisify(brotliCompress);

/** Under this, compression framing costs more than it saves. */
const MIN_BYTES = 1024;

const COMPRESSIBLE = /^(text\/|application\/(json|ld\+json|xml|javascript|manifest\+json)|image\/svg\+xml)/i;

/** Formats that are already compressed; a second pass only makes them bigger. */
const PRECOMPRESSED = /^(image\/(?!svg)|video\/|audio\/|application\/(zip|gzip|br|woff2?))/i;

/** Chosen quality: see the note above. */
const BROTLI_QUALITY = 5;
const GZIP_LEVEL = 6;

function wantsBrotli(accept: string | null): boolean {
  if (!accept) return false;
  // Only take br when it is explicitly acceptable. `*` alone is not consent to
  // spend extra CPU on the client.
  return /(^|,)\s*br\s*(;|,|$)/i.test(accept) || /\bbr\b/i.test(accept);
}

function wantsGzip(accept: string | null): boolean {
  if (!accept) return false;
  return /\bgzip\b/i.test(accept) || /\bdeflate\b/i.test(accept);
}

export async function compressResponse(
  response: Response,
  acceptEncoding: string | null,
): Promise<Response> {
  // The platform already did it, or the route returned something immutable.
  if (process.env.VERCEL === '1') return response;
  if (response.headers.has('content-encoding')) return response;

  const type = response.headers.get('content-type') ?? '';
  if (!COMPRESSIBLE.test(type) || PRECOMPRESSED.test(type)) return response;

  const lengthHeader = Number(response.headers.get('content-length') ?? '0');
  if (lengthHeader > 0 && lengthHeader < MIN_BYTES) return response;

  const body = await response.arrayBuffer();
  if (body.byteLength < MIN_BYTES) return response;

  const raw = Buffer.from(body);
  const useBrotli = wantsBrotli(acceptEncoding);
  if (!useBrotli && !wantsGzip(acceptEncoding)) return response;

  const compressed = useBrotli
    ? await brotliAsync(raw, {
        params: { [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY },
      })
    : await gzipAsync(raw, { level: GZIP_LEVEL });

  // If it did not get smaller, send the original. Compressing already-small or
  // incompressible payloads and shipping a larger body is a self-inflicted
  // regression.
if (compressed.length >= raw.length) return response;

  const headers = new Headers(response.headers);
  headers.set('content-encoding', useBrotli ? 'br' : 'gzip');
  headers.set('content-length', String(compressed.length));
  headers.set('vary', mergeVary(headers.get('vary'), 'Accept-Encoding'));

  // 204/304 must not carry a body, and Content-Length would be a lie on them.
  if (response.status === 204 || response.status === 304) {
    headers.delete('content-length');
    return new Response(null, { status: response.status, headers });
  }

  return new Response(compressed, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Append a token without duplicating one the route already set. */
function mergeVary(existing: string | null, token: string): string {
  const present = (existing ?? '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  if (present.includes(token.toLowerCase())) return present.join(', ');
  return present.length > 0 ? `${present.join(', ')}, ${token}` : token;
}