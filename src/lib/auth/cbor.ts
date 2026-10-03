import type { EcKeyFormat } from './webauthn-types';
/**
 * A deliberately small CBOR reader for WebAuthn.
 *
 * Only the subset the specification actually produces is decoded: unsigned
 * integers, negative integers, byte strings, text strings, arrays, maps and the
 * simple values `false`/`true`/`null`. Anything else is rejected rather than
 * guessed at.
 *
 * Two caps, both load-bearing. `MAX_DEPTH` stops a nested-array bomb from
 * overflowing the stack, and `MAX_BYTES` stops a huge declared byte string from
 * being allocated before it is read. This decoder parses attacker-supplied
 * attestation objects, so "it will throw eventually" is not a defence.
 *
 * Signature *verification* is not implemented here — that is Node's WebCrypto,
 * which is the part that genuinely must be audited.
 */

const MAX_DEPTH = 16;
const MAX_BYTES = 65_536;

export class CborError extends Error {}

export type Cbor =
  | number
  | string
  | boolean
  | null
  | Uint8Array
  | Cbor[]
  | Map<number | string, Cbor>;

class Reader {
  private pos = 0;
  constructor(private readonly buf: Uint8Array) {}

  private need(n: number): void {
    if (this.pos + n > this.buf.length) throw new CborError('truncated CBOR');
  }

  private byte(): number {
    this.need(1);
    return this.buf[this.pos++]!;
  }

  /** Major type 0-7 plus the argument, per RFC 8949 §3. */
  private argument(additional: number): number {
    if (additional < 24) return additional;
    if (additional === 24) return this.byte();
    if (additional === 25) {
      const v = (this.byte() << 8) | this.byte();
      return v;
    }
    if (additional === 26) {
      let v = 0;
      for (let i = 0; i < 4; i++) v = v * 256 + this.byte();
      return v;
    }
    if (additional === 27) {
      let v = 0;
      for (let i = 0; i < 8; i++) v = v * 256 + this.byte();
      // Beyond 2^53 a JS number cannot hold it exactly, and a byte length that
      // large is already a lie from a hostile encoder.
      if (!Number.isSafeInteger(v)) throw new CborError('CBOR integer too large');
      return v;
    }
    throw new CborError(`reserved additional information ${additional}`);
  }

  value(depth = 0): Cbor {
    if (depth > MAX_DEPTH) throw new CborError('CBOR nested too deeply');
    const initial = this.byte();
    const major = initial >> 5;
    const additional = initial & 0x1f;

    switch (major) {
      case 0:
        return this.argument(additional);
      case 1:
        return -1 - this.argument(additional);
      case 2: {
        const len = this.argument(additional);
        if (len > MAX_BYTES) throw new CborError('CBOR byte string too large');
        this.need(len);
        const out = this.buf.slice(this.pos, this.pos + len);
        this.pos += len;
        return out;
      }
      case 3: {
        const len = this.argument(additional);
        if (len > MAX_BYTES) throw new CborError('CBOR text string too large');
        this.need(len);
        const out = new TextDecoder().decode(this.buf.subarray(this.pos, this.pos + len));
        this.pos += len;
        return out;
      }
      case 4: {
        const len = this.argument(additional);
        const out: Cbor[] = [];
        for (let i = 0; i < len; i++) out.push(this.value(depth + 1));
        return out;
      }
      case 5: {
        const len = this.argument(additional);
        const out = new Map<number | string, Cbor>();
        for (let i = 0; i < len; i++) {
          const k = this.value(depth + 1);
          if (typeof k !== 'number' && typeof k !== 'string') {
            throw new CborError('CBOR map key must be int or text');
          }
          out.set(k, this.value(depth + 1));
        }
        return out;
      }
      case 7: {
        if (additional === 20) return false;
        if (additional === 21) return true;
        if (additional === 22) return null;
        throw new CborError('unsupported simple value');
      }
      default:
        throw new CborError(`unsupported major type ${major}`);
    }
  }
}

export function decodeCbor(bytes: Uint8Array): Cbor {
  if (!bytes.length) throw new CborError('empty CBOR');
  if (bytes.length > MAX_BYTES) throw new CborError('CBOR payload too large');
  return new Reader(bytes).value();
}

