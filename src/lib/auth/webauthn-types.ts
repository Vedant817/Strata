/**
 * Local ambient type so `cbor.ts` does not depend on the DOM lib being loaded
 * by `tsconfig`. WebCrypto's `EcKeyFormat` is what `importKey` wants for a raw
 * public key.
 */
export type EcKeyFormat = 'ECDSA' | 'RSA-PSS' | 'RSASSA-PKCS1-v1_5' | 'Ed25519';