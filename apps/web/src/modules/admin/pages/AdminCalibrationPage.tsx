import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  adminApi,
  type AdminPlayerRow,
  type CalibrationRunResult,
} from "../../../api/admin";
import { usePageTitle } from "../../../hooks/usePageTitle";
import {
  CSV_HEADER_HINT,
  LEGACY_METRIC_FIELDS,
  PLAYER_FIELDS,
  contextToPlayerInfo,
  emptyLegacyMetrics,
  emptyPlayerInfo,
  legacyMetricsFromApi,
  legacyMetricsFromForm,
  parseCalibrationCsv,
  playerInfoToApiPayload,
  type LegacyMetricsForm,
  type PlayerInfoForm,
} from "../calibration/form-utils";

const CAL_ATTRS = [
  "pace",
  "acceleration",
  "sprint_speed",
  "stamina",
  "strength",
  "agility",
  "dribbling",
  "ball_control",
  "passing",
  "finishing",
  "technique",
  "first_touch",
  "vision",
  "composure",
  "decision_making",
  "work_rate",
  "positioning",
  "team_play",
] as const;

function benchName(b: Record<string, unknown>): string {
  return String(b.full_name ?? "—");
}

export function AdminCalibrationPage() {
  usePageTitle("Admin — Calibration");
  const [searchParams, setSearchParams] = useSearchParams();
  const csvRef = useRef<HTMLInputElement>(null);

  const [players, setPlayers] = useState<AdminPlayerRow[]>([]);
  const [playerId, setPlayerId] = useState(searchParams.get("playerId") ?? "");
  const [playerInfo, setPlayerInfo] = useState<PlayerInfoForm>(emptyPlayerInfo);
  const [metrics, setMetrics] = useState<LegacyMetricsForm>(emptyLegacyMetrics);
  const [result, setResult] = useState<CalibrationRunResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [csvStatus, setCsvStatus] = useState(CSV_HEADER_HINT);

  const loadPlayers = useCallback(() => {
    adminApi.players().then(setPlayers).catch(() => {});
  }, []);

  useEffect(() => {
    loadPlayers();
  }, [loadPlayers]);

  useEffect(() => {
    const id = searchParams.get("playerId");
    if (id) setPlayerId(id);
  }, [searchParams]);

  const loadPlayer = useCallback(async (id: string) => {
    if (!id) return;
    setMessage(null);
    try {
      const ctx = await adminApi.calibrationContext(id);
      setPlayerInfo(contextToPlayerInfo(ctx.player));
      setMetrics(ctx.metrics ? legacyMetricsFromApi(ctx.metrics) : emptyLegacyMetrics());
      setResult(null);
    } catch (e) {
      setMessage(String(e));
    }
  }, []);

  useEffect(() => {
    if (playerId) loadPlayer(playerId);
  }, [playerId, loadPlayer]);

  const onSelectPlayer = (id: string) => {
    setPlayerId(id);
    if (id) {
      setSearchParams({ playerId: id });
    } else {
      setSearchParams({});
    }
  };

  const buildPayload = () => ({
    player: playerInfoToApiPayload(playerInfo),
    metrics: legacyMetricsFromForm(metrics),
  });

  const generate = async () => {
    if (!playerInfo.full_name.trim()) {
      setMessage("Enter the player's full name.");
      return;
    }
    if (!playerInfo.position) {
      setMessage("Select a position.");
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const body = buildPayload();
      const out = await adminApi.calibrationPreview({
        ...body,
        playerId: playerId || undefined,
      });
      setResult(out);
    } catch (e) {
      setMessage(String(e));
    } finally {
      setLoading(false);
    }
  };

  const saveRatings = async () => {
    if (!playerId) {
      setMessage("Select an existing player, or use Create Player for new profiles.");
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const body = buildPayload();
      const out = await adminApi.calibratePlayer(playerId, { ...body, save: true });
      setResult(out);
      setMessage("Calibrated ratings saved to player profile.");
      loadPlayers();
    } catch (e) {
      setMessage(String(e));
    } finally {
      setLoading(false);
    }
  };

  const createPlayer = async () => {
    if (!result) {
      setMessage("Generate ratings first.");
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const body = buildPayload();
      const out = await adminApi.createCalibratedPlayer(body);
      setResult(out);
      setPlayerId(out.player.id);
      setSearchParams({ playerId: out.player.id });
      setMessage(`Player "${out.player.displayName}" created with calibrated ratings.`);
      loadPlayers();
    } catch (e) {
      setMessage(String(e));
    } finally {
      setLoading(false);
    }
  };

  const clearAll = () => {
    if (!window.confirm("Clear all fields and reset? This cannot be undone.")) return;
    setPlayerId("");
    setSearchParams({});
    setPlayerInfo(emptyPlayerInfo());
    setMetrics(emptyLegacyMetrics());
    setResult(null);
    setMessage(null);
    setCsvStatus(CSV_HEADER_HINT);
    if (csvRef.current) csvRef.current.value = "";
  };

  const onCsvUpload = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = String(ev.target?.result ?? "");
      const data = parseCalibrationCsv(text);
      if (!data) {
        setCsvStatus("Invalid CSV format — need header row and one data row.");
        return;
      }
      setMetrics((prev) => {
        const next = { ...prev };
        (Object.keys(next) as (keyof LegacyMetricsForm)[]).forEach((k) => {
          if (data[k] !== undefined) next[k] = data[k];
        });
        return next;
      });
      setCsvStatus("CSV loaded successfully.");
    };
    reader.readAsText(file);
  };

  const nearest = result?.nearestBenchmark ?? null;
  const alts = result?.alternativeBenchmarks ?? [];

  return (
    <div className="admin-page admin-calibration">
      <header className="page-header">
        <h1>DirectToPro Calibration Engine</h1>
        <p className="muted">
          Upload match performance CSV or enter player info + tracking data. Missing on-ball
          fields are estimated by the engine.
        </p>
      </header>

      <div className="admin-calibration__toolbar">
        <label className="admin-calibration__select">
          <span>Load existing player (optional)</span>
          <select value={playerId} onChange={(e) => onSelectPlayer(e.target.value)}>
            <option value="">New entry / manual…</option>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName} ({p.positionPrimary})
                {p.overallRating != null ? ` · OVR ${p.overallRating}` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="admin-calibration__grid">
        <div className="admin-calibration__stack">
          <section className="admin-calibration__panel">
            <h2>Player info</h2>
            <p className="muted admin-calibration__hint">
              Match Performance Data CSV fills metrics only — enter player details below or load
              an existing profile.
            </p>
            <div className="admin-calibration__fields">
              {PLAYER_FIELDS.map((f) => (
                <label
                  key={f.key}
                  className={
                    f.full
                      ? "admin-calibration__field admin-calibration__field--full"
                      : "admin-calibration__field"
                  }
                >
                  <span>{f.label}</span>
                  {f.type === "select" ? (
                    <select
                      value={playerInfo[f.key]}
                      onChange={(e) =>
                        setPlayerInfo((prev) => ({ ...prev, [f.key]: e.target.value }))
                      }
                    >
                      <option value="">Select {f.label}</option>
                      {f.options?.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={f.type}
                      placeholder={f.placeholder}
                      value={playerInfo[f.key]}
                      onChange={(e) =>
                        setPlayerInfo((prev) => ({ ...prev, [f.key]: e.target.value }))
                      }
                    />
                  )}
                </label>
              ))}
            </div>
          </section>

          <section className="admin-calibration__panel">
            <h2>Match performance data</h2>
            <div className="admin-calibration__csv">
              <label className="admin-calibration__csv-upload">
                <span>Upload Match Performance CSV</span>
                <input
                  ref={csvRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => onCsvUpload(e.target.files?.[0])}
                />
              </label>
              <p className="muted admin-calibration__csv-hint">{csvStatus}</p>
            </div>
            <div className="admin-calibration__fields">
              {LEGACY_METRIC_FIELDS.map((f) => (
                <label
                  key={f.key}
                  className={
                    f.full
                      ? "admin-calibration__field admin-calibration__field--full"
                      : "admin-calibration__field"
                  }
                >
                  <span>{f.label}</span>
                  <input
                    type="number"
                    step={f.step ?? "1"}
                    value={metrics[f.key]}
                    onChange={(e) =>
                      setMetrics((prev) => ({ ...prev, [f.key]: e.target.value }))
                    }
                  />
                </label>
              ))}
            </div>
          </section>

          <div className="admin-calibration__actions admin-calibration__actions--wide">
            <button
              type="button"
              className="dtp-btn dtp-btn--primary"
              disabled={loading}
              onClick={generate}
            >
              Generate ratings
            </button>
            <button
              type="button"
              className="dtp-btn dtp-btn--secondary"
              disabled={loading || !playerId}
              onClick={saveRatings}
            >
              Save to existing player
            </button>
            <button
              type="button"
              className="dtp-btn dtp-btn--secondary"
              disabled={loading || !result}
              onClick={createPlayer}
            >
              Create player
            </button>
            <button type="button" className="admin-logout" disabled={loading} onClick={clearAll}>
              Clear all
            </button>
          </div>
          {message && <p className="admin-calibration__message">{message}</p>}
        </div>

        <section className="admin-calibration__panel admin-calibration__results">
          {!result ? (
            <p className="muted admin-calibration__empty">
              Enter player info and match data, then click <strong>Generate ratings</strong>.
            </p>
          ) : (
            <>
              <h2>
                {result.displayName} · {result.positionPrimary}
              </h2>

              <div className="admin-calibration__summary admin-calibration__summary--6">
                {[
                  { label: "Raw OFF", value: result.rawSummary.offensive_score },
                  { label: "Raw DEF", value: result.rawSummary.defensive_score },
                  { label: "Raw OVR", value: result.rawSummary.overall_rating },
                  { label: "Cal OFF", value: result.calibratedSummary.offensive_score },
                  { label: "Cal DEF", value: result.calibratedSummary.defensive_score },
                  { label: "Cal OVR", value: result.calibratedSummary.overall_rating },
                ].map((item) => (
                  <div key={item.label} className="admin-calibration__mini">
                    <div className="admin-calibration__kicker">{item.label}</div>
                    <strong>{item.value}</strong>
                  </div>
                ))}
              </div>

              {nearest && (
                <div className="admin-calibration__benchmark">
                  <h3>Nearest pro benchmark</h3>
                  <p>
                    <strong>{benchName(nearest)}</strong>
                    {" · "}
                    {String(nearest.archetype ?? "")}
                    {" · "}
                    Similarity {String(nearest.__similarity ?? "—")}%
                  </p>
                  <p className="muted">
                    Pool: {result.filterInfo.poolSize} early-pro profiles. On-ball gaps are filled
                    by the engine when CSV omits advanced fields.
                  </p>
                  {alts.length > 0 && (
                    <ul className="admin-calibration__alts">
                      {alts.map((alt, i) => (
                        <li key={i}>
                          {benchName(alt)} · {String(alt.archetype ?? "")} ·{" "}
                          {String(alt.__similarity ?? "—")}%
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <div className="admin-table-wrap">
                <table className="sip-table admin-calibration__table">
                  <thead>
                    <tr>
                      <th>Attribute</th>
                      <th>Raw</th>
                      <th>Calibrated</th>
                      <th>Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CAL_ATTRS.map((attr) => {
                      const raw = result.raw[attr] ?? 0;
                      const cal = result.calibrated[attr] ?? 0;
                      const delta = cal - raw;
                      return (
                        <tr key={attr}>
                          <td>{attr.replace(/_/g, " ")}</td>
                          <td>{raw}</td>
                          <td>
                            <strong>{cal}</strong>
                          </td>
                          <td className={delta >= 0 ? "pos" : "neg"}>
                            {delta > 0 ? `+${delta}` : delta}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {result.playerId && (
                <p className="muted">
                  <Link to={`/admin/players`} className="text-link">
                    View in Players
                  </Link>
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