/* -------------------------------------------------------------------------- */
/* Attestation object                                                          */
/* -------------------------------------------------------------------------- */

/**
 * COSE key types (RFC 8152 §13). The key type, not the algorithm, decides how
 * the key material is laid out — and the algorithm alone does not say enough to
 * import anything.
 */
const KTY_OKP = 1;
const KTY_EC2 = 2;
const KTY_RSA = 3;

/** COSE elliptic curves (§13.1), with the fixed coordinate width of each. */
const EC_CURVES: Record<number, { namedCurve: 'P-256' | 'P-384' | 'P-521'; bytes: number }> = {
  1: { namedCurve: 'P-256', bytes: 32 },
  2: { namedCurve: 'P-384', bytes: 48 },
  3: { namedCurve: 'P-521', bytes: 66 },
};

/** The only OKP curve WebAuthn defines: Ed25519 (§13.2). */
const CRV_ED25519 = 6;

type Hash = 'SHA-256' | 'SHA-384' | 'SHA-512';

/**
 * The public keys an authenticator can actually be expected to produce.
 *
 * `kty` is carried explicitly because a COSE key is self-describing only if you
 * read the right label: for an EC2 key `-1` is the *curve*, with the coordinates
 * in `-2`/`-3`, while for an RSA key `-1` is the modulus. Reading `-1` as key
 * material regardless of type imports a one-byte "key", the import fails, and
 * every assertion from an ES256 authenticator — which is nearly all of them —
 * is refused as "signature did not verify". The hash is named too, because
 * WebCrypto's default for ECDSA is SHA-256 whatever the curve.
 */
const SUPPORTED_ALGS: Record<number, { kty: number; hash: Hash }> = {
  [-7]: { kty: KTY_EC2, hash: 'SHA-256' }, // ES256, the overwhelming majority
  [-35]: { kty: KTY_EC2, hash: 'SHA-384' }, // ES384
  [-36]: { kty: KTY_EC2, hash: 'SHA-512' }, // ES512
  [-257]: { kty: KTY_RSA, hash: 'SHA-256' }, // RS256, still common on Windows Hello
  [-258]: { kty: KTY_RSA, hash: 'SHA-384' }, // RS384
  [-259]: { kty: KTY_RSA, hash: 'SHA-512' }, // RS512
  [-65535]: { kty: KTY_OKP, hash: 'SHA-512' }, // EdDSA over edwards25519
};

/**
 * Attestation `none` is what every platform authenticator returns — the
 * authenticator simply declines to vouch for the key's provenance. That is the
 * intended default, not a downgrade to be suspicious of: it still proves the
 * key was created in this ceremony, because the signature is made by the
 * authenticator's own private key. Full attestation additionally requires
 * validating a vendor certificate chain, which needs per-vendor roots this
 * project has no business maintaining.
 */
export const ATTESTATION_NONE = 0;

export interface ParsedAttestation {
  fmt: string;
  authData: Uint8Array;
  credentialId: Uint8Array;
  /** COSE key, kept as CBOR so it round-trips byte-for-byte. */
  coseKey: Map<number | string, Cbor>;
  alg: number;
  aaguid: string;
  signCount: number;
  userVerified: boolean;
  /** Hex SHA-256 of the relying party id, straight from the signed bytes. */
  rpIdHash: string;
  backupEligible: boolean;
  backupState: boolean;
}

/**
 * Split authData and pull out the credential.
 *
 * Layout per §6.1: rpidHash(32) | flags(1) | signCount(4) | aaguid(16) |
 * idLen(2) | credentialId | cosePublicKey | [extensions]. The AAGUID is part of
 * attestedCredentialData and is *not* the credential — reading idLen straight
 * after the counter consumes two bytes of the AAGUID and yields a credential id
 * built out of the authenticator's vendor prefix. The attested blob is present
 * only when AT (0x40) is set; reading it unconditionally is how you end up
 * trusting attacker-controlled bytes as a credential id.
 */
