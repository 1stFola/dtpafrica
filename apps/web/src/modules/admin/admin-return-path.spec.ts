import { describe, expect, it } from "vitest";
import { adminReturnPath } from "./admin-return-path";

describe("admin sign-in destination", () => {
  it("preserves workstation and event deep links", () => {
    for (const from of ["/admin/vision/workstation/identity/clip", "/admin/vision/events?asset=clip#event-3"]) {
      expect(adminReturnPath({ from })).toBe(from);
    }
  });
  it("falls back for missing, external and login destinations", () => {
    for (const from of [undefined, 12, "https://other.example/admin", "//other.example", "/admin/login?next=x", "/admin/\\evil", "/admin/vision\n"]) {
      expect(adminReturnPath({ from })).toBe("/admin");
    }
    expect(adminReturnPath(null)).toBe("/admin");
  });
});
