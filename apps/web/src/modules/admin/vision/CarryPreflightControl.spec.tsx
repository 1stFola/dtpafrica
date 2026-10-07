import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CarryPreflightResult } from "./CarryPreflightControl";

describe("carry compatibility result", () => {
  it("shows the first real refusal and does not claim later checks passed", () => {
    const html = renderToStaticMarkup(<CarryPreflightResult result={{ videoAssetId: "asset", checkedAt: "2026-10-06T00:00:00Z", ready: false, blocker: { statusCode: 400, error: "PrerequisiteMissing", message: "events needs track and possession", remediation: "Run the named stages." } }} />);
    for (const text of ["PrerequisiteMissing", "events needs track and possession", "Run the named stages", "later inputs have not all been verified", "not a reservation"]) expect(html).toContain(text);
  });
  it("keeps compatible evidence separate from queueing and the accuracy gate", () => {
    const html = renderToStaticMarkup(<CarryPreflightResult result={{ videoAssetId: "asset", checkedAt: "2026-10-06T00:00:00Z", ready: true, modelVersionId: "rule", possessionJobId: "poss" }} />);
    for (const text of ["checks passed", "queueing repeats", "Accuracy and licence approval are separate"]) expect(html).toContain(text);
    expect(html).not.toContain("<button");
  });
});
