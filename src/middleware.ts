/**
 * Cache headers for public reads.
 *
 * Phase 1 of the plan asks for "edge-cached, `stale-while-revalidate` for public
 * reads", and this is where that has to be decided, because the answer is not
 * "everything".
 *
 * **An article page cannot be cached, and pretending otherwise is a privacy
 * bug.** Its HTML depends on the reader's cookies: their depth setting, their own
 * highlights re-rendered onto the text, their presence, their handle, their notes
 * margin. Cache that at the edge under one URL and the first reader's highlights,
 * depth and handle get served to the next person who arrives. Adding
 * `Vary: Cookie` would be technically correct and practically useless — it
 * fragments the cache into one entry per cookie, which is the same as not
 * caching.
 *
 * So the rule is narrow and deliberate: cache the pages that are byte-identical
 * for every visitor, because those are the ones a crawler, a link preview and a
 * reader's first request all hit. Those are the landing pages, the feeds and the
 * share cards — which is also where the traffic actually concentrates.
 *
 * Anything personalised is marked `private, no-store` rather than left to a
 * default, so a future route that forgets to opt in fails closed rather than
 * leaking.
 */

import { defineMiddleware } from 'astro:middleware';
import { SESSION_COOKIE } from './lib/repo/auth';
import { touchSession } from './lib/repo/device-sessions';
import { compressResponse } from './lib/compress';

/** Routes whose HTML is identical for every visitor. */
const PUBLIC_EXACT = new Set([
  '/',
  '/writing',
  '/topics',
  '/constellations',
  '/about',
  '/privacy',
  '/thesis',
  '/robots.txt',
  '/rss.xml',
  '/sitemap-index.xml',
  '/sitemap-0.xml',
]);

const PUBLIC_PREFIX = ['/a/', '/og/', '/l/'];

/** Robots and sitemap change on a scale of days, so they can sit a long time. */
const LONG: [number, number] = [60 * 60 * 24, 60 * 60 * 24 * 7];
/** Landing pages move when a writer publishes, which is measured in hours. */
const MEDIUM: [number, number] = [600, 60 * 60 * 24];
/** Share cards are immutable per slug and pure image bytes. */
const IMMUTABLE: [number, number] = [60 * 60 * 24 * 30, 60 * 60 * 24 * 365];

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIX.some((p) => pathname.startsWith(p));
}

export const onRequest = defineMiddleware(async (context, next) => {
  /* Record which device a session belongs to. Here rather than in
     `getIdentity` because that function only ever sees cookies — the
     user-agent lives on the request. Throttled to once per session per ten
     minutes, so it is not a write on every page view. */
  const token = context.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    await touchSession(token, context.request.headers.get('user-agent')).catch(() => {
      // Never let bookkeeping fail a request. A missing device label is a
      // cosmetic problem; a 500 on someone's article is a real one.
    });
  }

  const response = await next();
  const { pathname } = context.url;

  // Never cache an error into an edge: a 500 that sticks for an hour is a
  // self-inflicted outage.
  if (response.status >= 400) return response;

  // Anything already decided by the route wins. A page that sets its own
  // headers knows something this table does not.
  if (response.headers.has('cache-control')) return response;

  const header = isPublic(pathname)
    ? `${headerFor(pathname)}`
    : 'private, no-store';

  /* Not every Response has mutable headers.

     `Response.redirect()` — which every redirect route here returns, including
     the ones that matter most, like redeeming a handle claim — hands back
     headers with the guard flag set. Calling `.set()` on them throws
     `TypeError: immutable`, and because this is middleware that throw becomes a
     500 on the redirect itself: the author claims a handle, the confirmation
     link 500s, and nothing says why.

     The fix is to rebuild *only* in that case. The first version of this rebuilt
     unconditionally, which is the obvious way to write it and quietly broke
     every endpoint route: `/robots.txt`, `/rss.xml` and `/digest.xml` all began
     ending their responses prematurely, because the node adapter had already
     taken a reference to the original body stream and a wrapper Response with
     the same stream no longer lined up with it. The HTML pages happened to
     survive, which is why it looked like an XML problem rather than a middleware
     problem. Mutation is attempted in place first, and only an immutable
     response pays for a copy. */
  let outbound = response;
  try {
    response.headers.set('cache-control', header);
    response.headers.append('vary', 'Accept-Encoding');
  } catch {
    const headers = new Headers(response.headers);
    headers.set('cache-control', header);
    headers.append('vary', 'Accept-Encoding');

    // These statuses must not carry a body, and constructing one with a body throws.
    const bodyless =
      response.status === 204 || response.status === 205 || response.status === 304;
    outbound = bodyless
      ? new Response(null, { status: response.status, statusText: response.statusText, headers })
      : new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
  }

  /* Compress, or do not claim to. `Vary: Accept-Encoding` above is a promise
     that the bytes change with the encoding, and on the standalone Node server
     nothing was keeping it: an article went out at 138KB. On a 1.6Mbps link
     that is roughly 700ms before the first word, which is the whole LCP budget
     spent on transfer.

     Vercel's edge compresses before this sees the response, and compressing
     there too would spend CPU to save nothing, so it is skipped when the
     platform is already doing it. */
  return compressResponse(outbound, context.request.headers.get('accept-encoding'));
});

function headerFor(pathname: string): string {
  const [sMaxAge, stale] = pathname.startsWith('/og/')
    ? IMMUTABLE
    : pathname.startsWith('/a/')
      ? MEDIUM
      : pathname === '/robots.txt' || pathname.startsWith('/sitemap')
        ? LONG
        : MEDIUM;
  return `public, max-age=0, s-maxage=${sMaxAge}, stale-while-revalidate=${stale}`;
}