/**
 * The defaults the live-feed switches are read with.
 *
 * Every fixture belongs on the public feed, and the switch exists so an admin can take one
 * game off it. It defaulted off, which turned approving each match into a step somebody had
 * to remember — and a forgotten one cost more than the feed, because the full-time score
 * sync is behind the same switch, so a recorded game kept showing 0-0 after it ended.
 *
 * Commentary audio is the other way round: off until somebody turns it on.
 */
import { describe, expect, it } from "vitest";
import { readLiveFeature } from "./admin-match-stats.service";

describe("readLiveFeature", () => {
  it("approves a match nobody has switched", () => {
    expect(readLiveFeature(null).enabled).toBe(true);
    expect(readLiveFeature({}).enabled).toBe(true);
    expect(readLiveFeature({ spotter: {} }).enabled).toBe(true);
    expect(readLiveFeature({ liveFeature: {} }).enabled).toBe(true);
  });

  it("keeps a match an admin switched off, off", () => {
    expect(readLiveFeature({ liveFeature: { enabled: false } }).enabled).toBe(false);
  });

  it("honours an explicit approval", () => {
    expect(readLiveFeature({ liveFeature: { enabled: true } }).enabled).toBe(true);
  });

  it("leaves commentary audio off until it is turned on", () => {
    expect(readLiveFeature(null).audioEnabled).toBe(false);
    expect(readLiveFeature({ liveFeature: {} }).audioEnabled).toBe(false);
    expect(readLiveFeature({ liveFeature: { audioEnabled: true } }).audioEnabled).toBe(true);
  });

  it("never leaves audio on for a game that is off the feed", () => {
    expect(
      readLiveFeature({ liveFeature: { enabled: false, audioEnabled: true } }).audioEnabled
    ).toBe(false);
  });

  it("ignores junk in the switch rather than reading it as a decision", () => {
    expect(readLiveFeature({ liveFeature: { enabled: "no" } }).enabled).toBe(true);
    expect(readLiveFeature({ liveFeature: [] }).enabled).toBe(true);
    expect(readLiveFeature("live").enabled).toBe(true);
  });

  it("reports when the switch was last touched", () => {
    const at = "2026-09-30T15:00:00.000Z";
    expect(readLiveFeature({ liveFeature: { enabled: false, updatedAt: at } }).updatedAt).toBe(at);
    expect(readLiveFeature({ liveFeature: {} }).updatedAt).toBeNull();
  });
});
