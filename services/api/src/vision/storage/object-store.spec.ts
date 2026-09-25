import { visionKeys } from "@dtp/vision-contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryObjectStore } from "./in-memory-object-store";
import {
  MissingJustificationError,
  WriteOnceDeleteError,
  WriteOnceViolationError,
  type ObjectStore,
} from "./object-store";

const ASSET = "asset-1";

let store: InMemoryObjectStore;

beforeEach(() => {
  store = new InMemoryObjectStore();
});

/**
 * The gate for Phase 0 is that the adapter behaves correctly against a
 * configured backend or a mock. These assertions are written against the
 * `ObjectStore` port, so the same suite can be pointed at R2 in Phase 1 by
 * swapping the subject.
 */
describe("ObjectStore contract", () => {
  it("round-trips a small object", async () => {
    const subject: ObjectStore = store;
    await subject.putSmallObject("derived", "probes/a/ffprobe.json", '{"ok":true}', "application/json");

    const body = await subject.getSmallObject("derived", "probes/a/ffprobe.json");
    expect(body?.toString()).toBe('{"ok":true}');

    const meta = await subject.head("derived", "probes/a/ffprobe.json");
    expect(meta?.bytes).toBe(11);
    expect(meta?.contentType).toBe("application/json");
  });

  it("returns null rather than throwing for a missing object", async () => {
    expect(await store.head("derived", "nope")).toBeNull();
    expect(await store.getSmallObject("derived", "nope")).toBeNull();
  });

  it("lists by prefix", async () => {
    await store.putSmallObject("derived", "inference/j/1/a.parquet", "a", "application/octet-stream");
    await store.putSmallObject("derived", "inference/j/1/b.parquet", "b", "application/octet-stream");
    await store.putSmallObject("derived", "inference/j/2/c.parquet", "c", "application/octet-stream");

    const page = await store.list("derived", "inference/j/1/");
    expect(page.keys).toEqual(["inference/j/1/a.parquet", "inference/j/1/b.parquet"]);
  });
});

// Source media and rights evidence are the two things that must never be
// silently replaced.
describe("the master bucket is write-once", () => {
  it("refuses a second write to an existing master key", async () => {
    const { bucket, key } = visionKeys.sourceOriginal(ASSET, "mp4");
    await store.putSmallObject(bucket, key, "first", "video/mp4");

    await expect(store.putSmallObject(bucket, key, "second", "video/mp4")).rejects.toThrow(
      WriteOnceViolationError
    );
    expect((await store.getSmallObject(bucket, key))?.toString()).toBe("first");
  });

  it("refuses a presigned PUT that would overwrite a master object", async () => {
    const { bucket, key } = visionKeys.sourceOriginal(ASSET, "mp4");
    await store.putSmallObject(bucket, key, "first", "video/mp4");

    await expect(store.presignPut(bucket, key, 900)).rejects.toThrow(WriteOnceViolationError);
  });

  it("refuses a copy onto an existing master object", async () => {
    const target = visionKeys.sourceOriginal(ASSET, "mp4");
    await store.putSmallObject(target.bucket, target.key, "first", "video/mp4");
    await store.putSmallObject("derived", "tmp", "second", "video/mp4");

    await expect(store.copy({ bucket: "derived", key: "tmp" }, target)).rejects.toThrow(
      WriteOnceViolationError
    );
  });

  it("allows overwriting a derived object, which is regenerable", async () => {
    const { bucket, key } = visionKeys.proxy(ASSET);
    await store.putSmallObject(bucket, key, "v1", "video/mp4");
    await store.putSmallObject(bucket, key, "v2", "video/mp4");
    expect((await store.getSmallObject(bucket, key))?.toString()).toBe("v2");
  });
});

/**
 * Write-once stops an overwrite. It said nothing about a delete, which is the
 * one loss that cannot be undone while R2 bucket versioning is off — and our
 * application token cannot enable versioning, by design.
 */
