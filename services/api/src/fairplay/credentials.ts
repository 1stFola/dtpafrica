import { createHash, createPrivateKey, createPublicKey, randomBytes, scrypt, scryptSync, sign, timingSafeEqual, type KeyObject } from "node:crypto";
import { canonical } from "./canonical";

/**
 * The secrets FairPlay handles, in the Edge's formats (services/fairplay-edge/fairplay_edge/auth.py):
 *
 *   - device and bootstrap tokens: random, stored as SHA-256 only;
 *   - matchday PINs: scrypt N=2^15 r=8 p=1, `scrypt$N$r$p$salt$digest` in base64, so the
 *     Edge checks them offline with `check_pin`;
 *   - credential bundles: Ed25519 over the canonical JSON, with the key id the Edge
 *     derives (the first 16 hex characters of SHA-256 of the raw public key).
 */

export const BUNDLE_SCHEMA = "fairplay.credential-bundle/v1";
export const BUNDLE_ISSUER = "dtp-cloud";
export const MIN_PIN = 6;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 };

export function newToken(): string {
  return randomBytes(32).toString("hex");
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token.trim(), "utf8").digest("hex");
}

export function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function validPin(pin: string): boolean {
  return /^\d+$/.test(pin) && pin.length >= MIN_PIN && pin.length <= 12;
}

export function hashPin(pin: string, salt: Buffer = randomBytes(16)): string {
  if (!validPin(pin)) throw new Error(`a PIN is ${MIN_PIN} to 12 digits`);
  const digest = scryptSync(pin, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem });
  return pinRecord(salt, digest);
}

/**
 * As `hashPin`, off the request thread: the 32 MB scrypt runs in libuv's pool, so a member
 * setting PINs in a loop no longer stalls every other route (F7). Requests use this one.
 */
export async function hashPinAsync(pin: string, salt: Buffer = randomBytes(16)): Promise<string> {
  if (!validPin(pin)) throw new Error(`a PIN is ${MIN_PIN} to 12 digits`);
  const digest = await new Promise<Buffer>((resolve, reject) =>
    scrypt(pin, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem }, (e, d) => (e ? reject(e) : resolve(d))));
  return pinRecord(salt, digest);
}

function pinRecord(salt: Buffer, digest: Buffer): string {
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${digest.toString("base64")}`;
}

export type SigningKey = { key: KeyObject; publicKey: string; keyId: string };

export function loadSigningKey(pem: string): SigningKey {
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("the bundle signing key is not Ed25519");
  // The raw 32-byte public key is the JWK `x`, base64url.
  const jwk = createPublicKey(key).export({ format: "jwk" }) as { x: string };
  const raw = Buffer.from(jwk.x, "base64url");
  return { key, publicKey: raw.toString("base64"), keyId: createHash("sha256").update(raw).digest("hex").slice(0, 16) };
}

export type BundleMember = { userId: string; email: string; name: string; permissions: string[]; pinHash: string };

export type Bundle = {
  schema: typeof BUNDLE_SCHEMA;
  issuer: typeof BUNDLE_ISSUER;
  bundleId: string;
  issuedAt: string;
  expiresAt: string;
  session: { id: string; label: string; matchId: string | null; mode: string };
  members: BundleMember[];
};

export type SignedBundle = { bundle: Bundle; keyId: string; signature: string };

export function signBundle(bundle: Bundle, signing: SigningKey): SignedBundle {
  const signature = sign(null, Buffer.from(canonical(bundle), "utf8"), signing.key);
  return { bundle, keyId: signing.keyId, signature: signature.toString("base64") };
}

/** Second-resolution UTC with a Z, as the Edge writes and parses its own times. */
export function isoSeconds(at: Date): string {
  return at.toISOString().replace(/\.\d{3}Z$/, "Z");
}
