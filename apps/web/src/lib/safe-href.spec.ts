import { describe, expect, it } from "vitest";
import { safeHref } from "./safe-href";

describe("safeHref", () => {
  it("keeps http and https links", () => {
    expect(safeHref("https://dtp.africa/scoreboard")).toBe("https://dtp.africa/scoreboard");
    expect(safeHref("http://localhost:5173/players?tab=stats")).toBe("http://localhost:5173/players?tab=stats");
    expect(safeHref("  https://www.club.example ")).toBe("https://www.club.example/");
  });

  it.each([
    "javascript:alert(document.cookie)",
    "JAVASCRIPT:alert(1)",
    " javascript:alert(1)",
    "java\nscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "//evil.example",
    "/admin",
    "www.club.example",
  ])("drops %j", (value) => {
    expect(safeHref(value)).toBeNull();
  });

  it("drops empty and missing values", () => {
    expect(safeHref("")).toBeNull();
    expect(safeHref("   ")).toBeNull();
    expect(safeHref(null)).toBeNull();
    expect(safeHref(undefined)).toBeNull();
  });
});
