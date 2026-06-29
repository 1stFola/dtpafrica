import { useEffect, useMemo, useState } from "react";
import { adminScoreboardApi } from "../../../../api/admin-scoreboard";
import { useAdminToast } from "../../components/AdminToast";
import { formatAdminScoreboardError, SCOREBOARD_WAT_TZ } from "../admin-scoreboard-utils";
import type { AdminSbMatchInput, AdminSbTeam } from "../types";

type Props = {
  open: boolean;
  competitions: Array<{ id: string; name: string }>;
  initialCompetitionId?: string;
  onClose: () => void;
  onCreated: (matchId: string) => void;
};

const KNOCKOUT_ROUNDS = [
  { value: "", label: "None (group / league)" },
  { value: "R32", label: "Round of 32" },
  { value: "R16", label: "Round of 16" },
  { value: "QF", label: "Quarter-final" },
  { value: "SF", label: "Semi-final" },
  { value: "F", label: "Final" },
] as const;

const emptyForm = (competitionId: string): AdminSbMatchInput => ({
  competitionId,
  homeTeamId: "",
  awayTeamId: "",
  kickoffDate: "",
  kickoffTime: "15:00",
  venue: "",
  stageKey: "",
  roundLabel: "",
});

export function FixtureFormModal({
  open,
  competitions,
  initialCompetitionId,
  onClose,
  onCreated,
}: Props) {
  const toast = useAdminToast();
  const [form, setForm] = useState<AdminSbMatchInput>(
    emptyForm(initialCompetitionId ?? competitions[0]?.id ?? "")
  );
  const [teams, setTeams] = useState<AdminSbTeam[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(emptyForm(initialCompetitionId ?? competitions[0]?.id ?? ""));
  }, [open, initialCompetitionId, competitions]);

  useEffect(() => {
    if (!open || !form.competitionId) {
      setTeams([]);
      return;
    }
    setTeamsLoading(true);
    adminScoreboardApi
      .teams({ competitionId: form.competitionId })
      .then(setTeams)
      .catch(() => setTeams([]))
      .finally(() => setTeamsLoading(false));
  }, [open, form.competitionId]);

  const awayOptions = useMemo(
    () => teams.filter((t) => t.id !== form.homeTeamId),
    [teams, form.homeTeamId]
  );
  const homeOptions = useMemo(
    () => teams.filter((t) => t.id !== form.awayTeamId),
    [teams, form.awayTeamId]
  );

  if (!open) return null;

  const setField = <K extends keyof AdminSbMatchInput>(key: K, value: AdminSbMatchInput[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.homeTeamId || !form.awayTeamId) {
      setError("Select home and away teams");
      return;
    }
    if (form.homeTeamId === form.awayTeamId) {
      setError("Home and away teams must be different");
      return;
    }
    if (!form.kickoffDate || !form.kickoffTime) {
      setError("Kickoff date and time are required (WAT)");
      return;
    }

    setBusy(true);
    try {
      const body: AdminSbMatchInput = {
        competitionId: form.competitionId,
        homeTeamId: form.homeTeamId,
        awayTeamId: form.awayTeamId,
        kickoffDate: form.kickoffDate,
        kickoffTime: form.kickoffTime,
        venue: form.venue?.trim() || undefined,
        stageKey: form.stageKey?.trim() || undefined,
        knockoutRound: form.knockoutRound || undefined,
        leg: form.leg || undefined,
        roundLabel: form.roundLabel?.trim() || undefined,
        matchday: form.matchday || undefined,
      };
      const res = await adminScoreboardApi.createMatch(body);
      toast.success("Fixture created");
      onCreated(res.match.id);
      onClose();
    } catch (err) {
      setError(formatAdminScoreboardError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-sb-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="admin-sb-modal admin-sb-modal--wide"
        role="dialog"
        aria-labelledby="fixture-form-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="admin-sb-modal__header">
          <h2 id="fixture-form-title">Create fixture</h2>
          <button type="button" className="admin-sb-modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <form onSubmit={handleSubmit} className="admin-sb-modal__body">
          <label className="admin-sb-field">
            Competition
            <select
              required
              value={form.competitionId}
              onChange={(e) => {
                setField("competitionId", e.target.value);
                setField("homeTeamId", "");
                setField("awayTeamId", "");
              }}
            >
              <option value="">Select competition…</option>
              {competitions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <div className="admin-sb-gameday__datetime">
            <label className="admin-sb-field">
              Home team
              <select
                required
                value={form.homeTeamId}
                onChange={(e) => setField("homeTeamId", e.target.value)}
                disabled={teamsLoading || !form.competitionId}
              >
                <option value="">
                  {teamsLoading ? "Loading teams…" : "Select home team…"}
                </option>
                {homeOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="admin-sb-field">
              Away team
              <select
                required
                value={form.awayTeamId}
                onChange={(e) => setField("awayTeamId", e.target.value)}
                disabled={teamsLoading || !form.competitionId}
              >
                <option value="">
                  {teamsLoading ? "Loading teams…" : "Select away team…"}
                </option>
                {awayOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="admin-sb-gameday__datetime">
            <label className="admin-sb-field">
              Date (WAT)
              <input
                type="date"
                required
                value={form.kickoffDate}
                onChange={(e) => setField("kickoffDate", e.target.value)}
              />
            </label>
            <label className="admin-sb-field">
              Kickoff time (WAT)
              <input
                type="time"
                required
                value={form.kickoffTime}
                onChange={(e) => setField("kickoffTime", e.target.value)}
              />
            </label>
          </div>

          <p className="admin-sb-gameday__hint muted">
            Times are stored in West Africa Time ({SCOREBOARD_WAT_TZ}, UTC+1).
          </p>

          <label className="admin-sb-field">
            Venue
            <input
              value={form.venue ?? ""}
              onChange={(e) => setField("venue", e.target.value)}
              placeholder="e.g. Onikan Stadium, Lagos"
              maxLength={200}
            />
          </label>

          <div className="admin-sb-gameday__datetime">
            <label className="admin-sb-field">
              Stage key
              <input
                value={form.stageKey ?? ""}
                onChange={(e) => setField("stageKey", e.target.value)}
                placeholder="group_a, r16, grand_final…"
              />
            </label>
            <label className="admin-sb-field">
              Matchday
              <input
                type="number"
                min={1}
                value={form.matchday ?? ""}
                onChange={(e) =>
                  setField("matchday", e.target.value ? Number(e.target.value) : undefined)
                }
                placeholder="Optional"
              />
            </label>
          </div>

          <div className="admin-sb-gameday__datetime">
            <label className="admin-sb-field">
              Knockout round
              <select
                value={form.knockoutRound ?? ""}
                onChange={(e) =>
                  setField(
                    "knockoutRound",
                    (e.target.value || undefined) as AdminSbMatchInput["knockoutRound"]
                  )
                }
              >
                {KNOCKOUT_ROUNDS.map((r) => (
                  <option key={r.value || "none"} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="admin-sb-field">
              Leg
              <select
                value={form.leg ?? ""}
                onChange={(e) =>
                  setField("leg", (e.target.value || undefined) as AdminSbMatchInput["leg"])
                }
              >
                <option value="">Single leg</option>
                <option value="first_leg">First leg</option>
                <option value="second_leg">Second leg</option>
              </select>
            </label>
          </div>

          <label className="admin-sb-field">
            Round label
            <input
              value={form.roundLabel ?? ""}
              onChange={(e) => setField("roundLabel", e.target.value)}
              placeholder="Auto from knockout round if empty"
            />
          </label>

          {error && (
            <p className="admin-sb-error" role="alert">
              {error}
            </p>
          )}

          <footer className="admin-sb-modal__footer">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={
                busy ||
                !form.competitionId ||
                !form.homeTeamId ||
                !form.awayTeamId ||
                !form.kickoffDate ||
                !form.kickoffTime
              }
            >
              {busy ? "Creating…" : "Create fixture"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