export function parseAttestationObject(bytes: Uint8Array): ParsedAttestation {
  const decoded = decodeCbor(bytes);
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded) || decoded instanceof Uint8Array) {
    throw new CborError('attestationObject is not a map');
  }
  const map = decoded as Map<number | string, Cbor>;

  const fmt = map.get('fmt');
  const authDataRaw = map.get('authData');
  if (typeof fmt !== 'string') throw new CborError('missing fmt');
  if (!(authDataRaw instanceof Uint8Array)) throw new CborError('missing authData');

  const att = map.get('attStmt');
  // `none` carries an empty map. Anything else is an attestation format this
  // build does not validate, so it is refused rather than treated as `none`.
  if (!(att instanceof Map) || att.size !== 0) {
    throw new CborError('unsupported attestation statement');
  }

  const authData = authDataRaw;
  if (authData.length < 37) throw new CborError('authData too short');

  const flags = authData[32]!;
  if ((flags & 0x40) === 0) throw new CborError('no attested credential data');
  /* `<<` is 32-bit *signed* in JS, so a signCount above 2^31 would come out
     negative — and a negative counter is exactly what the clone-detection
     check below treats as a cloned credential. Read it unsigned. */
  const signCount =
    ((authData[33]! << 24) | (authData[34]! << 16) | (authData[35]! << 8) | authData[36]!) >>> 0;

  // rpIdHash is present so the ceremony can confirm which relying party the
  // authenticator thinks it is talking to.
  const rpIdHash = toHex(authData.subarray(0, 32));

  let offset = 37;
  const aaguidBytes = authData.subarray(offset, offset + 16);
  const aaguid = toHex(aaguidBytes);
  offset += 16;
  const idLen = (authData[offset]! << 8) | authData[offset + 1]!;
  offset += 2;
  if (idLen > MAX_BYTES) throw new CborError('credential id too large');
  const credentialId = authData.slice(offset, offset + idLen);
  offset += idLen;
  if (offset >= authData.length) throw new CborError('no COSE key after credential id');

  const coseKeyDecoded = decodeCbor(authData.subarray(offset));
  if (!(coseKeyDecoded instanceof Map)) throw new CborError('coseKey is not a map');
  const coseKey = coseKeyDecoded;

  const alg = coseKey.get(3);
  if (typeof alg !== 'number') throw new CborError('coseKey missing alg');
  if (!SUPPORTED_ALGS[alg]) throw new CborError(`unsupported algorithm ${alg}`);

  return {
    fmt,
    authData,
    credentialId,
    coseKey,
    alg,
    aaguid,
    signCount,
    userVerified: (flags & 0x04) !== 0,
    backupEligible: (flags & 0x08) !== 0,
    backupState: (flags & 0x10) !== 0,
    rpIdHash,
  };
}

/**
 * ECDSA signatures are specified as raw `r || s` (IEEE P1363), which is the only
 * form WebCrypto will verify. Chromium's own virtual authenticator — a shipping
 * browser, not a third-party tool — emits the ASN.1 DER wrapper instead, so a
 * reader signing in through it would be permanently locked out of an account
 * they had just enrolled.
 *
 * It is not a different signature: the same (r, s) over the same message, checked
 * against the same key. Unwrapping is therefore a compatibility measure and not a
 * relaxation. Anything that does not parse cleanly is returned untouched, so a
 * malformed signature is still refused by verification rather than by a parser.
 */
function derToRaw(signature: Uint8Array, size: number): Uint8Array | null {
  if (signature.length < 8 || signature[0] !== 0x30) return null;
  let offset = 2;
  let bodyLength = signature[1]!;
  if (bodyLength & 0x80) {
    const count = bodyLength & 0x7f;
    if (count < 1 || count > 2 || signature.length < 2 + count + 2) return null;
    bodyLength = 0;
    for (let i = 0; i < count; i++) bodyLength = bodyLength * 256 + signature[2 + i]!;
    offset = 2 + count;
  }
  if (2 + bodyLength !== signature.length) return null;

  const readInt = (): Uint8Array | null => {
    if (signature[offset] !== 0x02) return null;
    const len = signature[offset + 1]!;
    // Only the short form is accepted; a definite long form here would be
    // something no authenticator emits and is not worth the parsing.
    if (len & 0x80 || len < 1) return null;
    const start = offset + 2;
    if (start + len > signature.length) return null;
    let bytes = signature.subarray(start, start + len);
    offset = start + len;
    // A leading 0x00 is the sign byte of a positive INTEGER.
    if (bytes[0] === 0x00) bytes = bytes.subarray(1);
    if (bytes.length === 0 || bytes.length > size) return null;
    return bytes;
  };

  const r = readInt();
  if (!r) return null;
  const s = readInt();
  if (!s || offset !== signature.length) return null;

  const raw = new Uint8Array(size * 2);
  raw.set(r, size - r.length);
  raw.set(s, size * 2 - s.length);
  return raw;
}

