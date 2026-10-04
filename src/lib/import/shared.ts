/**
 * Shared import constants.
 *
 * Its own module because both `parse.ts` and `html.ts` need the limits, and
 * `parse.ts` imports `html.ts`. A constant that both sides read cannot live in
 * either of them without a cycle.
 */

/** Hard ceilings, applied before parsing, not after. */
export const IMPORT_LIMITS = {
  maxPosts: 200,
  maxBytesPerPost: 512 * 1024,
  maxBlocksPerPost: 400,
} as const;