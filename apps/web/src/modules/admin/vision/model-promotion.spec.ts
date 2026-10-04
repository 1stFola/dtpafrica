import { describe, expect, it } from "vitest";
import { nextStage, promotionActions } from "./model-promotion";

const both = { train: true, promote: true };
const pending = (over: Record<string, unknown> = {}) => ({ id: "pr-1", fromStage: "benchmarked", toStage: "staging", requestedBy: "alice", requestedByEmail: "alice@dtp.test", createdAt: "2026-10-03T10:00:00Z", ...over });

describe("where a version can be promoted to", () => {
  it("is staging from benchmarked, production from staging, and nowhere from anything else", () => {
    expect(nextStage("benchmarked")).toBe("staging");
    expect(nextStage("staging")).toBe("production");
    for (const stage of ["candidate", "production", "archived", "promotion_requested"]) expect(nextStage(stage)).toBeNull();
  });
});

describe("what the registry screen offers for a version", () => {
  it("offers a request from benchmarked and from staging, to a trainer, when none is waiting", () => {
    expect(promotionActions({ stage: "benchmarked", pendingPromotion: null }, "alice", both).request).toBe("staging");
    // The step into production: it was never offered, so nothing could reach production from the screen.
    expect(promotionActions({ stage: "staging", pendingPromotion: null }, "alice", both).request).toBe("production");
    expect(promotionActions({ stage: "candidate", pendingPromotion: null }, "alice", both).request).toBeNull();
    expect(promotionActions({ stage: "production", pendingPromotion: null }, "alice", both).request).toBeNull();
    expect(promotionActions({ stage: "staging", pendingPromotion: null }, "alice", { train: false, promote: true }).request).toBeNull();
    // An older API that does not send the field: treated as nothing waiting.
    expect(promotionActions({ stage: "benchmarked" }, "alice", both).request).toBe("staging");
  });

  it("offers Approve and Reject on the request that is waiting, to a different person with the permission", () => {
    const version = { stage: "benchmarked", pendingPromotion: pending() };
    const bob = promotionActions(version, "bob", both);
    expect(bob).toMatchObject({ decide: true, yours: false, request: null });
    expect(bob.waiting).toBe("promotion to staging requested by alice@dtp.test");
    expect(promotionActions(version, "bob", { train: true, promote: false }).decide).toBe(false);
  });

  it("does not offer the requester their own request, and says a second person decides", () => {
    const alice = promotionActions({ stage: "staging", pendingPromotion: pending({ fromStage: "staging", toStage: "production" }) }, "alice", both);
    expect(alice).toMatchObject({ decide: false, yours: true, request: null });
    expect(alice.waiting).toBe("promotion to production requested by alice@dtp.test; yours, so a second person decides");
  });

  it("does not offer a second request while one waits", () => {
    expect(promotionActions({ stage: "staging", pendingPromotion: pending() }, "carol", both).request).toBeNull();
  });

  it("offers rollback on a production version to someone who may promote", () => {
    expect(promotionActions({ stage: "production", pendingPromotion: null }, "bob", both).rollback).toBe(true);
    expect(promotionActions({ stage: "staging", pendingPromotion: null }, "bob", both).rollback).toBe(false);
    expect(promotionActions({ stage: "production", pendingPromotion: null }, "bob", { train: true, promote: false }).rollback).toBe(false);
  });

  it("names no requester when the request carries no email", () => {
    expect(promotionActions({ stage: "benchmarked", pendingPromotion: pending({ requestedByEmail: null }) }, "bob", both).waiting).toBe("promotion to staging requested");
  });
});
