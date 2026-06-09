import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { selectBenchmarkFromPool } from "@dtp/engines/benchmark-selection";
import { useAdminToast } from "../components/AdminToast";
import { AdminPageHeader } from "../components/AdminPageHeader";
import { PlayerSlugPreview } from "../components/PlayerSlugPreview";
import { ClubNameField } from "../components/ClubNameField";
import { adminScoreboardApi } from "../../../api/admin-scoreboard";
import {
  adminApi,
  type AdminPlayerRow,
  type CalibrationBenchmarkProfile,
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

interface CalibrationInputState {
  playerInfo: PlayerInfoForm;
  metrics: LegacyMetricsForm;
}

interface CalibrationBenchmarkOutput {
  nearestBenchmark: CalibrationBenchmarkProfile | null;
  alternativeBenchmarks: CalibrationBenchmarkProfile[];
  poolSize: number;
}

const METRIC_GROUPS: { title: string; keys: readonly (keyof LegacyMetricsForm)[] }[] = [
  {
    title: "Physical Load",
    keys: [
      "duration",
      "total_distance",
      "sprint_distance",
      "sprints",
      "top_speed",
      "first_step_accelerations",
      "intense_accelerations",
    ],
  },
  {
    title: "Turn Dynamics",
    keys: [
      "intense_turns",
      "avg_turn_entry",
      "avg_turn_exit",
      "turn_efficiency",
      "left_turns",
      "right_turns",
      "back_turns",
    ],
  },
  {
    title: "Possession & Release",
    keys: [
      "ball_touches",
      "possession_duration_seconds",
      "one_touch_possessions_percentage",
      "multi_touch_possessions__percentage",
      "quick_release_score",
    ],
  },
  {
    title: "On-Ball & Striking",
    keys: ["distance_with_ball", "top_speed_with_ball", "intense_turns_with_ball", "kicking_power"],
  },
  {
    title: "Biometric Foot Distribution",
    keys: [
      "release_inside_foot_percentage",
      "release_laces_percentage",
      "release_other_footzone_percentage",
      "left_foot_touch_percentage",
      "left_foot_release_percentage",
      "left_foot_receive_percentage",
      "left_foot_kicking_power_mph",
      "right_foot_touch_percentage",
      "right_foot_release_percentage",
      "right_foot_receive_percentage",
      "right_foot_kicking_power_mph",
    ],
  },
];

function benchName(b: CalibrationBenchmarkProfile): string {
  return String(b.full_name ?? "Unknown Player");
}

export function AdminCalibrationPage() {
  usePageTitle("Admin — Calibration");
  const toast = useAdminToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const csvRef = useRef<HTMLInputElement>(null);

  const [players, setPlayers] = useState<AdminPlayerRow[]>([]);
  const [teams, setTeams] = useState<Array<{ id: string; name: string }>>([]);
  const [playerId, setPlayerId] = useState(searchParams.get("playerId") ?? "");
  const [playerInfo, setPlayerInfo] = useState<PlayerInfoForm>(emptyPlayerInfo);
  const [metrics, setMetrics] = useState<LegacyMetricsForm>(emptyLegacyMetrics);
  const [result, setResult] = useState<CalibrationRunResult | null>(null);
  const [selectedPrimaryIndex, setSelectedPrimaryIndex] = useState(0);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [csvStatus, setCsvStatus] = useState(CSV_HEADER_HINT);

  const loadPlayers = useCallback(() => {
    adminApi.players().then(setPlayers).catch(() => {});
  }, []);

  useEffect(() => {
    loadPlayers();
    adminScoreboardApi.teams().then((rows) => setTeams(rows)).catch(() => {});
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
      setSelectedPrimaryIndex(0);
      setHasGenerated(false);
    } catch (e) {
      toast.error(String(e));
    }
  }, [toast]);

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

  const inputState: CalibrationInputState = useMemo(
    () => ({ playerInfo, metrics }),
    [playerInfo, metrics]
  );

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
      setSelectedPrimaryIndex(out.primaryBenchmarkIndex ?? 0);
      setHasGenerated(true);
    } catch (e) {
      toast.error(String(e));
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
      const out = await adminApi.calibratePlayer(playerId, {
        ...body,
        save: true,
        primaryBenchmarkIndex: selectedPrimaryIndex,
      });
      setResult(out);
      setSelectedPrimaryIndex(out.primaryBenchmarkIndex ?? selectedPrimaryIndex);
      toast.success("Calibrated ratings saved to player profile.");
      loadPlayers();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setLoading(false);
    }
  };

  const createPlayer = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const body = buildPayload();
      const out = await adminApi.createCalibratedPlayer({
        ...body,
        primaryBenchmarkIndex: selectedPrimaryIndex,
      });
      setResult(out);
      setSelectedPrimaryIndex(out.primaryBenchmarkIndex ?? selectedPrimaryIndex);
      setPlayerId(out.player.id);
      setSearchParams({ playerId: out.player.id });
      toast.success(`Player "${out.player.displayName}" created with calibrated ratings.`);
      loadPlayers();
    } catch (e) {
      toast.error(String(e));
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
    setSelectedPrimaryIndex(0);
    setHasGenerated(false);
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

  const exportCsv = () => {
    const headers = LEGACY_METRIC_FIELDS.map((f) => f.key).join(",");
    const row = LEGACY_METRIC_FIELDS.map((f) => inputState.metrics[f.key] ?? "").join(",");
    const csv = `${headers}\n${row}\n`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${inputState.playerInfo.full_name || "calibration"}-metrics.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const createOrSave = async () => {
    if (playerId) {
      await saveRatings();
      return;
    }
    await createPlayer();
  };

  const rankedCandidates = useMemo(
    () => result?.rankedCandidates ?? [],
    [result?.rankedCandidates]
  );

  const benchmarkSelection = useMemo(() => {
    if (rankedCandidates.length === 0) {
      return {
        nearestBenchmark: result?.nearestBenchmark ?? null,
        alternativeBenchmarks: result?.alternativeBenchmarks ?? [],
      };
    }
    const selection = selectBenchmarkFromPool(
      rankedCandidates as Record<string, unknown>[],
      selectedPrimaryIndex
    );
    return {
      nearestBenchmark: selection.nearest as CalibrationBenchmarkProfile,
      alternativeBenchmarks: selection.alternativeBenchmarks as CalibrationBenchmarkProfile[],
    };
  }, [rankedCandidates, result?.alternativeBenchmarks, result?.nearestBenchmark, selectedPrimaryIndex]);

  const benchmarkOutput: CalibrationBenchmarkOutput = {
    nearestBenchmark: benchmarkSelection.nearestBenchmark,
    alternativeBenchmarks: benchmarkSelection.alternativeBenchmarks,
    poolSize: result?.filterInfo.poolSize ?? 0,
  };

  const setPrimaryBenchmark = (candidateIndex: number) => {
    setSelectedPrimaryIndex(candidateIndex);
  };

  const summaryMetrics = [
    {
      label: "Offensive",
      raw: result?.rawSummary.offensive_score ?? 0,
      calibrated: result?.calibratedSummary.offensive_score ?? 0,
    },
    {
      label: "Defensive",
      raw: result?.rawSummary.defensive_score ?? 0,
      calibrated: result?.calibratedSummary.defensive_score ?? 0,
    },
    {
      label: "Overall",
      raw: result?.rawSummary.overall_rating ?? 0,
      calibrated: result?.calibratedSummary.overall_rating ?? 0,
    },
  ] as const;

  const benchmarkClusters = [
    { key: "pace", label: "Pace" },
    { key: "passing", label: "Passing" },
    { key: "dribbling", label: "Dribbling" },
    { key: "finishing", label: "Finishing" },
    { key: "offensive_score", label: "Offensive" },
    { key: "defensive_score", label: "Defensive" },
  ] as const;

  const metricFieldByKey = useMemo(
    () =>
      Object.fromEntries(
        LEGACY_METRIC_FIELDS.map((field) => [field.key, field] as const)
      ) as Record<keyof LegacyMetricsForm, (typeof LEGACY_METRIC_FIELDS)[number]>,
    []
  );

  return (
    <section className="admin-page admin-sb-section admin-calibration">
      <AdminPageHeader
        title="Calibration Engine V3"
        description="Upload match performance CSV or enter player + tracking inputs. Optional on-ball fields are auto-estimated when omitted."
        crumbs={[{ label: "Calibration" }]}
      />

      <div className="admin-sb-sticky-bar">
        <div className="admin-calibration__toolbar">
          <label className="admin-sb-field admin-calibration__select">
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
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 admin-calibration-v3__layout">
        <div className="lg:col-span-5 admin-calibration__stack">
          <section className="admin-calibration__panel admin-sb-panel">
            <h2>Player identity + scouting context</h2>
            <p className="muted admin-calibration__hint">
              CSV import fills tracking metrics only. Identity context is entered below or loaded
              from an existing profile.
            </p>
            <div className="admin-calibration__fields">
              {PLAYER_FIELDS.map((f) => {
                if (f.key === "full_name") {
                  return (
                    <div
                      key={f.key}
                      className="admin-calibration__field admin-calibration__field--full"
                    >
                      <label>
                        <span>{f.label}</span>
                        <input
                          type="text"
                          placeholder={f.placeholder}
                          value={playerInfo.full_name}
                          onChange={(e) =>
                            setPlayerInfo((prev) => ({ ...prev, full_name: e.target.value }))
                          }
                        />
                      </label>
                      <PlayerSlugPreview
                        displayName={playerInfo.full_name}
                        excludeId={playerId || undefined}
                        currentSlug={players.find((p) => p.id === playerId)?.slug}
                      />
                    </div>
                  );
                }

                if (f.key === "current_club") {
                  return (
                    <div key={f.key} className="admin-calibration__field admin-calibration__field--full">
                      <label>
                        <span>Current club (from directory)</span>
                        <select
                          value=""
                          onChange={(e) => {
                            const name = e.target.value;
                            if (name) setPlayerInfo((prev) => ({ ...prev, current_club: name }));
                          }}
                        >
                          <option value="">Pick registered team…</option>
                          {teams.map((t) => (
                            <option key={t.id} value={t.name}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <ClubNameField
                        label="Or type club name"
                        value={playerInfo.current_club}
                        onChange={(v) => setPlayerInfo((prev) => ({ ...prev, current_club: v }))}
                        placeholder="FC Bethel Sporting"
                      />
                    </div>
                  );
                }

                return (
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
                );
              })}
            </div>
          </section>

          <section className="admin-calibration__panel admin-sb-panel">
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
            <div className="admin-calibration-v3__metric-groups">
              {METRIC_GROUPS.map((group) => (
                <fieldset key={group.title} className="admin-calibration-v3__metric-group">
                  <legend>{group.title}</legend>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {group.keys.map((key) => {
                      const field = metricFieldByKey[key];
                      return (
                        <label key={key} className="admin-calibration__field">
                          <span>{field.label}</span>
                          <input
                            type="number"
                            step={field.step ?? "1"}
                            value={metrics[key]}
                            onChange={(e) =>
                              setMetrics((prev) => ({ ...prev, [key]: e.target.value }))
                            }
                          />
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              ))}
            </div>
          </section>

          <div className="admin-sb-sticky-actions admin-calibration__actions admin-calibration__actions--wide">
            <button
              type="button"
              className="admin-inline-button admin-inline-button--primary"
              disabled={loading}
              onClick={generate}
            >
              Generate &amp; Calibrate
            </button>
            <button
              type="button"
              className="admin-inline-button"
              disabled={loading}
              onClick={exportCsv}
            >
              Export CSV
            </button>
            <button
              type="button"
              className="admin-inline-button"
              disabled={loading}
              onClick={createOrSave}
            >
              Create Player / Save
            </button>
            <button type="button" className="admin-link-danger" disabled={loading} onClick={clearAll}>
              Clear All
            </button>
          </div>
          {message && <p className="dtp-error-banner admin-calibration__message" role="alert">{message}</p>}
        </div>

        <section className="lg:col-span-7 admin-calibration__panel admin-calibration__results admin-sb-panel">
          {!result ? (
            <div className="admin-sb-empty-state dtp-empty-state">
              <p className="admin-sb-empty-state__title dtp-empty-state__title">
                No calibration results yet
              </p>
              <p className="muted">
                Enter player info and match data, then click <strong>Generate &amp; Calibrate</strong>.
              </p>
            </div>
          ) : (
            <>
              <div className="admin-calibration-v3__summary-banner">
                <h2>
                  {result.displayName} · {result.positionPrimary}
                </h2>
                <div className="admin-calibration-v3__summary-grid">
                  {summaryMetrics.map((item) => (
                    <div key={item.label} className="admin-calibration__mini">
                      <div className="admin-calibration__kicker">{item.label}</div>
                      <strong>{item.calibrated}</strong>
                      <small className="muted">Raw {item.raw}</small>
                    </div>
                  ))}
                </div>
              </div>

              {hasGenerated && benchmarkOutput.nearestBenchmark && (
                <div className="admin-calibration-v3__benchmark-card">
                  <h3>Nearest Real Player Benchmark Profile</h3>
                  <p className="muted">
                    Similarity is realism-adjusted with a penalty layer so calibration stays
                    grounded in plausible development pathways.
                  </p>
                  <div className="admin-calibration-v3__benchmark-head">
                    <strong>{benchName(benchmarkOutput.nearestBenchmark)}</strong>
                    <p className="muted">
                      {result.positionPrimary} •{" "}
                      {String(benchmarkOutput.nearestBenchmark.development_stage ?? "EARLY_PRO")} •
                      Overall{" "}
                      {String(benchmarkOutput.nearestBenchmark.overall_rating ?? "—")} • Similarity{" "}
                      {String(benchmarkOutput.nearestBenchmark.__similarity ?? "—")}%
                    </p>
                  </div>
                  <p className="admin-calibration-v3__disclaimer">
                    This benchmark profile is shown at the player's early professional development
                    stage, not peak career stage.
                  </p>
                  <div className="admin-calibration-v3__cluster-grid">
                    {benchmarkClusters.map((cluster) => {
                      const value = Number(benchmarkOutput.nearestBenchmark?.[cluster.key] ?? 0);
                      return (
                        <div key={cluster.key} className="admin-calibration-v3__cluster-row">
                          <div className="admin-calibration-v3__cluster-head">
                            <span>{cluster.label}</span>
                            <strong>{value || "—"}</strong>
                          </div>
                          <div className="profile-progress">
                            <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="admin-calibration-v3__filter-bar">
                    Active Filters: {inputState.playerInfo.benchmark_region || "Global"} •{" "}
                    {inputState.playerInfo.benchmark_age_band || "Auto"} • Pool:{" "}
                    {benchmarkOutput.poolSize} players
                  </div>
                  <p className="admin-calibration-v3__alt-title">Alternative Similar Players</p>
                  <ul className="admin-calibration-v3__alt-list">
                    {rankedCandidates.map((alt, i) => {
                      if (i === selectedPrimaryIndex) return null;
                      return (
                        <li key={`${benchName(alt)}-${i}`}>
                          <span>{benchName(alt)}</span>
                          <span>{String(alt.archetype ?? "Benchmark archetype")}</span>
                          <span className="admin-calibration-v3__alt-similarity">
                            {String(alt.__similarity ?? "—")}%
                          </span>
                          <button
                            type="button"
                            className="admin-inline-button admin-calibration-v3__swap-btn"
                            onClick={() => setPrimaryBenchmark(i)}
                          >
                            Set as Primary
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              <div className="admin-table-wrap admin-sb-table-wrap">
                <table className="admin-table admin-sb-table admin-calibration__table">
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
    </section>
  );
}
