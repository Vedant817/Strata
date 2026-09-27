/**
 * Reader preferences. Stored in a signed-free, plain cookie for now — the point
 * is that a reader's depth/density/theme follows them across every post without
 * an account, which is the whole premise of the reading experience.
 */

export const THEME_COOKIE = 'strata_theme';
export const DENSITY_COOKIE = 'strata_density';
export const DEPTH_COOKIE = 'strata_depth';
export const ANON_COOKIE = 'strata_anon';

export type Theme = 'paper' | 'ink';
export type Density = 'comfortable' | 'compact' | 'roomy';
export type Depth = 'skim' | 'understand' | 'master';

export const THEMES: readonly Theme[] = ['paper', 'ink'];
export const DENSITIES: readonly Density[] = ['comfortable', 'compact', 'roomy'];
export const DEPTHS: readonly Depth[] = ['skim', 'understand', 'master'];

export const DEPTH_LABEL: Record<Depth, string> = {
  skim: 'Skim',
  understand: 'Read',
  master: 'Study',
};

export const DEPTH_HINT: Record<Depth, string> = {
  skim: 'The argument only. About 90 seconds.',
  understand: 'The full argument, with prerequisites explained inline.',
  master: 'Everything. Footnotes, citations, private author notes, appendices.',
};

function pick<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

export function readCookie(
  cookies: Record<string, string | undefined>,
  name: string,
): string | undefined {
  return cookies[name];
}

export interface ReaderPrefs {
  theme: Theme;
  density: Density;
  depth: Depth;
  anonId: string;
}

export function resolvePrefs(
  cookies: Record<string, string | undefined>,
  anonId: string,
): ReaderPrefs {
  return {
    theme: pick(readCookie(cookies, THEME_COOKIE), THEMES, 'paper'),
    density: pick(readCookie(cookies, DENSITY_COOKIE), DENSITIES, 'comfortable'),
    depth: pick(readCookie(cookies, DEPTH_COOKIE), DEPTHS, 'understand'),
    anonId,
  };
}

type CookieJar = {
  get(name: string): { value?: string } | undefined;
  has(name: string): boolean;
  set(name: string, value: string, options: Record<string, unknown>): void;
};

/**
 * The one id for this browser, minted at most once per request.
 *
 * Pages used to fall back to a fresh `crypto.randomUUID()` whenever no cookie
 * arrived — and the layout minted a *different* one for the outgoing cookie.
 * Every first-visit write (read receipts, first notes) was then recorded
 * under an id the browser would never send again: orphaned on arrival. The
 * "changed since you read it" banner never fired for a first read, and reader
 * memory missed every reader's first post.
 *
 * Page frontmatter runs before the layout, so the first caller mints and
 * sets, and later callers see `has()` and must NOT mint again. A caller that
 * arrives after the mint cannot retrieve the minted value (Astro exposes
 * outgoing cookies through `has`, not `get`), so it gets a throwaway marked
 * as such — safe for reads, and anything that writes must be the minter.
 */
export function ensureAnonId(cookies: CookieJar): string {
  const incoming = cookies.get(ANON_COOKIE)?.value;
  if (incoming) return incoming;
  if (cookies.has(ANON_COOKIE)) return `transient-${crypto.randomUUID()}`;
  const id = crypto.randomUUID();
  cookies.set(ANON_COOKIE, id, {
    path: '/',
    httpOnly: false,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
  });
  return id;
}
