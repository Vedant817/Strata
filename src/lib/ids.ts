import { customAlphabet } from 'nanoid';

const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Short, URL-safe, and sortable-ish enough for our purposes. Prefixed by entity
 *  type so an id in a log line is self-describing. */
const raw = customAlphabet(alphabet, 14);

export function nanoid(): string {
  return raw();
}

export function prefixedId(prefix: string): string {
  return `${prefix}_${raw()}`;
}

export function isId(value: string, prefix?: string): boolean {
  return prefix ? value.startsWith(`${prefix}_`) : /^[a-z0-9]{14}$/.test(value);
}
