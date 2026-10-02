import { describe, expect, it } from "vitest";
import {
  GATE_PARTNER,
  REVIEWER_IDS,
  SCHEMA_VERSIONS,
  VERSION_LABELS,
  isGateName,
  prefixesOf,
} from "./gate-litter-patterns";

/**
 * The patterns are the safety mechanism.
 *
 * `purge-vision-gate-litter` deletes rows from whatever database it is pointed at,
 * and the only thing between it and real data is whether a name matches. So the
 * tests that matter here are the **negative** ones: the names that must survive.
 */

describe("names a gate generated", () => {
  it("matches the labels its sections create", () => {
    for (const label of [
      "gate-d9d49d46-v1",
      "gate-d9d49d46-v2",
      "gate-d9d49d46-bad",
      "gate-d9d49d46-bad2",
      "gate-d9d49d46-export",
      "gold benchmark 7c199849",
      "trains on gold 242c3ce8",
    ]) {
      expect(isGateName(label, VERSION_LABELS), label).toBe(true);
    }
  });

  it("matches its schema versions and reviewer ids", () => {
    expect(isGateName("gate-gold-19b51d51", SCHEMA_VERSIONS)).toBe(true);
    expect(isGateName("gate-export-360e6605", SCHEMA_VERSIONS)).toBe(true);
    expect(isGateName("gate-reviewer-one-5cfbf48d", REVIEWER_IDS)).toBe(true);
    expect(isGateName("gate-reviewer-two-5cfbf48d", REVIEWER_IDS)).toBe(true);
    expect(isGateName("gate-reviewer-5cfbf48d", REVIEWER_IDS)).toBe(true);
  });

  it("matches the fixture partners", () => {
    expect(GATE_PARTNER.pattern.test("Dataset gate 417d1577")).toBe(true);
    expect(GATE_PARTNER.pattern.test("Annotation gate 417d1577")).toBe(true);
    expect(GATE_PARTNER.pattern.test("Model registry gate 417d1577")).toBe(true);
    expect(GATE_PARTNER.pattern.test("Boxes gate 417d1577")).toBe(true);
    expect(GATE_PARTNER.pattern.test("Benchmark gate 417d1577")).toBe(true);
    expect(GATE_PARTNER.pattern.test("Promotion gate 417d1577")).toBe(true);
    expect(GATE_PARTNER.pattern.test("Tracks gate 417d1577")).toBe(true);
    expect(GATE_PARTNER.pattern.test("Track metrics gate 417d1577")).toBe(true);
    expect(GATE_PARTNER.pattern.test("Teams gate 417d1577")).toBe(true);
    expect(GATE_PARTNER.pattern.test("Identity gate 417d1577")).toBe(true);
    expect(GATE_PARTNER.pattern.test("Identity metrics gate 417d1577")).toBe(true);
    expect(GATE_PARTNER.pattern.test("Calibration gate 417d1577")).toBe(true);
    expect(GATE_PARTNER.pattern.test("Cuts gate 417d1577")).toBe(true);
    expect(GATE_PARTNER.pattern.test("Clock gate 417d1577")).toBe(true);
    expect(GATE_PARTNER.pattern.test("Game state gate 417d1577")).toBe(true);
    expect(GATE_PARTNER.pattern.test("Events gate 417d1577")).toBe(true);
  });
});

describe("names a person chose", () => {
  it("never matches a real dataset that shares the prefix", () => {
    /* The reason this module exists. `gold benchmark ` is a prefix somebody would
       naturally reach for, and the gate's version of it ends in a run id. */
    for (const label of [
      "gold benchmark for Lagos 2027",
      "gold benchmark",
      "gold benchmark v2",
      "trains on gold — do not delete",
      "gate-review-corpus",
      "gate-2027-season",
    ]) {
      expect(isGateName(label, VERSION_LABELS), label).toBe(false);
    }
  });

  it("refuses a run id that is not eight hex characters", () => {
    expect(isGateName("gold benchmark 7c19984", VERSION_LABELS)).toBe(false); // seven
    expect(isGateName("gold benchmark 7c1998499", VERSION_LABELS)).toBe(false); // nine
    expect(isGateName("gold benchmark 7C199849", VERSION_LABELS)).toBe(false); // upper case
    expect(isGateName("gold benchmark 7c19984g", VERSION_LABELS)).toBe(false); // not hex
  });

  it("refuses anything appended to or prepended to a gate name", () => {
    // Anchoring, tested directly: a substring match would accept all of these.
    expect(isGateName("gold benchmark 7c199849 (keep)", VERSION_LABELS)).toBe(false);
    expect(isGateName("real gold benchmark 7c199849", VERSION_LABELS)).toBe(false);
    expect(isGateName("gate-gold-19b51d51-production", SCHEMA_VERSIONS)).toBe(false);
    expect(isGateName("gate-reviewer-one-5cfbf48d-2", REVIEWER_IDS)).toBe(false);
  });

  it("never matches an empty or absent name", () => {
    // reviewerId is nullable: an unattributed review must not be swept up.
    expect(isGateName(null, REVIEWER_IDS)).toBe(false);
    expect(isGateName(undefined, REVIEWER_IDS)).toBe(false);
    expect(isGateName("", REVIEWER_IDS)).toBe(false);
  });

  it("does not treat a partner name alone as enough", () => {
    // The address is checked as well, in the script. Here: the name must still fail.
    expect(GATE_PARTNER.pattern.test("Dataset gate")).toBe(false);
    expect(GATE_PARTNER.pattern.test("Lagos Dataset gate 417d1577")).toBe(false);
    expect(GATE_PARTNER.pattern.test("Dataset gateway 417d1577")).toBe(false);
  });
});

describe("what the database gets asked for", () => {
  it("asks by prefix, because Prisma has no regex", () => {
    expect(prefixesOf(VERSION_LABELS)).toEqual([
      "gate-",
      "gold benchmark ",
      "trains on gold ",
    ]);
  });

  it("collapses the repeated prefix rather than querying it twice", () => {
    // Two schema patterns share `gate-`.
    expect(prefixesOf(SCHEMA_VERSIONS)).toEqual(["gate-gold-", "gate-export-", "gate-"]);
  });

  it("asks for a prefix that would actually return the names it accepts", () => {
    /* If a prefix were narrower than the pattern it guards, the query would never
       return the rows the pattern exists to catch, and the purge would silently do
       less than it claims. Checked against real names rather than a name derived
       from the regex, because deriving one is how you end up testing the deriver. */
    const cases: [string, typeof VERSION_LABELS][] = [
      ["gate-abcdef12-v1", VERSION_LABELS],
      ["gate-abcdef12-export", VERSION_LABELS],
      ["gold benchmark abcdef12", VERSION_LABELS],
      ["trains on gold abcdef12", VERSION_LABELS],
      ["gate-gold-abcdef12", SCHEMA_VERSIONS],
      ["gate-export-abcdef12", SCHEMA_VERSIONS],
      ["gate-abcdef12-schema", SCHEMA_VERSIONS],
      ["gate-reviewer-abcdef12", REVIEWER_IDS],
      ["gate-reviewer-one-abcdef12", REVIEWER_IDS],
      ["gate-reviewer-two-abcdef12", REVIEWER_IDS],
    ];
    for (const [name, patterns] of cases) {
      expect(isGateName(name, patterns), `${name} should be recognised`).toBe(true);
      expect(
        prefixesOf(patterns).some((prefix) => name.startsWith(prefix)),
        `${name} would not be returned by any prefix query`
      ).toBe(true);
    }
  });
});
