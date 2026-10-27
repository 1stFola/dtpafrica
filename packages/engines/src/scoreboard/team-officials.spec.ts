import { describe, expect, it } from "vitest";
import {
  TEAM_OFFICIAL_NAME_MAX,
  readTeamOfficial,
  teamOfficialLabel,
  teamOfficialPhrase,
} from "./team-officials";

describe("team officials", () => {
  it("reads a role and a tidied name", () => {
    expect(readTeamOfficial({ role: "team_manager", name: " Ade\n  Bola " })).toEqual({
      role: "team_manager",
      name: "Ade Bola",
    });
  });

  it("refuses anything that is not a known role", () => {
    for (const input of [null, "head_coach", [], {}, { role: "owner" }, { role: 3 }]) {
      expect(readTeamOfficial(input)).toBeNull();
    }
  });

  it("caps a name rather than storing a paragraph", () => {
    const official = readTeamOfficial({ role: "other", name: "x".repeat(500) });
    expect(official?.name).toHaveLength(TEAM_OFFICIAL_NAME_MAX);
  });

  it("names the role alone when the name is not known", () => {
    expect(teamOfficialLabel({ role: "medic", name: null })).toBe("Physio / medic");
    expect(teamOfficialLabel({ role: "head_coach", name: "Ade Bola" })).toBe("Head coach · Ade Bola");
    expect(teamOfficialPhrase({ role: "other", name: null })).toBe("team official");
    expect(teamOfficialPhrase({ role: "assistant_coach", name: "Ade Bola" })).toBe(
      "assistant coach Ade Bola"
    );
  });
});
