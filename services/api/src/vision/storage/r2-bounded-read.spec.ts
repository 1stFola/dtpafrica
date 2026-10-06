import { Readable } from "node:stream";
import { S3Client } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { R2ObjectStore } from "./r2-object-store";
import { SmallObjectTooLargeError } from "./object-store";
const store = () => new R2ObjectStore({ endpoint: "http://localhost:9000", region: "auto", accessKeyId: "qa-only", secretAccessKey: "qa-only", buckets: { derived: "qa-derived" } } as never);
afterEach(() => vi.restoreAllMocks());
describe("R2 bounded read wiring", () => {
  it("reads the SDK stream at the exact hard byte bound", async () => {
    vi.spyOn(S3Client.prototype, "send").mockResolvedValue({ Body: Readable.from([Buffer.from("ab"), Buffer.from("cd")]), ContentLength: 4 } as never);
    expect((await store().getSmallObject("derived", "events.json", 4))?.toString()).toBe("abcd");
  });
  it("rejects oversized declared length and closes its response body", async () => {
    const body = Readable.from([Buffer.from("abcde")]);
    vi.spyOn(S3Client.prototype, "send").mockResolvedValue({ Body: body, ContentLength: 5 } as never);
    await expect(store().getSmallObject("derived", "events.json", 4)).rejects.toBeInstanceOf(SmallObjectTooLargeError);
    expect(body.destroyed).toBe(true);
  });
  it("also refuses excessive streamed bytes when length metadata is absent or wrong", async () => {
    vi.spyOn(S3Client.prototype, "send").mockResolvedValue({ Body: Readable.from([Buffer.from("abc"), Buffer.from("de")]), ContentLength: 4 } as never);
    await expect(store().getSmallObject("derived", "events.json", 4)).rejects.toBeInstanceOf(SmallObjectTooLargeError);
  });
});