/** Assert `data` was signed by the private key behind `coseKey`. */
export async function verifySignature(
  coseKey: Map<number | string, Cbor>,
  alg: number,
  data: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  const spec = SUPPORTED_ALGS[alg];
  if (!spec) return false;
  // The key must agree with the algorithm it is checked against, or a caller
  // could ask for RSA-PKCS1 verification of an EC2 key and get a nonsense
  // answer rather than a refusal.
  if (coseKey.get(1) !== spec.kty) return false;

  const bytes = (label: number): Uint8Array | null => {
    const v = coseKey.get(label);
    return v instanceof Uint8Array ? v : null;
  };

  try {
    if (spec.kty === KTY_EC2) {
      const crv = coseKey.get(-1);
      const x = bytes(-2);
      const y = bytes(-3);
      if (typeof crv !== 'number' || !x || !y) return false;
      const curve = EC_CURVES[crv];
      if (!curve) return false;

      // SEC1 uncompressed point: 0x04 || X || Y. Coordinates are normalised to
      // the curve's width because an authenticator that trims a leading zero
      // byte produces a point WebCrypto will not import.
      const point = new Uint8Array(1 + curve.bytes * 2);
      point[0] = 0x04;
      point.set(x.subarray(Math.max(0, x.length - curve.bytes)), 1);
      point.set(y.subarray(Math.max(0, y.length - curve.bytes)), 1 + curve.bytes);

      const key = await crypto.subtle.importKey(
        'raw',
        toArrayBuffer(point),
        { name: 'ECDSA', namedCurve: curve.namedCurve },
        false,
        ['verify'],
      );
      // Normalise a DER-wrapped signature if that is what arrived; a raw one is
      // passed through untouched.
      const sig = derToRaw(signature, curve.bytes) ?? signature;
      return await crypto.subtle.verify(
        { name: 'ECDSA', hash: spec.hash },
        key,
        toArrayBuffer(sig),
        toArrayBuffer(data),
      );
    }

    if (spec.kty === KTY_RSA) {
      const n = bytes(-1);
      const e = bytes(-2);
      if (!n || !e) return false;
      const key = await crypto.subtle.importKey(
        'jwk',
        {
          kty: 'RSA',
          n: Buffer.from(n).toString('base64url'),
          e: Buffer.from(e).toString('base64url'),
          alg: jwkAlgFor(spec.hash),
          ext: true,
        },
        { name: 'RSASSA-PKCS1-v1_5', hash: spec.hash },
        false,
        ['verify'],
      );
      return await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5',
        key,
        toArrayBuffer(signature),
        toArrayBuffer(data),
      );
    }

    if (spec.kty === KTY_OKP) {
      const crv = coseKey.get(-1);
      const x = bytes(-2);
      if (crv !== CRV_ED25519 || !x) return false;
      const key = await crypto.subtle.importKey('raw', toArrayBuffer(x), 'Ed25519', false, ['verify']);
      return await crypto.subtle.verify({ name: 'Ed25519' }, key, toArrayBuffer(signature), toArrayBuffer(data));
    }

    return false;
  } catch {
    // A malformed key is a refusal, not a crash: the bytes came from a device.
    return false;
  }
}

function jwkAlgFor(hash: Hash): string {
  return hash === 'SHA-256' ? 'RS256' : hash === 'SHA-384' ? 'RS384' : 'RS512';
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

export function fromBase64Url(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64url'));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

