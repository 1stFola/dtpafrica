/*
 * What the venue console must never do, read from its own source: reach another host, or
 * offer a decision-changing control (ADR-0001).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { warningsFor } from "./replay";

const SRC = join(__dirname);
const files = readdirSync(SRC).filter((f) => /\.(tsx?|css)$/.test(f) && !f.endsWith(".test.ts"));
const sources = Object.fromEntries(files.map((f) => [f, readFileSync(join(SRC, f), "utf8")]));

describe("console guards", () => {
  it("references no other host (it must work with no internet)", () => {
    const external = /https?:\/\/(?!127\.0\.0\.1|localhost)[^\s"'`)]+/g;
    const hits = Object.entries(sources).flatMap(([f, text]) => (text.match(external) ?? []).map((u) => `${f}: ${u}`));
    expect(hits).toEqual([]);
  });

  it("has no control that changes a decision or contacts a referee", () => {
    const banned = /overturn|referee (?:call|contact|radio)|change (?:the )?(?:score|decision)\b(?! or)/i;
    const offenders = Object.entries(sources).filter(([, text]) => banned.test(text.replace(/Nothing here contacts a referee or changes a decision or a score/g, "")));
    expect(offenders.map(([f]) => f)).toEqual([]);
  });

  it("shows the shadow banner text", () => {
    expect(sources["Banner.tsx"]).toContain("SHADOW REVIEW — NOT VAR.");
  });

  it("words timing warnings, worst first", () => {
    expect(warningsFor("Drone", ["uncalibrated", "no_footage"], 2000)).toEqual([
      "No recording of Drone covers this moment.",
      "Drone is not calibrated: its timing is uncertain by ±2000 ms or more.",
    ]);
    expect(warningsFor("Drone", ["stale_after_reconnect"], 80)[0]).toMatch(/reconnected after it was calibrated/);
  });
});
