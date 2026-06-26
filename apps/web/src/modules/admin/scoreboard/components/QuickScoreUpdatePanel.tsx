import { useEffect, useState } from "react";
import { adminScoreboardApi } from "../../../../api/admin-scoreboard";
import type { SbMatchListItem } from "../../../../api/scoreboard";
import { useAdminToast } from "../../components/AdminToast";
import { formatAdminScoreboardError } from "../admin-scoreboard-utils";

type Props = {
  match: SbMatchListItem;
  onSaved: (patch: {
    homeScore: number;
    awayScore: number;
    status: string;
    meta?: SbMatchListItem["meta"];
  }) => void;
};

function isKnockoutStage(stageKey: string | null | undefined) {
  return Boolean(stageKey && !stageKey.startsWith("group_"));
}

export function QuickScoreUpdatePanel({ match, onSaved }: Props) {
  const toast = useAdminToast();
  const [editing, setEditing] = useState(false);
  const [homeScore, setHomeScore] = useState(String(match.homeScore));
  const [awayScore, setAwayScore] = useState(String(match.awayScore));
  const [penaltyHome, setPenaltyHome] = useState(
    match.meta?.penaltyShootout ? String(match.meta.penaltyShootout.home) : ""
  );
  const [penaltyAway, setPenaltyAway] = useState(
    match.meta?.penaltyShootout ? String(match.meta.penaltyShootout.away) : ""
  );
  const [showPenalties, setShowPenalties] = useState(
    Boolean(match.meta?.penaltyShootout) || isKnockoutStage(match.stageKey)
  );
  const [saving, setSaving] = useState(false);

  const knockout = isKnockoutStage(match.stageKey);

  useEffect(() => {
    setHomeScore(String(match.homeScore));
    setAwayScore(String(match.awayScore));
    setPenaltyHome(
      match.meta?.penaltyShootout ? String(match.meta.penaltyShootout.home) : ""
    );
    setPenaltyAway(
      match.meta?.penaltyShootout ? String(match.meta.penaltyShootout.away) : ""
    );
    setShowPenalties(Boolean(match.meta?.penaltyShootout) || knockout);
    setEditing(false);
  }, [match.id, match.homeScore, match.awayScore, match.meta, knockout]);

  const resetForm = () => {
    setHomeScore(String(match.homeScore));
    setAwayScore(String(match.awayScore));
    setPenaltyHome(
      match.meta?.penaltyShootout ? String(match.meta.penaltyShootout.home) : ""
    );
    setPenaltyAway(
      match.meta?.penaltyShootout ? String(match.meta.penaltyShootout.away) : ""
    );
    setEditing(false);
  };

  const parseScore = (value: string, label: string) => {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new Error(`${label} must be a whole number ≥ 0`);
    }
    return Number(trimmed);
  };

  const save = async () => {
    let home: number;
    let away: number;
    try {
      home = parseScore(homeScore, "Home score");
      away = parseScore(awayScore, "Away score");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Invalid score");
      return;
    }

    const body: Parameters<typeof adminScoreboardApi.patchMatchScore>[1] = {
      homeScore: home,
      awayScore: away,
      status: "finished",
    };

    const penHomeTrim = penaltyHome.trim();
    const penAwayTrim = penaltyAway.trim();
    const hasPenHome = penHomeTrim.length > 0;
    const hasPenAway = penAwayTrim.length > 0;

    if (hasPenHome !== hasPenAway) {
      toast.error("Enter both penalty shootout scores, or leave both blank");
      return;
    }

    if (hasPenHome && hasPenAway) {
      try {
        body.penaltyHome = parseScore(penHomeTrim, "Home penalties");
        body.penaltyAway = parseScore(penAwayTrim, "Away penalties");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Invalid penalty score");
        return;
      }
    }

    setSaving(true);
    try {
      const res = await adminScoreboardApi.patchMatchScore(match.id, body);
      toast.success("Final score saved — standings will refresh for group fixtures");
      const meta = { ...(match.meta ?? {}) };
      if (res.penaltyShootout) {
        meta.penaltyShootout = res.penaltyShootout;
        meta.regulationScore = { home: res.homeScore, away: res.awayScore };
      }
      onSaved({
        homeScore: res.homeScore,
        awayScore: res.awayScore,
        status: res.status,
        meta: Object.keys(meta).length ? meta : null,
      });
      setEditing(false);
    } catch (e) {
      toast.error(formatAdminScoreboardError(e));
    } finally {
      setSaving(false);
    }
  };

  const penaltyLabel = match.meta?.penaltyShootout
    ? `Pens ${match.meta.penaltyShootout.home}–${match.meta.penaltyShootout.away}`
    : null;

  return (
    <div className="admin-sb-score-update admin-sb-panel">
      <div className="admin-sb-score-update__header">
        <div>
          <h3 className="admin-sb-score-update__title">Quick score update</h3>
          <p className="admin-sb-score-update__subtitle muted">
            Set the final result without uploading a match events CSV.
            {knockout ? " Penalty shootout optional for knockout ties." : ""}
          </p>
        </div>
        {!editing ? (
          <button
            type="button"
            className="admin-inline-button"
            onClick={() => setEditing(true)}
          >
            {match.status === "finished" ? "Edit score" : "Set score"}
          </button>
        ) : null}
      </div>

      {!editing ? (
        <dl className="admin-sb-score-update__summary">
          <div>
            <dt>Result</dt>
            <dd>
              {match.homeTeam.name} {match.homeScore} – {match.awayScore}{" "}
              {match.awayTeam.name}
            </dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{match.status === "finished" ? "Finished" : match.status}</dd>
          </div>
          {penaltyLabel ? (
            <div>
              <dt>Shootout</dt>
              <dd>{penaltyLabel}</dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <form
          className="admin-sb-score-update__form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="admin-sb-score-update__scores">
            <label className="admin-sb-score-update__field">
              <span>{match.homeTeam.name}</span>
              <input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={homeScore}
                onChange={(e) => setHomeScore(e.target.value)}
                required
                autoComplete="off"
              />
            </label>
            <span className="admin-sb-score-update__sep" aria-hidden="true">
              –
            </span>
            <label className="admin-sb-score-update__field">
              <span>{match.awayTeam.name}</span>
              <input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={awayScore}
                onChange={(e) => setAwayScore(e.target.value)}
                required
                autoComplete="off"
              />
            </label>
          </div>

          {(knockout || showPenalties) && (
            <div className="admin-sb-score-update__penalties">
              <label className="admin-sb-score-update__toggle">
                <input
                  type="checkbox"
                  checked={showPenalties}
                  onChange={(e) => setShowPenalties(e.target.checked)}
                />
                <span>Penalty shootout (knockout)</span>
              </label>
              {showPenalties ? (
                <div className="admin-sb-score-update__scores admin-sb-score-update__scores--penalties">
                  <label className="admin-sb-score-update__field">
                    <span>Home pens</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      value={penaltyHome}
                      onChange={(e) => setPenaltyHome(e.target.value)}
                      autoComplete="off"
                    />
                  </label>
                  <span className="admin-sb-score-update__sep" aria-hidden="true">
                    –
                  </span>
                  <label className="admin-sb-score-update__field">
                    <span>Away pens</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      value={penaltyAway}
                      onChange={(e) => setPenaltyAway(e.target.value)}
                      autoComplete="off"
                    />
                  </label>
                </div>
              ) : null}
            </div>
          )}

          <p className="admin-sb-score-update__hint muted">
            Match is marked finished on save. No timeline events or stats narrative are
            required.
          </p>
          <div className="admin-sb-form-actions">
            <button
              type="submit"
              className="admin-inline-button admin-inline-button--primary"
              disabled={saving}
            >
              {saving ? "Saving…" : "Save final score"}
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
