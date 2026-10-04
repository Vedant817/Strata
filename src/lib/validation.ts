/**
 * Turn a validator's complaint into something a person can act on.
 *
 * Zod's messages are written for the developer who wrote the schema:
 *
 *   "Invalid input: expected string, received undefined"
 *   "Too big: expected string to have <=4000 characters"
 *
 * Putting those in front of a reader — or a writer, in the studio — tells them
 * nothing they can do anything about, and it leaks the shape of the schema to
 * anyone who posts one bad field. Five endpoints were doing it, all with the same
 * two-line fallback that only fired when the message was *absent*, which is to say
 * essentially never.
 *
 * So this is the one place that decides what a rejected form says. Where the limit
 * is known it is quoted, because "keep it under 4,000 characters" is actionable
 * and "too big" is not. Everything unrecognised falls back to one plain sentence
 * rather than passing the validator's text through — an issue code this file has
 * never heard of is not a reason to show the reader the schema.
 *
 * Typed structurally rather than with Zod's issue type, which is deprecated and
 * has been renamed twice. Only the four fields actually used are declared, so a
 * Zod upgrade cannot silently change what this reads.
 */
interface IssueLike {
  code: string;
  /** `readonly unknown[]` because Zod types a path as `PropertyKey[]`, symbol
   *  included; this only ever reads the string entries. */
  path?: readonly unknown[];
  /** Present on `too_big` / `too_small`, where Zod reports the bound it was given. */
  maximum?: unknown;
  minimum?: unknown;
  /** Every Zod issue carries one. Declared so callers can pass a real issue —
   *  and deliberately never read, because reading it is the bug this file exists
   *  to fix. The test asserts exactly that: an unrecognised issue whose message
   *  says "expected string" must still produce a human sentence. */
  message?: unknown;
}

interface ErrorLike {
  issues: readonly IssueLike[];
}

/** Zod reports an over-long string with the bound it was given. */
function boundOf(issue: IssueLike): number | null {
  return typeof issue.maximum === 'number'
    ? issue.maximum
    : typeof issue.minimum === 'number'
      ? issue.minimum
      : null;
}

function fieldName(issue: IssueLike): string {
  const last = (issue.path ?? [])
    .filter((p): p is string => typeof p === 'string')
    .pop();
  if (typeof last !== 'string') return '';
  // `email` and `postId` both read as words mid-sentence.
  return last.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

export function humanIssue(issue: IssueLike | undefined): string {
  if (!issue) return 'That did not look right.';

  switch (issue.code) {
    case 'too_big': {
      const max = boundOf(issue);
      if (typeof max === 'number') {
        return `That is too long. Keep it under ${max.toLocaleString('en-US')} characters.`;
      }
      return 'That is too long.';
    }
    case 'too_small':
      return boundOf(issue) === 1 ? 'That needs at least one character.' : 'That is too short.';
    case 'invalid_type':
      return 'Something was missing from that form.';
    // Zod v4 renamed `invalid_enum_value` to `invalid_value`.
    case 'invalid_value':
      return 'That was not one of the options.';
    case 'unrecognized_keys':
      return 'That form included something this does not accept.';
    case 'invalid_format': {
      const field = fieldName(issue);
      if (/mail/.test(field)) return 'That does not look like an email address.';
      if (/url|link/.test(field)) return 'That does not look like a link.';
      return 'That does not look right.';
    }
    default:
      return 'That did not look right.';
  }
}

export function humanIssues(error: ErrorLike): string {
  return humanIssue(error.issues[0]);
}