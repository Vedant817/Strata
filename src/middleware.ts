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

  response.headers.set('cache-control', header);
  response.headers.append('vary', 'Accept-Encoding');
  return response;
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