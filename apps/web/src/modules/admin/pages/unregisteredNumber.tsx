import type { NumberLookup } from "@dtp/engines/squad-number-lookup";
import type { Side } from "../../../api/adminMatchStats";

/**
 * A shirt number as typed, or null when it is not one: blank, zero, a decimal, or past 99.
 *
 * The inputs say `min={1} max={99}`, but a number input still hands over whatever was
 * typed, so `0`, `7.5` and `150` used to be filed as they were.
 */
export function parseJersey(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= 1 && n <= 99 ? n : null;
}

export type NumberToCheck = { side: Side; number: number | null };

export type UnregisteredNumber = {
  side: Side;
  number: number;
  teamName: string;
  /** The team has no numbered players at all, so every number reads as unregistered. */
  squadEmpty: boolean;
};

/**
 * The numbers nobody in either squad wears.
 *
 * Through the same lookup the API publishes with, so "not registered" here is exactly a
 * number that will be published as a bare `No. 7` and hold the sheet back from
 * auto-approval. A number two players share is registered, and says so in its label.
 */
export function findUnregistered(
  lookup: NumberLookup,
  match: {
    homeTeam: { id: string; name: string };
    awayTeam: { id: string; name: string };
    teamSquad?: Array<{ teamId: string; jerseyNumber: number | null }>;
    squadPlayers?: Array<{ teamId: string; jerseyNumber: number | null }>;
  },
  entries: NumberToCheck[]
): UnregisteredNumber[] {
  const numbered = new Set(
    [...(match.teamSquad ?? []), ...(match.squadPlayers ?? [])]
      .filter((p) => p.jerseyNumber != null && p.jerseyNumber > 0)
      .map((p) => p.teamId)
  );
  const seen = new Set<string>();
  const out: UnregisteredNumber[] = [];
  for (const { side, number } of entries) {
    if (number == null || number <= 0) continue;
    const team = side === "home" ? match.homeTeam : match.awayTeam;
    const key = `${side}:${number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (lookup.resolve(team.id, number).kind !== "unknown") continue;
    out.push({ side, number, teamName: team.name, squadEmpty: !numbered.has(team.id) });
  }
  return out;
}

/**
 * Stops an entry against a number nobody in the squad wears, and lets the recorder file
 * it anyway: a guest player or a squad not yet updated is real, and pitchside is no place
 * to be refused. Rendered after the other prompts so it sits on top of them.
 */
export function UnregisteredNumberPrompt({
  numbers,
  onConfirm,
  onCancel,
}: {
  numbers: UnregisteredNumber[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const one = numbers.length === 1;
  return (
    <div
      className="mcx-prompt"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="mcx-unregistered-title"
      aria-describedby="mcx-unregistered-body"
    >
      <div className="mcx-prompt__card mcx-unregistered">
        <h3 id="mcx-unregistered-title">
          {one ? "Jersey number not registered" : "Jersey numbers not registered"}
        </h3>
        <div id="mcx-unregistered-body">
          <ul className="mcx-error mcx-unregistered__list" role="alert">
            {numbers.map((n) => (
              <li key={`${n.side}:${n.number}`}>
                {n.squadEmpty ? (
                  <>
                    <strong>{n.teamName}</strong> has no registered players, so No. {n.number}{" "}
                    cannot be matched to anyone.
                  </>
                ) : (
                  <>
                    No player in the <strong>{n.teamName}</strong> squad wears No. {n.number}.
                  </>
                )}
              </li>
            ))}
          </ul>
          <p className="muted">
            {one
              ? `Check the shirt. If it is right, the entry is filed as No. ${numbers[0].number} with no name, and the sheet needs an approver until the player is added to the squad.`
              : "Check the shirts. If they are right, the entry is filed with these numbers and no names, and the sheet needs an approver until the players are added to the squad."}
          </p>
        </div>
        <div className="mcx-prompt__actions">
          <button type="button" className="mcx-btn" onClick={onCancel} autoFocus>
            Change number
          </button>
          <button type="button" className="mcx-btn mcx-btn--danger" onClick={onConfirm}>
            Enter anyway
          </button>
        </div>
      </div>
    </div>
  );
}
