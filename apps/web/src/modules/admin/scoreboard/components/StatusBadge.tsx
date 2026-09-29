import type { SbCompetitionStatus } from "../types";

/** The badge already said "Ongoing" for a column that stored `active`; now they agree. */
const LABELS: Record<SbCompetitionStatus, string> = {
  scheduled: "Scheduled",
  ongoing: "Ongoing",
  draft: "Draft",
  archived: "Archived",
};

/** Said on the badge for a status the public ScoreBoard will not show. */
const HIDDEN_FROM_SCOREBOARD = new Set<SbCompetitionStatus>(["draft", "archived"]);

export function StatusBadge({ status }: { status: SbCompetitionStatus }) {
  return (
    <span
      className={`admin-sb-status admin-sb-status--${status}`}
      title={
        HIDDEN_FROM_SCOREBOARD.has(status)
          ? `${LABELS[status]} — not shown on the public ScoreBoard`
          : `${LABELS[status]} — shown on the public ScoreBoard`
      }
    >
      {LABELS[status]}
    </span>
  );
}
