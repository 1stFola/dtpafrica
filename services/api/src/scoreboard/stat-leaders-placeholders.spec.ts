import { describe, expect, it } from "vitest";
import { isPlaceholderName } from "../players/placeholder-names";

/**
 * A leader is a person.
 *
 * `statLeaders` aggregates from events, and when an event has no player attached it
 * falls back to the label written on it. That is right for a real name nobody has
 * linked yet — the scorer is known, the record just is not — and wrong for the
 * words people write when the scorer was *not* known.
 *
 * On live it put `Player` second in the Ex Internationals Cup with five goals and
 * `Unknown` fourth with four. This is what those charts must never contain again.
 */
describe("what may appear in a scoring chart", () => {
  it("keeps a real scorer whose label was never linked to a record", () => {
    /* The reason the fallback exists. Farouk Salami led that competition on seven
       goals with no player record behind him, and deserves to. */
    for (const name of ["Farouk Salami", "Alo Deji", "Wasiu Yayah", "Esther Oyenezide"]) {
      expect(isPlaceholderName(name), name).toBe(false);
    }
  });

  it("drops the words written when the scorer was not known", () => {
    for (const name of ["Player", "Unknown", "unknown", "Goalkeeper", "Own Goal", "No. 9", "#7"]) {
      expect(isPlaceholderName(name), name).toBe(true);
    }
  });
});
