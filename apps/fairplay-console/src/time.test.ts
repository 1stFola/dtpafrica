import { describe, expect, it } from "vitest";
import { clockLabel, edgeToIngest, ingestToEdge, matchClock, mediaPath, parseTypedTime, positionEdgeMs, signedMs, windowFor } from "./time";

const T = Date.parse("2026-10-27T14:03:11.250Z");

describe("time model", () => {
  it("maps Edge time to a lagging source and back", () => {
    expect(edgeToIngest(T, 400)).toBe(T + 400); // the drone shows it 400 ms later
    expect(ingestToEdge(edgeToIngest(T, 400), 400)).toBe(T);
  });

  it("places the requested instant `lead` into the window", () => {
    const w = windowFor(T, 400, 5000, 40_000);
    expect(w.startIngestMs).toBe(T + 400 - 5000);
    expect(positionEdgeMs(w.startIngestMs, 5, 400)).toBe(T);
  });

  it("labels to tenths only", () => {
    expect(clockLabel(T)).toBe("14:03:11.2");
    expect(signedMs(-400)).toBe("−400 ms");
    expect(signedMs(12.6)).toBe("+13 ms");
  });

  it("counts the match clock from a period start, with the period's offset", () => {
    expect(matchClock(T + 22 * 60_000 + 42_000, T, 45)).toBe("67:42");
    expect(matchClock(T - 5000, T, 0)).toBe("0:00");
  });

  it("reads a typed time as its most recent UTC occurrence, or a full instant", () => {
    expect(parseTypedTime("13:55", T)).toBe(Date.parse("2026-10-27T13:55:00.000Z"));
    expect(parseTypedTime("13:55:00.4", T)).toBe(Date.parse("2026-10-27T13:55:00.400Z"));
    expect(parseTypedTime("23:55", T)).toBe(Date.parse("2026-10-26T23:55:00.000Z")); // later today has not happened
    expect(parseTypedTime("2026-10-28T00:01:02.5Z", T)).toBe(Date.parse("2026-10-28T00:01:02.500Z"));
    expect(parseTypedTime("2026-10-28T00:01:02", T)).toBe(Date.parse("2026-10-28T00:01:02.000Z"));
    // Just after midnight UTC, a late-evening time means last night.
    expect(parseTypedTime("23:55", Date.parse("2026-10-28T00:20:00Z"))).toBe(Date.parse("2026-10-27T23:55:00.000Z"));
    expect(parseTypedTime("25:00", T)).toBeNull();
    expect(parseTypedTime("soon", T)).toBeNull();
  });

  it("builds an encoded media path", () => {
    expect(mediaPath("drone", T, 10_000)).toBe("/edge/v1/media/drone?start=2026-10-27T14%3A03%3A11.250Z&durationMs=10000");
  });
});
