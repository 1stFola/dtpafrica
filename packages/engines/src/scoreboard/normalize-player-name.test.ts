import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizePlayerName, playerLookupKey } from "./normalize-player-name";

describe("normalizePlayerName", () => {
  it("trims and collapses whitespace", () => {
    assert.equal(normalizePlayerName("  Chidi   Okafor  "), "Chidi Okafor");
  });

  it("produces stable lookup keys", () => {
    assert.equal(playerLookupKey("Chidi Okafor"), playerLookupKey("chidi  okafor"));
    assert.equal(playerLookupKey("José María"), "jose maria");
  });
});
