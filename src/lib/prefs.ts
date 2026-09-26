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
