import { createHash } from "node:crypto";
import type { EvidenceObjectHead, EvidenceStore, SignedPut } from "./evidence-store";

/**
 * TESTS ONLY. An evidence bucket in memory that behaves like R2 does with a signed length
 * and checksum: a PUT of other bytes is refused. `put` stands in for the Edge's HTTP PUT;
 * `corrupt` stands in for an object that changed after it was stored.
 */
export class InMemoryEvidenceStore implements EvidenceStore {
  readonly backendId = "memory";
  readonly configured = true;
  readonly objects = new Map<string, { body: Buffer; sha256: string }>();
  readonly signed = new Map<string, { bytes: number; sha256: string }>();
  readonly removed: { key: string; reason: string }[] = [];
  /** Off by default, as R2 is with a signed checksum: on, it stores whatever is sent. */
  acceptAnything = false;

  async presignPut(key: string, bytes: number, sha256Hex: string, contentType: string, ttlSeconds: number): Promise<SignedPut> {
    this.signed.set(key, { bytes, sha256: sha256Hex });
    return { url: `memory://evidence/${key}`, method: "PUT", headers: { "content-length": String(bytes), "content-type": contentType },
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString() };
  }

  put(key: string, body: Buffer): void {
    const sha256 = createHash("sha256").update(body).digest("hex");
    const want = this.signed.get(key);
    if (!this.acceptAnything && (!want || want.bytes !== body.length || want.sha256 !== sha256)) {
      throw new Error("SignatureDoesNotMatch / BadDigest: the body is not what was signed");
    }
    this.objects.set(key, { body, sha256: this.acceptAnything ? sha256 : want!.sha256 });
  }

  corrupt(key: string): void {
    const o = this.objects.get(key);
    if (o) this.objects.set(key, { body: Buffer.concat([o.body, Buffer.from("x")]), sha256: createHash("sha256").update("other").digest("hex") });
  }

  async head(key: string): Promise<EvidenceObjectHead | null> {
    const o = this.objects.get(key);
    return o ? { bytes: o.body.length, sha256: o.sha256, etag: `"${o.sha256.slice(0, 32)}"` } : null;
  }

  async presignGet(key: string, ttlSeconds: number): Promise<string> {
    return `memory://evidence/${key}?ttl=${Math.min(ttlSeconds, 300)}`;
  }

  async remove(key: string, reason: string): Promise<void> {
    this.objects.delete(key);
    this.removed.push({ key, reason });
  }
}
