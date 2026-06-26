import { useEffect, useState } from "react";
import { adminScoreboardApi } from "../../../../api/admin-scoreboard";
import type { SbMatchListItem } from "../../../../api/scoreboard";
import { useAdminToast } from "../../components/AdminToast";
import {
  formatAdminScoreboardError,
  formatKickoffWat,
  kickoffAtToWatParts,
  SCOREBOARD_WAT_TZ,
} from "../admin-scoreboard-utils";

type Props = {
  match: SbMatchListItem;
  onSaved: (patch: { venue: string | null; kickoffAt: string | null }) => void;
};

export function GamedayEditPanel({ match, onSaved }: Props) {
  const toast = useAdminToast();
  const [editing, setEditing] = useState(false);
  const [venue, setVenue] = useState(match.venue ?? "");
  const [kickoffDate, setKickoffDate] = useState("");
  const [kickoffTime, setKickoffTime] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const parts = kickoffAtToWatParts(match.kickoffAt);
    setVenue(match.venue ?? "");
    setKickoffDate(parts.date);
    setKickoffTime(parts.time);
    setEditing(false);
  }, [match.id, match.venue, match.kickoffAt]);

  const resetForm = () => {
    const parts = kickoffAtToWatParts(match.kickoffAt);
    setVenue(match.venue ?? "");
    setKickoffDate(parts.date);
    setKickoffTime(parts.time);
    setEditing(false);
  };

  const save = async () => {
    if (!kickoffDate || !kickoffTime) {
      toast.error("Kickoff date and time are required (WAT)");
      return;
    }
    setSaving(true);
    try {
      const res = await adminScoreboardApi.patchMatchGameday(match.id, {
        venue,
        kickoffDate,
        kickoffTime,
      });
      toast.success("Gameday details updated");
      onSaved({
        venue: res.match.venue,
        kickoffAt: res.match.kickoffAt,
      });
      setEditing(false);
    } catch (e) {
      toast.error(formatAdminScoreboardError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-sb-gameday admin-sb-panel">
      <div className="admin-sb-gameday__header">
        <div>
          <h3 className="admin-sb-gameday__title">Gameday</h3>
          <p className="admin-sb-gameday__subtitle muted">
            {match.homeTeam.name} vs {match.awayTeam.name}
            {match.competition?.name ? ` · ${match.competition.name}` : ""}
          </p>
        </div>
        {!editing ? (
          <button
            type="button"
            className="admin-inline-button"
            onClick={() => setEditing(true)}
          >
            Edit gameday
          </button>
        ) : null}
      </div>

      {!editing ? (
        <dl className="admin-sb-gameday__summary">
          <div>
            <dt>Venue</dt>
            <dd>{match.venue?.trim() ? match.venue : "Not set"}</dd>
          </div>
          <div>
            <dt>Date &amp; time</dt>
            <dd>{formatKickoffWat(match.kickoffAt)}</dd>
          </div>
          <div>
            <dt>Timezone</dt>
            <dd>WAT ({SCOREBOARD_WAT_TZ})</dd>
          </div>
        </dl>
      ) : (
        <form
          className="admin-sb-gameday__form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="admin-sb-gameday__field">
            <span>Venue</span>
            <input
              type="text"
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder="e.g. Onikan Stadium, Lagos"
              maxLength={200}
              autoComplete="off"
            />
          </label>
          <div className="admin-sb-gameday__datetime">
            <label className="admin-sb-gameday__field">
              <span>Date (WAT)</span>
              <input
                type="date"
                value={kickoffDate}
                onChange={(e) => setKickoffDate(e.target.value)}
                required
              />
            </label>
            <label className="admin-sb-gameday__field">
              <span>Kickoff time (WAT)</span>
              <input
                type="time"
                value={kickoffTime}
                onChange={(e) => setKickoffTime(e.target.value)}
                required
              />
            </label>
          </div>
          <p className="admin-sb-gameday__hint muted">
            Times are stored in West Africa Time (UTC+1). Clear venue text to remove the venue label.
          </p>
          <div className="admin-sb-form-actions">
            <button
              type="submit"
              className="admin-inline-button admin-inline-button--primary"
              disabled={saving}
            >
              {saving ? "Saving…" : "Save gameday"}
            </button>
            <button
              type="button"
              className="admin-inline-button"
              onClick={resetForm}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
