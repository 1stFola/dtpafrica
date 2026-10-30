import { describe, expect, it } from "vitest";
import { R2ObjectStore } from "./r2-object-store";
const store = () => new R2ObjectStore({ endpoint: "http://localhost:9000", region: "auto", accessKeyId: "qa-only", secretAccessKey: "qa-only", buckets: { models: "qa-models" } } as never);
const checksumParams = (url: string) => [...new URL(url).searchParams.keys()].filter((k) => /checksum/i.test(k));
describe("R2 presigned uploads", () => {
  // The SDK's default signed x-amz-checksum-crc32=AAAAAA==, the CRC32 of an empty body,
  // so SeaweedFS refused a 166 MB weights upload with HTTP 400 in the 29 Oct rehearsal.
  it("signs no checksum into a presigned PUT", async () => {
    const url = await store().presignPut("models", "inference/job/1/weights.pt", 60, { contentType: "application/octet-stream" });
    expect(checksumParams(url)).toEqual([]);
  });
  it("signs no checksum into a presigned multipart part", async () => {
    const url = await store().presignUploadPart("models", "inference/job/1/weights.pt", "upload-1", 1, 60);
    expect(checksumParams(url)).toEqual([]);
  });
});
