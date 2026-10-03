import { decodeCbor, CborError, parseAttestationObject, toHex, verifySignature, type Cbor } from '../src/lib/auth/cbor';

let failed = 0;
const pending: Promise<void>[] = [];
function check(name: string, fn: () => void | Promise<void>) {
  // Async because the signature checks sign real data with real keys. The
  // promise is collected and awaited at the end, so a failure is still reported
  // as a failed assertion rather than an unhandled rejection.
  try {
    const r = fn();
    if (r instanceof Promise) {
      pending.push(
        r.then(
          () => console.log(`PASS  ${name}`),
          (e) => {
            failed++;
            console.log(`FAIL  ${name}  ->  ${(e as Error).message}`);
          },
        ),
      );
      return;
    }
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

/* -------------------------------------------------------------------------- */
/* Signature verification                                                       */
/* -------------------------------------------------------------------------- */

/* Parsing a COSE key correctly and *using* it are different code paths, and
   only the second one ever needed the key type. `verifySignature` used to read
   label -1 as key material, which is the RSA modulus; for an EC2 key -1 is the
   curve, so every ES256 assertion — which is nearly every real passkey — was
   refused as "signature did not verify". Parsing tests could not catch that, and
   neither could a type checker, so it shipped: passkeys enrolled and then could
   never sign in.

   These sign with real keys and verify with the real function. */

const MSG = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);

type CoseKey = Map<number | string, Cbor>;

const b64uToBytes = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));

/** Drop leading zero bytes, the way an authenticator may encode an integer. */
function trimLeadingZeros(b: Uint8Array): Uint8Array {
  let i = 0;
  while (i < b.length - 1 && b[i] === 0) i++;
  return b.slice(i);
}

interface KeyFixture {
  alg: number;
  /** Parameters for generateKey. */
  gen: Record<string, unknown>;
  /** COSE key from an exported public key, as an authenticator would send it. */
  cose: (jwk: JsonWebKey) => CoseKey;
}

const FIXTURES: Record<string, KeyFixture> = {
  es256: {
    alg: -7,
    gen: { name: 'ECDSA', namedCurve: 'P-256' },
    cose: (jwk) =>
      new Map<number | string, Cbor>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, b64uToBytes(jwk.x!)],
        [-3, b64uToBytes(jwk.y!)],
      ]),
  },
  es384: {
    alg: -35,
    gen: { name: 'ECDSA', namedCurve: 'P-384' },
    cose: (jwk) =>
      new Map<number | string, Cbor>([
        [1, 2],
        [3, -35],
        [-1, 2],
        [-2, b64uToBytes(jwk.x!)],
        [-3, b64uToBytes(jwk.y!)],
      ]),
  },
  rs256: {
    alg: -257,
    gen: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    cose: (jwk) =>
      new Map<number | string, Cbor>([
        [1, 3],
        [3, -257],
        [-1, b64uToBytes(jwk.n!)],
        [-2, b64uToBytes(jwk.e!)],
      ]),
  },
  ed25519: {
    alg: -65535,
    gen: { name: 'Ed25519' },
    cose: (jwk) =>
      new Map<number | string, Cbor>([
        [1, 1],
        [3, -65535],
        [-1, 6],
        [-2, b64uToBytes(jwk.x!)],
      ]),
  },
};

/** The hash WebCrypto needs named explicitly when signing this algorithm. */
const SIGN_HASH: Record<number, string | undefined> = {
  [-7]: 'SHA-256',
  [-35]: 'SHA-384',
  [-257]: 'SHA-256',
};

