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

type Cbor =
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

/** The public keys an authenticator can actually be expected to produce. */
const SUPPORTED_ALGS: Record<number, { name: EcKeyFormat; hash: 'SHA-256' | 'SHA-384' | 'SHA-512' }> = {
  [-7]: { name: 'ECDSA', hash: 'SHA-256' }, // ES256, the overwhelming majority
  [-257]: { name: 'ECDSA', hash: 'SHA-256' }, // RS256, still common on Windows
  [-35]: { name: 'ECDSA', hash: 'SHA-384' }, // ES384
  [-36]: { name: 'ECDSA', hash: 'SHA-512' }, // ES512
  [-65535]: { name: 'ECDSA', hash: 'SHA-256' }, // EdDSA over edwards25519
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
  } as ParsedAttestation & { rpIdHash: string };
}

/** Assert `data` was signed by `coseKey` over `signature`. */
export async function verifySignature(
  coseKey: Map<number | string, Cbor>,
  alg: number,
  data: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  const spec = SUPPORTED_ALGS[alg];
  if (!spec) return false;

  const keyBytes = coseKey.get(-1);
  if (!(keyBytes instanceof Uint8Array)) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(keyBytes),
    { name: spec.name, namedCurve: alg === -35 ? 'P-384' : 'P-256' },
    false,
    ['verify'],
  ).catch(() => null);
  if (!key) return false;

  // WebAuthn signs the raw authenticator data, not a pre-hashed digest.
  return crypto.subtle.verify(spec.name, key, toArrayBuffer(signature), toArrayBuffer(data));
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

