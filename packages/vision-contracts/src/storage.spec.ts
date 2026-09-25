import { describe, expect, it } from "vitest";
import {
  InvalidObjectKeySegmentError,
  assertSafeKeySegment,
  isKeyUnderPrefix,
  normaliseExtension,
  visionKeys,
} from "./storage";

const ASSET = "0f9a1c2d-3e4b-5a6f-8091-a2b3c4d5e6f7";
const JOB = "11112222-3333-4444-5555-666677778888";

describe("key segment validation", () => {
  it("accepts a uuid", () => {
    expect(assertSafeKeySegment(ASSET)).toBe(ASSET);
  });

  it.each(["../etc", "a/b", "", " ", ".hidden", "a".repeat(65), "a..b"])(
    "rejects %j",
    (segment) => {
      expect(() => assertSafeKeySegment(segment)).toThrow(InvalidObjectKeySegmentError);
    }
  );

  it("normalises extensions", () => {
    expect(normaliseExtension("MP4")).toBe(".mp4");
    expect(normaliseExtension(".Mov")).toBe(".mov");
  });

  it("rejects an extension that is really a path", () => {
    expect(() => normaliseExtension("mp4/../../x")).toThrow(InvalidObjectKeySegmentError);
  });
});

describe("visionKeys", () => {
  it("puts source originals in the write-once master bucket", () => {
    expect(visionKeys.sourceOriginal(ASSET, "mp4")).toEqual({
      bucket: "master",
      key: `originals/${ASSET}/source.mp4`,
    });
  });

  it("keeps rights evidence in master alongside the footage it authorises", () => {
    const ref = visionKeys.rightsEvidence("partner-1", "ev-1", "pdf");
    expect(ref.bucket).toBe("master");
    expect(ref.key).toBe("rights/partner-1/ev-1.pdf");
  });

  it("scopes inference output by attempt so a retry never overwrites", () => {
    const first = visionKeys.inferencePrefix(JOB, 1);
    const second = visionKeys.inferencePrefix(JOB, 2);
    expect(first).not.toBe(second);
    expect(first.endsWith("/")).toBe(true);
    expect(visionKeys.inferenceArtifact(JOB, 2, "detections.parquet").key).toBe(
      `inference/${JOB}/2/detections.parquet`
    );
  });

  it("refuses attempt zero", () => {
    expect(() => visionKeys.inferencePrefix(JOB, 0)).toThrow(InvalidObjectKeySegmentError);
  });

  it("refuses a negative thumbnail timestamp", () => {
    expect(() => visionKeys.thumbnail(ASSET, -1)).toThrow(InvalidObjectKeySegmentError);
  });

  it("separates derived, models and clips by bucket", () => {
    expect(visionKeys.proxy(ASSET).bucket).toBe("derived");
    expect(visionKeys.modelWeights("mv-1").bucket).toBe("models");
    expect(visionKeys.clip("clip-1").bucket).toBe("clips");
  });
});

describe("isKeyUnderPrefix", () => {
  const prefix = `inference/${JOB}/1/`;

  it("accepts a key inside the prefix", () => {
    expect(isKeyUnderPrefix(`${prefix}tracks.parquet`, prefix)).toBe(true);
  });

  it("rejects the prefix itself", () => {
    expect(isKeyUnderPrefix(prefix, prefix)).toBe(false);
  });

  it("rejects a sibling prefix", () => {
    expect(isKeyUnderPrefix(`inference/${JOB}/2/tracks.parquet`, prefix)).toBe(false);
  });

  // A worker asking to write outside its prefix is a signal, not a path to tidy.
  it("rejects traversal rather than normalising it", () => {
    expect(isKeyUnderPrefix(`${prefix}../../../originals/x/source.mp4`, prefix)).toBe(false);
  });

  it("rejects an absolute key", () => {
    expect(isKeyUnderPrefix(`/${prefix}x.parquet`, prefix)).toBe(false);
  });

  it("refuses a prefix that is not a directory", () => {
    expect(isKeyUnderPrefix("inference/x", "inference/x")).toBe(false);
  });
});
