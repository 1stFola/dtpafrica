import { describe, expect, it, vi } from "vitest";
import { ANNOTATION_TASK_STATES } from "@dtp/vision-contracts";
import { VisionStatusController } from "./vision-status.controller";

/** A model whose `count` answers from rows, honouring `state` and `state.in`, so a filter on a state nothing has counts nothing. */
function counting(rows: { state: string }[]) {
  return {
    count: vi.fn(async (args?: { where?: { state?: string | { in: string[] } } }) => {
      const state = args?.where?.state;
      if (state === undefined) return rows.length;
      const wanted = typeof state === "string" ? [state] : state.in;
      return rows.filter((r) => wanted.includes(r.state)).length;
    }),
  };
}
const nothing = { count: vi.fn(async () => 0) };

describe("the Vision overview", () => {
  it("counts the annotation tasks that still expect work, by the contract's states", async () => {
    // One task in every state the contract has. The tile asked for `open` and `claimed`, which are not among them.
    const tasks = counting(ANNOTATION_TASK_STATES.map((state) => ({ state })));
    const prisma = {
      visionSourcePartner: nothing,
      visionSourceVideoRecord: nothing,
      visionVideoAsset: nothing,
      visionJob: nothing,
      visionWorker: nothing,
      visionAnnotationTask: tasks,
      visionEventCandidate: nothing,
      visionIdentityAssignment: nothing,
      visionDatasetVersion: nothing,
      visionModel: nothing,
      visionModelVersion: nothing,
    };
    const controller = new VisionStatusController({ enabled: true } as never, {} as never, {} as never, prisma as never);
    const overview = await controller.overview();
    // queued, assigned and rejected: the three that are not finished.
    expect(overview.annotationOpen).toBe(3);
    const asked = tasks.count.mock.calls[0]![0]!.where!.state as { in: string[] };
    for (const state of asked.in) expect(ANNOTATION_TASK_STATES).toContain(state);
  });
});
