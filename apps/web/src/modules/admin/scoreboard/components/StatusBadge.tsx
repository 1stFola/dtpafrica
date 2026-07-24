import type { SbCompetitionStatus } from "../types";

const LABELS: Record<SbCompetitionStatus, string> = {
  active: "Ongoing",
  upcoming: "Upcoming",
  draft: "Draft",
  archived: "Archived",
};

export function StatusBadge({ status }: { status: SbCompetitionStatus }) {
  return (
    <span className={`admin-sb-status admin-sb-status--${status}`}>
      {LABELS[status]}
    </span>
  );
}
