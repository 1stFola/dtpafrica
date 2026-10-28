import { describe, expect, it } from "vitest";
import { R2EvidenceStore, hexToBase64, base64ToHex } from "./evidence-store";

/**
 * What a presigned evidence URL commits the uploader to. Signing is local, so this needs no
 * bucket: the URL says which headers were signed, and R2 refuses a request whose signed
 * headers differ. A real-bucket check is in docs/fairplay/phase-4-cloud.md, pending the bucket.
 */
const store = new R2EvidenceStore({ backend: "r2", endpoint: "https://acct.r2.cloudflarestorage.com", accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "not-a-real-secret-for-signing-tests", region: "auto", bucket: "dtp-fairplay-evidence" });
const SHA = "a".repeat(64);

describe("R2EvidenceStore presigned PUT", () => {
  it("signs the length, the type and the SHA-256, and nothing about access", async () => {
    const put = await store.presignPut("sessions/s/evidence/e/clip.mp4", 1234, SHA, "video/mp4", 900);
    const url = new URL(put.url);
    const signed = url.searchParams.get("X-Amz-SignedHeaders")!.split(";");
    expect(signed).toEqual(expect.arrayContaining(["content-length", "content-type", "host", "x-amz-checksum-sha256"]));
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(put.headers).toEqual({ "content-length": "1234", "content-type": "video/mp4", "x-amz-checksum-sha256": hexToBase64(SHA) });
    expect(put.url).not.toMatch(/acl|crc32|x-amz-sdk-checksum-algorithm/i);
    expect(url.pathname).toBe("/dtp-fairplay-evidence/sessions/s/evidence/e/clip.mp4");
  });

  it("a read URL lasts at most five minutes and downloads as a file", async () => {
    const url = new URL(await store.presignGet("sessions/s/evidence/e/clip.mp4", 3600, "e-clip.mp4"));
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("response-content-disposition")).toBe('attachment; filename="e-clip.mp4"');
  });

  it("converts the Edge's hex SHA-256 to the base64 S3 uses and back", () => {
    expect(base64ToHex(hexToBase64(SHA))).toBe(SHA);
  });
});
