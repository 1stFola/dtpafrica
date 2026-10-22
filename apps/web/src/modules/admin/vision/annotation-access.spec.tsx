import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { VisionAnnotationTask } from "../../../api/vision";
import { ANNOTATION_SCREEN_PERMISSIONS, sentBackReview } from "./annotation-access";

let granted: string[] = [];
vi.mock("../AdminAuthContext", () => ({
  useAdminAuth: () => ({
    hasPermission: (slug: string | string[]) => (Array.isArray(slug) ? slug : [slug]).some((s) => granted.includes(s)),
  }),
}));
const { AdminRequirePermission } = await import("../AdminRequirePermission");

/** What a person with these permissions lands on when they open a task. */
function opens(permissions: string[]) {
  granted = permissions;
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={["/admin/vision/workstation/task"]}>
      <Routes>
        <Route element={<AdminRequirePermission permission={ANNOTATION_SCREEN_PERMISSIONS} />}>
          <Route path="/admin/vision/workstation/task" element={<p>the task</p>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe("who opens the annotation screens", () => {
  it("lets a reviewer-only account in, so the review list and verdict buttons are reachable", () => {
    expect(opens(["vision.read", "vision.review"])).toContain("the task");
  });

  it("still lets a labeller in", () => {
    expect(opens(["vision.read", "vision.annotate"])).toContain("the task");
  });

  it("keeps the task from someone who may only read the catalogue", () => {
    // The redirect itself runs in an effect, which a static render does not run.
    expect(opens(["vision.read"])).not.toContain("the task");
  });
});

const review = (decision: "approved" | "rejected", notes: string | null = null) => ({
  id: `r-${decision}`, decision, rejectionReason: decision === "rejected" ? ("wrong_box" as const) : null, reviewerId: "reviewer", notes, createdAt: "2026-10-22T09:00:00Z",
});
const task = (state: string, reviews: ReturnType<typeof review>[]) =>
  ({ state, versions: [{ id: "v1", reviews }] }) as unknown as VisionAnnotationTask;

describe("why a task came back", () => {
  it("is the latest verdict, note included, while the task is sent back", () => {
    expect(sentBackReview(task("rejected", [review("rejected", "ball by the centre circle not boxed")]))?.notes).toBe("ball by the centre circle not boxed");
  });

  it("is nothing once the task has moved on, or before anyone reviewed it", () => {
    expect(sentBackReview(task("approved", [review("approved")]))).toBeNull();
    expect(sentBackReview(task("submitted", []))).toBeNull();
    expect(sentBackReview(null)).toBeNull();
  });
});
