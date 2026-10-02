import { decodeCbor, CborError, parseAttestationObject, toHex } from '../src/lib/auth/cbor';

let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}  -> ${(e as Error).message}`);
  }
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertThrows(fn: () => void): void {
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = e instanceof CborError || e instanceof Error;
  }
  if (!threw) throw new Error('expected a throw, got none');
}

/* -------------------------------------------------------------------------- */
/* A minimal encoder, so fixtures cannot be misaligned by hand                */
/* -------------------------------------------------------------------------- */

type Enc =
  | number
  | string
  | boolean
  | null
  | Uint8Array
  | Enc[]
  | [string, Enc][]
  | Map<number, Enc>;

function head(major: number, arg: number): number[] {
  if (arg < 24) return [(major << 5) | arg];
  if (arg < 0x100) return [(major << 5) | 24, arg];
  if (arg < 0x10000) return [(major << 5) | 25, (arg >> 8) & 0xff, arg & 0xff];
  return [
    (major << 5) | 26,
    (arg >>> 24) & 0xff,
    (arg >>> 16) & 0xff,
    (arg >>> 8) & 0xff,
    arg & 0xff,
  ];
}

function encode(value: Enc): Uint8Array {
  if (value === null) return Uint8Array.of(0xf6);
  if (typeof value === 'boolean') return Uint8Array.of(value ? 0xf5 : 0xf4);
  if (typeof value === 'number') {
    return value >= 0
      ? Uint8Array.from(head(0, value))
      : Uint8Array.from(head(1, -1 - value));
  }
  if (typeof value === 'string') {
    const bytes = new TextEncoder().encode(value);
    return Uint8Array.from([...head(3, bytes.length), ...bytes]);
  }
  if (value instanceof Uint8Array) {
    return Uint8Array.from([...head(2, value.length), ...value]);
  }
  if (Array.isArray(value) && value.every((v) => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string')) {
    const pairs = value as [string, Enc][];
    const parts: number[] = [...head(5, pairs.length)];
    for (const [k, v] of pairs) parts.push(...encode(k), ...encode(v));
    return Uint8Array.from(parts);
  }
  if (Array.isArray(value)) {
    const parts: number[] = [...head(4, value.length)];
    for (const v of value as Enc[]) parts.push(...encode(v));
    return Uint8Array.from(parts);
  }
  const entries = [...(value as Map<number, Enc>)].sort((a, b) => a[0] - b[0]);
  const parts: number[] = [...head(5, entries.length)];
  for (const [k, v] of entries) parts.push(...encode(k), ...encode(v));
  return Uint8Array.from(parts);
}

/* -------------------------------------------------------------------------- */
/* RFC 8949 vectors                                                           */
/* -------------------------------------------------------------------------- */

check('uint 0', () => assert(decodeCbor(Uint8Array.of(0x00)) === 0, 'wrong'));
check('uint 10', () => assert(decodeCbor(Uint8Array.of(0x0a)) === 10, 'wrong'));
check('uint 100', () => assert(decodeCbor(Uint8Array.of(0x18, 0x64)) === 100, 'wrong'));
check('uint 1000', () => assert(decodeCbor(Uint8Array.of(0x19, 0x03, 0xe8)) === 1000, 'wrong'));
check('negative -1', () => assert(decodeCbor(Uint8Array.of(0x20)) === -1, 'wrong'));
check('negative -1000', () => assert(decodeCbor(Uint8Array.of(0x39, 0x03, 0xe7)) === -1000, 'wrong'));
check('byte string', () => {
  const v = decodeCbor(Uint8Array.of(0x43, 1, 2, 3));
  assert(v instanceof Uint8Array && toHex(v as Uint8Array) === '010203', 'wrong');
});
check('text string', () => assert(decodeCbor(Uint8Array.of(0x63, 0x61, 0x62, 0x63)) === 'abc', 'wrong'));
check('array', () => {
  const v = decodeCbor(Uint8Array.of(0x83, 1, 2, 3));
  assert(Array.isArray(v) && (v as number[])[2] === 3, 'wrong');
});
check('map', () => {
  const v = decodeCbor(Uint8Array.of(0xa1, 0x61, 0x61, 0x01));
  assert(v instanceof Map && (v as Map<string, unknown>).get('a') === 1, 'wrong');
});
check('true / false / null', () => {
  assert(decodeCbor(Uint8Array.of(0xf5)) === true, 'true');
  assert(decodeCbor(Uint8Array.of(0xf4)) === false, 'false');
  assert(decodeCbor(Uint8Array.of(0xf6)) === null, 'null');
});

check('encoder round-trips through decoder', () => {
  const value: Enc = [
    ['fmt', 'none'],
    ['n', 42],
    ['s', 'a longer string that crosses the 24-byte length boundary'],
    ['b', [1, 2, 3]],
    ['bytes', new Uint8Array(300).fill(7)],
  ];
  const decoded = decodeCbor(encode(value)) as Map<string, unknown>;
  assert(decoded.get('fmt') === 'none', 'fmt');
  assert(decoded.get('n') === 42, 'n');
  assert((decoded.get('b') as number[]).length === 3, 'b');
  assert(((decoded.get('bytes') as Uint8Array).length === 300), 'bytes');
});

/* -------------------------------------------------------------------------- */
/* Hostile input must fail closed                                              */
/* -------------------------------------------------------------------------- */

check('empty input rejected', () => assertThrows(() => decodeCbor(new Uint8Array(0))));
check('truncated input rejected', () => assertThrows(() => decodeCbor(Uint8Array.of(0x43, 0x01))));
check('declared length beyond buffer rejected', () =>
  assertThrows(() => decodeCbor(Uint8Array.of(0x5a, 0xff, 0xff, 0x01, 0x02))));
check('oversized declared byte string rejected', () =>
  assertThrows(() => decodeCbor(Uint8Array.of(0x5a, 0x00, 0x10, 0x00, 0x00))));
check('depth bomb rejected', () => {
  const bytes = new Uint8Array(41).fill(0x81);
  bytes[40] = 0x00;
  assertThrows(() => decodeCbor(bytes));
});
check('unsupported simple value rejected', () => assertThrows(() => decodeCbor(Uint8Array.of(0xf8, 0x20))));
check('tag major type rejected', () => assertThrows(() => decodeCbor(Uint8Array.of(0xc0))));
check('half-float rejected (WebAuthn emits no floats)', () =>
  assertThrows(() => decodeCbor(Uint8Array.of(0xf9, 0x3e, 0x00))));
check('input over the overall cap rejected', () =>
  assertThrows(() => decodeCbor(new Uint8Array(70_000))));

/* -------------------------------------------------------------------------- */
/* Attestation objects                                                         */
/* -------------------------------------------------------------------------- */

function coseEs256(alg = -7): Map<number, Enc> {
  return new Map<number, Enc>([
    [1, 2], // kty: EC2
    [3, alg], // alg
    [-1, 1], // crv: P-256
    [-2, new Uint8Array(32).fill(0xbb)],
    [-3, new Uint8Array(32).fill(0xcc)],
  ]);
}

interface Opts {
  flags?: number;
  signCount?: number;
  alg?: number;
  credIdLen?: number;
  extraAttStmt?: boolean;
  fmt?: string;
}

function attestation(o: Opts = {}): Uint8Array {
  const flags = o.flags ?? 0x45; // UP | UV | AT
  const signCount = o.signCount ?? 7;
  const credId = new Uint8Array(o.credIdLen ?? 32).fill(0x22);

  /* authData is a *byte string*, not a CBOR structure. Each part below is
     appended raw; only the COSE key at the end is CBOR. */
  const authData = rawConcat([
    new Uint8Array(32).fill(0xaa), // rpIdHash
    new Uint8Array([flags]),
    new Uint8Array([(signCount >>> 24) & 0xff, (signCount >>> 16) & 0xff, (signCount >>> 8) & 0xff, signCount & 0xff]),
    new Uint8Array(16).fill(0x11), // aaguid
    new Uint8Array([(credId.length >> 8) & 0xff, credId.length & 0xff]),
    credId,
    encode(coseEs256(o.alg ?? -7)),
  ]);

  const attStmt: Enc = o.extraAttStmt ? [['x', 1]] : [];
  return encode([
    ['fmt', o.fmt ?? 'none'],
    ['attStmt', attStmt as Enc],
    ['authData', authData],
  ]);
}

function rawConcat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

check('parses a well-formed none-attestation', () => {
  const parsed = parseAttestationObject(attestation());
  assert(parsed.fmt === 'none', 'fmt');
  assert(toHex(parsed.credentialId) === '22'.repeat(32), 'credentialId: ' + toHex(parsed.credentialId));
  assert(parsed.alg === -7, 'alg: ' + parsed.alg);
  assert(parsed.signCount === 7, 'signCount: ' + parsed.signCount);
  assert(parsed.userVerified === true, 'UV');
  assert(parsed.aaguid === '11'.repeat(16), 'aaguid');
});

check('credential id length is honoured, not assumed 32', () => {
  for (const len of [16, 20, 64, 300]) {
    const parsed = parseAttestationObject(attestation({ credIdLen: len }));
    assert(parsed.credentialId.length === len, `len ${len} -> ${parsed.credentialId.length}`);
  }
});

check('signCount is read, not assumed', () => {
  assert(parseAttestationObject(attestation({ signCount: 0 })).signCount === 0, 'zero');
  assert(parseAttestationObject(attestation({ signCount: 999 })).signCount === 999, '999');
  assert(
    parseAttestationObject(attestation({ signCount: 4_000_000_000 })).signCount === 4_000_000_000,
    'near 2^32',
  );
});

check('flags are decoded', () => {
  assert(parseAttestationObject(attestation({ flags: 0x41 })).userVerified === false, 'UV clear');
  assert(parseAttestationObject(attestation({ flags: 0x45 })).userVerified === true, 'UV set');
});

check('rejects AT flag clear', () => assertThrows(() => parseAttestationObject(attestation({ flags: 0x05 }))));
check('rejects non-empty attStmt', () =>
  assertThrows(() => parseAttestationObject(attestation({ extraAttStmt: true }))));
check('rejects an unsupported alg', () => assertThrows(() => parseAttestationObject(attestation({ alg: -8 }))));
check('rejects a truncated attestation', () => {
  const full = attestation();
  assertThrows(() => parseAttestationObject(full.slice(0, full.length - 20)));
});
check('rejects garbage', () => assertThrows(() => parseAttestationObject(new Uint8Array(64).fill(0xff))));

console.log(failed === 0 ? '\nall CBOR/attestation assertions passed' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);