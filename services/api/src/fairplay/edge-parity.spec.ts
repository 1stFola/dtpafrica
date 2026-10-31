import { createPrivateKey, verify, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canonical, CanonicalError, sha256Hex } from "./canonical";
import { hashPin, hashPinAsync, loadSigningKey, signBundle, type Bundle } from "./credentials";

/**
 * The cloud and the Edge must produce the same bytes for a signature or a hash, in two
 * languages. These vectors were written by the Edge's own Python
 * (services/fairplay-edge/fixtures/cloud_vectors.py); regenerate them there if the Edge's
 * formats change, never by hand.
 */
const vectors = JSON.parse(readFileSync(resolve(__dirname, "edge-vectors.json"), "utf8"));

function pemFromSeed(seedHex: string, publicB64: string) {
  const jwk = { kty: "OKP", crv: "Ed25519", d: Buffer.from(seedHex, "hex").toString("base64url"), x: Buffer.from(publicB64, "base64").toString("base64url") };
  return createPrivateKey({ key: jwk, format: "jwk" }).export({ format: "pem", type: "pkcs8" }).toString();
}

describe("canonical JSON matches the Edge's", () => {
  for (const [i, sample] of (vectors.canonical as { value: unknown; python: string }[]).entries()) {
    it(`sample ${i}`, () => expect(canonical(sample.value)).toBe(sample.python));
  }

  it("refuses a float rather than encoding it differently from Python", () => {
    expect(() => canonical({ coverage: 0.5 })).toThrow(CanonicalError);
  });
});

describe("audit entries recompute to the Edge's hash", () => {
  const { deviceId, payloads } = vectors.audit as { deviceId: string; payloads: Record<string, unknown>[] };

  it("from the hashed text the Edge sends, for every entry, floats included", () => {
    let prev = "0".repeat(64);
    for (const p of payloads) {
      const body = { seq: p.seq, at_utc: p.at_utc, device_id: deviceId, actor_id: p.actor_id, actor_name: p.actor_name, actor_kind: p.actor_kind,
        action: p.action, entity_type: p.entity_type, entity_id: p.entity_id, entity_version: p.entity_version, detail: p.detail_text, prev_hash: p.prev_hash };
      expect(sha256Hex(canonical(body))).toBe(p.entry_hash);
      expect(p.prev_hash).toBe(prev);
      prev = p.entry_hash as string;
    }
  });

  it("and the parsed detail alone could not have been trusted: Python's 1.0 parses as 1", () => {
    const withFloats = payloads.find((p) => p.action === "evidence.created")!;
    expect(canonical(withFloats.detail)).not.toBe(withFloats.detail_text);
    expect(withFloats.detail_text).toContain('"coverage":1.0');
  });
});

describe("credentials in the Edge's formats", () => {
  it("hashes a PIN exactly as the Edge does, so the Edge's check_pin accepts it", () => {
    const { pin, saltHex, hash } = vectors.pin;
    expect(hashPin(pin, Buffer.from(saltHex, "hex"))).toBe(hash);
  });

  it("and so does the off-thread hash the PIN route uses (F7)", async () => {
    const { pin, saltHex, hash } = vectors.pin;
    expect(await hashPinAsync(pin, Buffer.from(saltHex, "hex"))).toBe(hash);
  });

  it("signs a bundle with the same key id and the same Ed25519 signature as the Edge", () => {
    const v = vectors.bundle;
    const key = loadSigningKey(pemFromSeed(v.seedHex, v.publicKey));
    expect(key.publicKey).toBe(v.publicKey);
    expect(key.keyId).toBe(v.keyId);
    const signed = signBundle(v.bundle as Bundle, key);
    expect(signed.signature).toBe(v.signature);
    const pub = createPublicKey(createPrivateKey(pemFromSeed(v.seedHex, v.publicKey)));
    expect(verify(null, Buffer.from(canonical(v.bundle)), pub, Buffer.from(v.signature, "base64"))).toBe(true);
  });

  it("computes the bundle content hash the Edge sends back as `have`", () => {
    const v = vectors.bundle;
    expect(sha256Hex(canonical({ session: v.bundle.session, members: v.bundle.members }))).toBe(v.contentHash);
  });
});
