/**
 * Server-side feature flags.
 *
 * Deliberately not a general system. Two properties matter more than breadth:
 *
 * 1. **Default off.** A flag that is on unless someone remembers to turn it off
 *    is not a flag. Every flag here resolves to `false` when its variable is
 *    unset, empty, or anything but an explicit `1`.
 * 2. **No reader-reachable override.** These are server-side only, read at
 *    render time. There is no query parameter or cookie that turns a flag on,
 *    because a flag that a reader can flip is not a security control.
 *
 * Each flag names the document that has to exist before it may be enabled.
 */

function enabled(name: string): boolean {
  const raw = process.env[name];
  // Explicit opt-in only. '0', 'false', 'off', '' and 'yes' are all refused, so
  // a plausible-looking typo fails closed rather than shipping a surface.
  return raw === '1';
}

/**
 * PLAN.md §4.4 v1.1 — "Run this against my inputs".
 *
 * Off unless `STRATA_RUNNABLE_CODE=1`. Still requires the author to mark an
 * individual block `runnable: true`, so the flag enables the *capability*
 * without making every snippet on the site runnable.
 *
 * Gate: `docs/threat-model-sandbox.md`.
 */
export const RUNNABLE_CODE = enabled('STRATA_RUNNABLE_CODE');

/** The flags, for diagnostics. Values are booleans; nothing here is secret. */
export const flags = {
  runnableCode: RUNNABLE_CODE,
} as const;