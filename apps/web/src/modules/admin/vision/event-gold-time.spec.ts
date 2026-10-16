import { describe, expect, it } from "vitest";
import { formatClipTime, goldPlayheadSourceMs, parseClipTime } from "./event-gold-time";
describe("gold reference playhead", () => {
  it("never turns the real pilot's padded proxy tail into an evidence frame", () => {
    expect(goldPlayheadSourceMs(49_720, { fps: 25, sourceOffsetMs: 0, sourceDurationMs: 49_706 }, 49_706)).toBe(49_680);
  });
  it("excludes the end of the reference window and preserves source offsets", () => {
    expect(goldPlayheadSourceMs(5000, { fps: 25, sourceOffsetMs: 10_000, sourceDurationMs: 20_000 }, 15_000)).toBe(14_960);
    expect(goldPlayheadSourceMs(1040, { fps: 25, sourceOffsetMs: 10_000, sourceDurationMs: 20_000 }, 15_000)).toBe(11_040);
  });
});

describe("clip times as people type them", () => {
  it("reads minutes and seconds, and plain seconds", () => {
    expect(parseClipTime("1:37")).toBe(97_000);
    expect(parseClipTime("1:37.5")).toBe(97_500);
    expect(parseClipTime("01:37.040")).toBe(97_040);
    expect(parseClipTime("0:05")).toBe(5_000);
    expect(parseClipTime("97.04")).toBe(97_040);
    expect(parseClipTime(" 2:24.582 ")).toBe(144_582);
  });
  it("refuses what it cannot read rather than guessing", () => {
    for (const bad of ["", "1:75", "abc", "1:2:3", "-1", "1:37.1234"]) expect(parseClipTime(bad)).toBeNull();
  });
  it("shows a time back as mm:ss.sss, so 1.37 seconds cannot pass for 1 minute 37", () => {
    expect(formatClipTime(1_370)).toBe("00:01.370");
    expect(formatClipTime(97_040)).toBe("01:37.040");
    expect(formatClipTime(144_582)).toBe("02:24.582");
  });
});
