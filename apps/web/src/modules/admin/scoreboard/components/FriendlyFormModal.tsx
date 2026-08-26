import { useEffect, useMemo, useState } from "react";
import { adminScoreboardApi } from "../../../../api/admin-scoreboard";
import { adminApi } from "../../../../api/admin";
import { useAdminToast } from "../../components/AdminToast";
import { formatAdminScoreboardError, SCOREBOARD_WAT_TZ } from "../admin-scoreboard-utils";
import type { AdminSbTeam } from "../types";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (matchId: string) => void;
};

const empty = {
  homeTeamId: "",
  awayTeamId: "",
  kickoffDate: "",
  kickoffTime: "15:00",
  venue: "",
  roundLabel: "",
};

/**
 * Create a one-off friendly.
 *
 * Shorter than the league fixture form on purpose: a friendly has no
 * competition to choose, no stage, no matchday and no knockout round. It also
 * lists every team rather than one competition's, because a friendly between
 * sides from different competitions is the ordinary case — and the one the
 * regular form refuses to create.
 */
export function FriendlyFormModal({ open, onClose, onCreated }: Props) {
  const toast = useAdminToast();
  const [form, setForm] = useState(empty);
  const [teams, setTeams] = useState<AdminSbTeam[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(empty);
    setError(null);
    setLoading(true);
    // Every team, unscoped: the whole point is crossing competitions.
    adminScoreboardApi
      .teams()
      .then(setTeams)
      .catch(() => setTeams([]))
      .finally(() => setLoading(false));
  }, [open]);

  const homeOptions = useMemo(
    () => teams.filter((t) => t.id !== form.awayTeamId),
    [teams, form.awayTeamId]
  );
  const awayOptions = useMemo(
    () => teams.filter((t) => t.id !== form.homeTeamId),
    [teams, form.homeTeamId]
  );

  const ready =
    form.homeTeamId && form.awayTeamId && form.kickoffDate && form.kickoffTime;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi.createFriendlyMatch({
        homeTeamId: form.homeTeamId,
        awayTeamId: form.awayTeamId,
        kickoffDate: form.kickoffDate,
        kickoffTime: form.kickoffTime,
        venue: form.venue.trim() || undefined,
        roundLabel: form.roundLabel.trim() || undefined,
      });
      toast.success("Friendly created");
      onCreated(res.match.id);
      onClose();
    } catch (err) {
      setError(formatAdminScoreboardError(err));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const teamLabel = (t: AdminSbTeam) =>
    t.competition?.name ? `${t.name} — ${t.competition.name}` : t.name;

  return (
    <div className="admin-sb-modal" role="dialog" aria-modal="true">
      <div className="admin-sb-modal__card">
        <header className="admin-sb-modal__head">
          <h2>Create a friendly</h2>
          <button type="button" className="admin-sb-modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <form className="admin-sb-modal__body" onSubmit={submit}>
          <p className="muted">
            A one-off fixture belonging to no league. It appears under{" "}
            <strong>Friendly Matches</strong> on the ScoreBoard and counts toward no table.
          </p>

          {error && <p className="admin-sb-error" role="alert">{error}</p>}

          <label className="admin-sb-field">
            <span>Home team</span>
            <select
              required
              value={form.homeTeamId}
              disabled={loading}
              onChange={(e) => setForm((f) => ({ ...f, homeTeamId: e.target.value }))}
            >
              <option value="">{loading ? "Loading teams…" : "Select a team…"}</option>
              {homeOptions.map((t) => (
                <option key={t.id} value={t.id}>{teamLabel(t)}</option>
              ))}
            </select>
          </label>

          <label className="admin-sb-field">
            <span>Away team</span>
            <select
              required
              value={form.awayTeamId}
              disabled={loading}
              onChange={(e) => setForm((f) => ({ ...f, awayTeamId: e.target.value }))}
            >
              <option value="">{loading ? "Loading teams…" : "Select a team…"}</option>
              {awayOptions.map((t) => (
                <option key={t.id} value={t.id}>{teamLabel(t)}</option>
              ))}
            </select>
          </label>

          <div className="admin-sb-field-row">
            <label className="admin-sb-field">
              <span>Kickoff date</span>
              <input
                type="date"
                required
                value={form.kickoffDate}
                onChange={(e) => setForm((f) => ({ ...f, kickoffDate: e.target.value }))}
              />
            </label>
            <label className="admin-sb-field">
              <span>Kickoff time ({SCOREBOARD_WAT_TZ})</span>
              <input
                type="time"
                required
                value={form.kickoffTime}
                onChange={(e) => setForm((f) => ({ ...f, kickoffTime: e.target.value }))}
              />
            </label>
          </div>

          <label className="admin-sb-field">
            <span>Venue <small className="muted">optional</small></span>
            <input
              type="text"
              maxLength={200}
              value={form.venue}
              placeholder="e.g. Otunba Dipo Dina International Stadium"
              onChange={(e) => setForm((f) => ({ ...f, venue: e.target.value }))}
            />
          </label>

          <label className="admin-sb-field">
            <span>Occasion <small className="muted">optional</small></span>
            <input
              type="text"
              maxLength={120}
              value={form.roundLabel}
              placeholder="Friendly"
              onChange={(e) => setForm((f) => ({ ...f, roundLabel: e.target.value }))}
            />
          </label>

          <footer className="admin-sb-modal__footer">
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={busy || !ready}>
              {busy ? "Creating…" : "Create friendly"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
