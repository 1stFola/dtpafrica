import { describe, expect, it } from "vitest";
import { STAGES, canQueue, describeRun, latestByType, missingFor, nextStage, succeededTypes, type JobRow } from "./pipeline";

const job = (type: string, state: string, queuedAt: string, over: Partial<JobRow> = {}): JobRow => ({ id: `${type}-${queuedAt}`, type, state, queuedAt, finishedAt: state === "succeeded" ? queuedAt : null, error: null, ...over });

describe("the stage order", () => {
  it("mirrors the contract: eight stages, detect on the GPU, gamestate after track alone", () => {
    expect(STAGES.map((s) => s.type)).toEqual(["probe", "fingerprint", "transcode", "cuts", "detect", "track", "identify", "gamestate"]);
    expect(STAGES.find((s) => s.type === "detect")?.where).toBe("gpu");
    expect(STAGES.find((s) => s.type === "gamestate")?.needs).toEqual(["track"]);
    expect(STAGES.find((s) => s.type === "probe")?.needs).toEqual([]);
  });

  it("queues a stage only when every prerequisite succeeded", () => {
    const done = new Set(["probe"]);
    expect(canQueue(STAGES[2]!, done)).toBe(true); // transcode
    expect(canQueue(STAGES[4]!, done)).toBe(false); // detect
    expect(missingFor(STAGES[4]!, done)).toEqual(["transcode"]);
    expect(missingFor(STAGES[7]!, new Set())).toEqual(["track"]);
    expect(missingFor(STAGES[0]!, new Set())).toBeNull();
  });
});

describe("what the jobs say", () => {
  const jobs = [job("probe", "failed", "2026-10-02T10:00:00Z", { error: "no stream" }), job("probe", "succeeded", "2026-10-02T10:05:00Z"), job("transcode", "running", "2026-10-02T10:06:00Z")];

  it("keeps the latest run of each type", () => {
    const latest = latestByType(jobs);
    expect(latest.get("probe")?.state).toBe("succeeded");
    expect(latest.get("transcode")?.state).toBe("running");
    expect(succeededTypes(jobs)).toEqual(new Set(["probe"]));
  });

  it("offers the next stage: not one running, not one done, only one whose prerequisites succeeded", () => {
    expect(nextStage(jobs)?.type).toBe("fingerprint");
    expect(nextStage([job("probe", "succeeded", "a"), job("fingerprint", "succeeded", "b"), job("transcode", "succeeded", "c")])?.type).toBe("cuts");
    expect(nextStage([])?.type).toBe("probe");
    const all = STAGES.map((s, i) => job(s.type, "succeeded", String(i)));
    expect(nextStage(all)).toBeNull();
    // A failed run does not block: it is offered again.
    expect(nextStage([job("probe", "failed", "a")])?.type).toBe("probe");
  });

  it("describes a run in words", () => {
    const now = new Date("2026-10-02T10:10:00Z").getTime();
    expect(describeRun(undefined)).toBe("not run");
    expect(describeRun(jobs[0], now)).toBe("failed: no stream");
    expect(describeRun(jobs[1], now)).toBe("succeeded 5m ago");
    expect(describeRun(jobs[2], now)).toBe("running");
    expect(describeRun(job("probe", "succeeded", "2026-10-01T10:00:00Z"), now)).toBe("succeeded 1d ago");
  });
});