describe("deletion from a write-once bucket", () => {
  const master = visionKeys.sourceOriginal(ASSET, "mp4");

  beforeEach(async () => {
    await store.putSmallObject(master.bucket, master.key, "source bytes", "video/mp4");
  });

  it("refuses an ordinary delete of source media", async () => {
    await expect(store.delete(master.bucket, master.key)).rejects.toThrow(WriteOnceDeleteError);
    expect(await store.head(master.bucket, master.key)).not.toBeNull();
  });

  it("refuses an ordinary delete of rights evidence", async () => {
    const evidence = visionKeys.rightsEvidence("partner-1", "ev-1", "pdf");
    await store.putSmallObject(evidence.bucket, evidence.key, "contract", "application/pdf");
    await expect(store.delete(evidence.bucket, evidence.key)).rejects.toThrow(WriteOnceDeleteError);
  });

  it("allows deleteProtected with a justification", async () => {
    await store.deleteProtected(master.bucket, master.key, "approved deletion request DR-1");
    expect(await store.head(master.bucket, master.key)).toBeNull();
  });

  it("records the justification so it can be audited", async () => {
    await store.deleteProtected(master.bucket, master.key, "approved deletion request DR-1");
    expect(store.protectedDeletes).toEqual([
      { bucket: master.bucket, key: master.key, justification: "approved deletion request DR-1" },
    ]);
  });

  it.each(["", "   "])("refuses deleteProtected with a blank justification %j", async (reason) => {
    await expect(store.deleteProtected(master.bucket, master.key, reason)).rejects.toThrow(
      MissingJustificationError
    );
    expect(await store.head(master.bucket, master.key)).not.toBeNull();
  });

  it("still allows an ordinary delete from a regenerable bucket", async () => {
    const { bucket, key } = visionKeys.proxy(ASSET);
    await store.putSmallObject(bucket, key, "proxy", "video/mp4");
    await store.delete(bucket, key);
    expect(await store.head(bucket, key)).toBeNull();
  });
});

describe("resumable multipart upload", () => {
  const { bucket, key } = visionKeys.sourceOriginal(ASSET, "mp4");

  it("assembles parts in declared order, not arrival order", async () => {
    const { uploadId } = await store.createMultipartUpload(bucket, key, "video/mp4");

    // Simulate a resumed upload: part 2 landed, the connection dropped, then
    // parts 1 and 3 were retried.
    const p2 = store.putPart(uploadId, 2, "BBB");
    const p1 = store.putPart(uploadId, 1, "AAA");
    const p3 = store.putPart(uploadId, 3, "CCC");

    await store.completeMultipartUpload(bucket, key, uploadId, [p3, p1, p2]);

    expect((await store.getSmallObject(bucket, key))?.toString()).toBe("AAABBBCCC");
  });

  it("refuses to complete with a missing part rather than truncating the file", async () => {
    const { uploadId } = await store.createMultipartUpload(bucket, key, "video/mp4");
    const p1 = store.putPart(uploadId, 1, "AAA");

    await expect(
      store.completeMultipartUpload(bucket, key, uploadId, [p1, { partNumber: 2, etag: "x" }])
    ).rejects.toThrow(/Missing parts: 2/);
  });

  it("aborting discards the session and writes nothing", async () => {
    const { uploadId } = await store.createMultipartUpload(bucket, key, "video/mp4");
    store.putPart(uploadId, 1, "AAA");
    await store.abortMultipartUpload(bucket, key, uploadId);

    expect(await store.head(bucket, key)).toBeNull();
    await expect(store.presignUploadPart(bucket, key, uploadId, 1, 900)).rejects.toThrow();
  });

  it("issues a part URL per part with the requested TTL", async () => {
    const { uploadId } = await store.createMultipartUpload(bucket, key, "video/mp4");
    await store.presignUploadPart(bucket, key, uploadId, 1, 900);
    await store.presignUploadPart(bucket, key, uploadId, 2, 900);

    const parts = store.issuedUrls.filter((u) => u.method === "PUT_PART");
    expect(parts).toHaveLength(2);
    expect(parts.every((u) => u.ttlSeconds === 900)).toBe(true);
  });
});

describe("no bucket is publicly readable", () => {
  // Every read path goes through a signed URL with an explicit TTL. There is no
  // method on the port that returns an unsigned, permanent URL.
  it("exposes only presigned reads", async () => {
    const url = await store.presignGet("clips", "clip-1/clip.mp4", 300);
    expect(url).toContain("expires=");
    expect(store.issuedUrls.at(-1)).toMatchObject({ method: "GET", ttlSeconds: 300 });
  });
});
