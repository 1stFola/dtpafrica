import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReviewOrderControl } from "./ReviewOrderControl";
import { linkFor } from "./AdminVisionReviewPage";
import type { VisionReviewQueueItem } from "../../../api/vision";

describe("review navigation", () => {
  it("labels both order choices and exposes the selected option", () => {
    const html = renderToStaticMarkup(<ReviewOrderControl order="confidence" onChange={() => undefined} />);
    expect(html).toContain("Review order");
    expect(html).toContain('value="confidence" selected=""');
    expect(html).toContain("Oldest first");
  });

  it("carries order and row identity into the workstation without losing the seek position", () => {
    const identity = { kind: "identity", id: "identity-1", videoAssetId: "asset", trackId: "track-1", sourceMs: 9000 } as VisionReviewQueueItem;
    const params = new URL(linkFor(identity, "confidence"), "https://local.example").searchParams;
    expect(Object.fromEntries(params)).toEqual({ track: "track-1", at: "9000", order: "confidence", review: "identity-1" });
    const event = { ...identity, kind: "event", id: "event-1" } as VisionReviewQueueItem;
    expect(linkFor(event, "oldest")).toBe("/admin/vision/workstation/identity/asset?event=event-1&order=oldest");
  });
});
