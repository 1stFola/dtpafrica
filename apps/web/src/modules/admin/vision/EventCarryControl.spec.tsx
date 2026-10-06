import { describe, it, expect } from "vitest";
import { carryVersions } from "./EventCarryControl";
import type { VisionModelRow } from "../../../api/vision";

describe("carry rule selection", () => {
  it("offers only supported weight-free, nonarchived event versions", () => {
    const base = { id: "valid", version: "v1", stage: "candidate", configKey: "event-carry/v1", weightsKey: null, weightsChecksum: null };
    const models = [{ key: "carry", task: "event", versions: [base, { ...base, id: "archived", stage: "archived" }, { ...base, id: "weighted", weightsChecksum: "hash" }, { ...base, id: "file", weightsKey: "weights" }, { ...base, id: "unsupported", configKey: "other" }] }, { key: "detector", task: "detect", versions: [base] }] as unknown as VisionModelRow[];
    expect(carryVersions(models)).toEqual([{ id: "valid", label: "carry · v1 · candidate" }]);
  });
});
