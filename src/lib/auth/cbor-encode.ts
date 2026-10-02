/**
 * Minimal CBOR writer, the exact inverse of the reader in `cbor.ts`.
 *
 * It exists for one reason: a stored COSE key must round-trip byte-for-byte.
 * Re-encoding a parsed key through a generic JSON serialiser would reorder map
 * entries and change integers, producing a different key on every save and
 * breaking verification for every passkey already enrolled.
 */

type Writable =
  | number
  | string
  | boolean
  | null
  | Uint8Array
  | Writable[]
  | Map<number | string, Writable>;

function head(major: number, arg: number): number[] {
  if (arg < 0) throw new Error('use a negative-integer wrapper for negatives');
  if (arg < 24) return [(major << 5) | arg];
  if (arg < 0x100) return [(major << 5) | 24, arg];
  if (arg < 0x10000) return [(major << 5) | 25, (arg >> 8) & 0xff, arg & 0xff];
  if (arg <= 0xffffffff) {
    return [
      (major << 5) | 26,
      (arg >>> 24) & 0xff,
      (arg >>> 16) & 0xff,
      (arg >>> 8) & 0xff,
      arg & 0xff,
    ];
  }
  throw new Error('integer out of CBOR range');
}

/**
 * WebAuthn encodes negative integers as major type 1 with argument `-1 - value`,
 * which is how `alg: -7` becomes `0x26 0x07`.
 */
function negative(value: number): number[] {
  return head(1, -1 - value);
}

export function encodeCbor(value: Writable): Uint8Array {
  if (value === null) return Uint8Array.of(0xf6);
  if (typeof value === 'boolean') return Uint8Array.of(value ? 0xf5 : 0xf4);
  if (typeof value === 'number') {
    return Uint8Array.from(value >= 0 ? head(0, value) : negative(value));
  }
  if (typeof value === 'string') {
    const bytes = new TextEncoder().encode(value);
    return Uint8Array.from([...head(3, bytes.length), ...bytes]);
  }
  if (value instanceof Uint8Array) {
    return Uint8Array.from([...head(2, value.length), ...value]);
  }
  if (Array.isArray(value)) {
    const parts: number[] = [...head(4, value.length)];
    for (const item of value as Writable[]) parts.push(...encodeCbor(item));
    return Uint8Array.from(parts);
  }

  // Maps are written in the RFC 8949 canonical order — keys sorted by their
  // encoded bytes — because that is what an authenticator produced and what
  // byte-for-byte round-tripping depends on.
  const entries = [...(value as Map<number | string, Writable>)];
  entries.sort((a, b) => {
    const ka = encodeCbor(a[0] as Writable);
    const kb = encodeCbor(b[0] as Writable);
    for (let i = 0; i < Math.min(ka.length, kb.length); i++) {
      if (ka[i] !== kb[i]) return ka[i]! - kb[i]!;
    }
    return ka.length - kb.length;
  });

  const parts: number[] = [...head(5, entries.length)];
  for (const [k, v] of entries) {
    parts.push(...encodeCbor(k as Writable), ...encodeCbor(v));
  }
  return Uint8Array.from(parts);
}