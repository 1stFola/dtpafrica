import { describe, expect, it } from "vitest";
import { diskCritical, diskMessage, freeLabel, roughly } from "./disk";

const disk = (state: string, minutesToHardLimit: number | null = null, minutesToFull: number | null = null) =>
  ({ freeBytes: 4.2e9, state, minutesToHardLimit, minutesToFull });

describe("disk banner", () => {
  it("says nothing while there is room", () => {
    expect(diskMessage(disk("ok"))).toBeNull();
  });
  it("gives the minutes left at the soft limit, when the rate is known", () => {
    expect(diskMessage(disk("soft_limit", 25))).toContain("About 25 min of recording before the hard limit");
    expect(diskMessage(disk("soft_limit"))).not.toContain("min of recording");
  });
  it("rounds long times down to hours or days", () => {
    expect(roughly(45)).toBe("45 min");
    expect(roughly(359)).toBe("5 h");
    expect(roughly(38863)).toBe("26 days");
  });
  it("says what is refused and when recording stops at the hard limit", () => {
    const text = diskMessage(disk("hard_limit", 0, 12))!;
    expect(text).toContain("New sessions, clips and exports are refused");
    expect(text).toContain("full in about 12 min, and recording then stops");
    expect(text).toContain("4.2 GB free");
  });
  it("says nothing is recording when the disk is full", () => {
    const text = diskMessage({ ...disk("full"), freeBytes: 0 })!;
    expect(text).toContain("Disk full (0.0 GB free)");
    expect(text).toContain("Nothing is being recorded on any camera");
    expect(diskCritical("full") && diskCritical("hard_limit") && !diskCritical("soft_limit")).toBe(true);
  });
  it("gives free space to one decimal place, never rounding 0.4 GB to 0", () => {
    expect(freeLabel(0.4e9)).toBe("0.4 GB free");
    expect(freeLabel(0)).toBe("0.0 GB free");
  });
});
