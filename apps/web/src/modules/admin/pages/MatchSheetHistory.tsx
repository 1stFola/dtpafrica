import type { SheetLogAction, SheetLogEntry } from "../../../api/adminMatchStats";

/** Plain-language description of each action, from the reader's point of view. */
const ACTION_COPY: Record<SheetLogAction, string> = {
  submitted: "Submitted for approval",
  resubmitted: "Resubmitted after changes",
  approved: "Approved and published",
  sent_back: "Sent back for edits",
  correction_requested: "Correction requested",
  correction_approved: "Correction approved — record reopened",
  correction_declined: "Correction declined — record stays locked",
};

const ACTION_TONE: Record<SheetLogAction, string> = {
  submitted: "info",
  resubmitted: "info",
  approved: "good",
  sent_back: "warn",
  correction_requested: "warn",
  correction_approved: "good",
  correction_declined: "bad",
};

/* "sheet" is what whole-sheet actions record now that statistics and events are
   submitted together; the other two still appear on entries from before that. */
const SECTION_COPY: Record<string, string> = {
  stats: "Statistics",
  events: "Event log",
  sheet: "Statistics & events",
};

/** Compact rendering of the snapshot stored with a submission. */
function summaryLine(summary: Record<string, unknown> | null): string | null {
  if (!summary) return null;
  const parts: string[] = [];
  const pair = (v: unknown) =>
    v && typeof v === "object" && "home" in (v as never) && "away" in (v as never)
      ? `${(v as { home: number }).home}–${(v as { away: number }).away}`
      : null;

  if (typeof summary.events === "number") parts.push(`${summary.events} events`);
  const score = pair(summary.score);
  if (score) parts.push(`score ${score}`);
  const shots = pair(summary.shots);
  if (shots) parts.push(`shots ${shots}`);
  const corners = pair(summary.corners);
  if (corners) parts.push(`corners ${corners}`);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * The sheet's history, newest first.
 *
 * Shown to both sides: a recorder can see what was asked of them and when, and
 * an admin can trace who changed what across resubmissions.
 */
export function MatchSheetHistory({
  entries,
  loading,
}: {
  entries: SheetLogEntry[];
  loading?: boolean;
}) {
  if (loading) return <p className="mcx-callout">Loading history…</p>;
  if (entries.length === 0) {
    return <p className="mcx-callout">Nothing has happened to this sheet yet.</p>;
  }

  return (
    <ol className="mhl">
      {entries.map((entry) => {
        const summary = summaryLine(entry.summary);
        return (
          <li key={entry.id} className={`mhl__item mhl__item--${ACTION_TONE[entry.action]}`}>
            <div className="mhl__head">
              <span className="mhl__action">{ACTION_COPY[entry.action] ?? entry.action}</span>
              <span className="mhl__section">{SECTION_COPY[entry.section] ?? entry.section}</span>
            </div>
            <div className="mhl__meta">
              {entry.actorName ?? "Someone"}
              {entry.actorRole ? ` · ${entry.actorRole}` : ""}
              {" · "}
              {new Date(entry.createdAt).toLocaleString()}
            </div>
            {summary && <div className="mhl__summary">{summary}</div>}
            {entry.note && <p className="mhl__note">“{entry.note}”</p>}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The single most recent action, for the banner.
 *
 * The banner has to say what happened last rather than only showing a stale
 * send-back note, so a recorder always sees the current state of play.
 */
export function latestActionBanner(
  entries: SheetLogEntry[]
): { tone: string; text: string; note: string | null } | null {
  const latest = entries[0];
  if (!latest) return null;
  return {
    tone: ACTION_TONE[latest.action] ?? "info",
    text: `${SECTION_COPY[latest.section] ?? latest.section}: ${
      ACTION_COPY[latest.action] ?? latest.action
    } by ${latest.actorName ?? "someone"} · ${new Date(latest.createdAt).toLocaleString()}`,
    note: latest.note,
  };
}
