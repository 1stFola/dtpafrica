import { describe, expect, it } from "vitest";
import { DEFAULT_RESOURCE_CLASS, MODEL_TASK_BY_JOB_TYPE, VISION_MODEL_TASKS } from "./jobs";
import { DETECTION_ARTIFACT_ROLE, DETECTION_CLASSES, QUALITY_FLAGS } from "./prediction";

/**
 * The detection contract, pinned.
 *
 * The Python worker mirrors these by reading this file's source
 * (services/vision-worker/tests/test_contract.py). What is asserted here is the part
 * a mirror cannot check: that the shapes the control plane relies on exist, and that
 * a stage bound to a model is one the contract routes to a GPU.
 */
describe("detection classes", () => {
  it("are the four Phase 3 classes and nothing else", () => {
    // `assistant_referee` was removed deliberately (docs/vision/02-DECISIONS.md, R9).
    expect([...DETECTION_CLASSES]).toEqual(["player", "goalkeeper", "referee", "ball"]);
  });

  it("can state that the ball was not found", () => {
    // Unknown beats wrong: the absence of a ball is a flag, never a coordinate.
    expect(QUALITY_FLAGS).toContain("ball_unknown");
  });

  it("names the artifact role the worker and the control plane agree on", () => {
    expect(DETECTION_ARTIFACT_ROLE).toBe("detections");
  });
});

describe("model-bound job types", () => {
  it("bind only to tasks a model can have", () => {
    for (const task of Object.values(MODEL_TASK_BY_JOB_TYPE)) {
      expect(VISION_MODEL_TASKS).toContain(task);
    }
  });

  it("are routed to a GPU class, because they run a model", () => {
    for (const jobType of Object.keys(MODEL_TASK_BY_JOB_TYPE) as (keyof typeof DEFAULT_RESOURCE_CLASS)[]) {
      expect(DEFAULT_RESOURCE_CLASS[jobType]).toMatch(/^gpu_/);
    }
  });

  it("includes detect, the one stage that exists", () => {
    expect(MODEL_TASK_BY_JOB_TYPE.detect).toBe("detect");
  });
});