async function makePair(f: KeyFixture): Promise<{ pair: CryptoKeyPair; cose: CoseKey }> {
  const pair = (await crypto.subtle.generateKey(f.gen as unknown as AlgorithmIdentifier, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { pair, cose: f.cose(jwk) };
}

async function signWith(pair: CryptoKeyPair, f: KeyFixture): Promise<Uint8Array> {
  const params: Record<string, unknown> = { name: f.gen.name };
  const hash = SIGN_HASH[f.alg];
  if (hash) params.hash = hash;
  return new Uint8Array(
    await crypto.subtle.sign(params as unknown as AlgorithmIdentifier, pair.privateKey, MSG as unknown as BufferSource),
  );
}

check('verifies an ES256 signature (the case that was broken)', async () => {
  const f = FIXTURES.es256;
  const { pair, cose } = await makePair(f);
  const signature = await signWith(pair, f);
  assert((await verifySignature(cose, f.alg, MSG, signature)) === true, 'a valid ES256 assertion was refused');
  const tampered = Uint8Array.from(signature);
  tampered[tampered.length - 1] ^= 0xff;
  assert((await verifySignature(cose, f.alg, MSG, tampered)) === false, 'a broken signature was accepted');
  assert((await verifySignature(cose, f.alg, MSG.subarray(0, 4), signature)) === false, 'other data verified');
});

check('verifies an RS256 signature', async () => {
  const f = FIXTURES.rs256;
  const { pair, cose } = await makePair(f);
  assert((await verifySignature(cose, f.alg, MSG, await signWith(pair, f))) === true, 'a valid RS256 was refused');
});

check('verifies an Ed25519 signature', async () => {
  const f = FIXTURES.ed25519;
  const { pair, cose } = await makePair(f);
  assert((await verifySignature(cose, f.alg, MSG, await signWith(pair, f))) === true, 'a valid EdDSA was refused');
});

check('verifies ES384 with its own hash, not the WebCrypto default', async () => {
  const f = FIXTURES.es384;
  const { pair, cose } = await makePair(f);
  assert((await verifySignature(cose, f.alg, MSG, await signWith(pair, f))) === true, 'ES384 was refused');
});

check('a coordinate with a trimmed leading zero still imports', async () => {
  const f = FIXTURES.es256;
  const { pair, cose } = await makePair(f);
  // 1 key in 256 has a leading zero byte in a coordinate. Whichever key this is,
  // the point must be reconstructed rather than rejected for its length, so the
  // case is forced rather than left to luck.
  cose.set(-2, trimLeadingZeros(cose.get(-2) as Uint8Array));
  cose.set(-3, trimLeadingZeros(cose.get(-3) as Uint8Array));
  assert((await verifySignature(cose, f.alg, MSG, await signWith(pair, f))) === true, 'refused over coordinate width');
});

check('accepts a DER-wrapped ES256 signature, as Chromium\'s virtual authenticator sends', async () => {
  const f = FIXTURES.es256;
  const { pair, cose } = await makePair(f);
  const raw = await signWith(pair, f);
  // Re-encode the same (r, s) the way an emulator that ignores the spec does:
  // SEQUENCE { INTEGER r, INTEGER s }, each with a leading sign byte when the
  // high bit is set.
  const int = (half: Uint8Array) => {
    const needsPad = (half[0]! & 0x80) !== 0;
    const body = needsPad ? Uint8Array.of(0x00, ...half) : half;
    return Uint8Array.of(0x02, body.length, ...body);
  };
  const r = int(raw.subarray(0, 32));
  const s = int(raw.subarray(32));
  const der = Uint8Array.of(0x30, r.length + s.length, ...r, ...s);
  assert(der.length !== raw.length, 'the fixture is not actually wrapped');
  assert(
    (await verifySignature(cose, f.alg, MSG, der)) === true,
    'a DER-wrapped signature from a real authenticator was refused',
  );
  const truncated = der.subarray(0, der.length - 1);
  assert((await verifySignature(cose, f.alg, MSG, truncated)) === false, 'a truncated DER signature verified');
  const wrongBody = Uint8Array.from(der);
  wrongBody[3] ^= 0xff;
  assert((await verifySignature(cose, f.alg, MSG, wrongBody)) === false, 'a corrupted DER signature verified');
});

check('refuses a key type that disagrees with the algorithm', async () => {
  const { cose } = await makePair(FIXTURES.rs256);
  assert((await verifySignature(cose, -7, MSG, new Uint8Array(64))) === false, 'RSA key accepted as ES256');
  assert((await verifySignature(cose, -257, MSG, new Uint8Array(64))) === false, 'a bad RSA signature verified');
});

check('refuses a malformed or empty key rather than throwing', async () => {
  const cases: CoseKey[] = [
    new Map(),
    new Map([[1, 2]]),
    new Map([[1, 2], [3, -7], [-1, 1]]), // no coordinates
    new Map<number | string, Cbor>([[1, 2], [3, -7], [-1, 99], [-2, new Uint8Array(32)], [-3, new Uint8Array(32)]]), // unknown curve
    new Map<number | string, Cbor>([[1, 2], [3, -7], [-1, 1], [-2, new Uint8Array(3)], [-3, new Uint8Array(3)]]), // wrong width
    new Map<number | string, Cbor>([[1, 1], [3, -65535], [-1, 7], [-2, new Uint8Array(32)]]), // unsupported OKP curve
    new Map<number | string, Cbor>([[1, 2], [3, -8], [-1, 1], [-2, new Uint8Array(32)], [-3, new Uint8Array(32)]]), // unknown alg
  ];
  for (const [i, cose] of cases.entries()) {
    const alg = typeof cose.get(3) === 'number' ? (cose.get(3) as number) : -7;
    assert((await verifySignature(cose, alg, MSG, new Uint8Array(64))) === false, `case ${i} verified`);
  }
});

await Promise.all(pending);
console.log(failed === 0 ? '\nall CBOR/attestation assertions passed' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);