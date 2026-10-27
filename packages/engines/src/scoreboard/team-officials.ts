/**
 * A card shown to someone on the bench rather than on the pitch: a coach, the team
 * manager, a physio.
 *
 * The recorder console captures players by shirt number, and an official has none. A
 * coach's caution used to need a made-up number, which published "No. 99 goes into the
 * book", held the sheet back from auto-approval for a player nobody could find, and put
 * the card on the public timeline as a player's.
 *
 * **Who, not which player.** An official is a role and, when the recorder knows it, a
 * name. The name is never written into a timeline row's player label: player history
 * matches events to a player by the name on that label, so a coach who shares a name with
 * a player in the squad would hand that player the booking. It travels in the event's
 * metadata and the commentary line instead.
 *
 * **Cards only.** A coach cannot score, assist or be substituted, so only the two card
 * types accept an official; anything else is read as a player event.
 *
 * Shared by the API and the console so the roles and their wording cannot drift.
 */

export const TEAM_OFFICIAL_ROLES = [
  "head_coach",
  "assistant_coach",
  "team_manager",
  "medic",
  "other",
] as const;

export type TeamOfficialRole = (typeof TEAM_OFFICIAL_ROLES)[number];

export type TeamOfficial = {
  role: TeamOfficialRole;
  /** Optional: a recorder pitchside often knows the role and not the name. */
  name: string | null;
};

/** The event types an official can be recorded against. */
export const OFFICIAL_EVENT_TYPES: ReadonlySet<string> = new Set(["yellow_card", "red_card"]);

/** Long enough for any real name, short enough that a pasted paragraph is refused. */
export const TEAM_OFFICIAL_NAME_MAX = 80;

/** How each role reads on a button and in a list. */
export const TEAM_OFFICIAL_ROLE_LABELS: Record<TeamOfficialRole, string> = {
  head_coach: "Head coach",
  assistant_coach: "Assistant coach",
  team_manager: "Team manager",
  medic: "Physio / medic",
  other: "Other official",
};

/** How each role reads mid-sentence: "the France head coach is cautioned". */
const ROLE_IN_SENTENCE: Record<TeamOfficialRole, string> = {
  head_coach: "head coach",
  assistant_coach: "assistant coach",
  team_manager: "team manager",
  medic: "physio",
  other: "team official",
};

const ROLE_SET = new Set<string>(TEAM_OFFICIAL_ROLES);

/**
 * An official from whatever a client sent, or null when it is not one. Whitespace in the
 * name is collapsed and a blank name is no name.
 */
export function readTeamOfficial(input: unknown): TeamOfficial | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  if (typeof raw.role !== "string" || !ROLE_SET.has(raw.role)) return null;
  const name =
    typeof raw.name === "string"
      ? raw.name.replace(/\s+/g, " ").trim().slice(0, TEAM_OFFICIAL_NAME_MAX).trim()
      : "";
  return { role: raw.role as TeamOfficialRole, name: name || null };
}

/** "Head coach · Ade Bola", or "Head coach" with no name: for a list or a timeline card. */
export function teamOfficialLabel(official: TeamOfficial): string {
  const role = TEAM_OFFICIAL_ROLE_LABELS[official.role];
  return official.name ? `${role} · ${official.name}` : role;
}

/** "head coach Ade Bola", or "head coach": the official as a sentence names them. */
export function teamOfficialPhrase(official: TeamOfficial): string {
  const role = ROLE_IN_SENTENCE[official.role];
  return official.name ? `${role} ${official.name}` : role;
}
