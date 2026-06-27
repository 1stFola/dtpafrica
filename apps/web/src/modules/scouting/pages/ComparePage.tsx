import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  apiGet,
  isAbortError,
  type ComparisonResponse,
  type PublicPlayerProfile,
} from "../../../api/client";
import { playerProfilePath } from "../../../utils/playerSlug";
import { resolvePositionFullLabel } from "../../../utils/position";
import { CompareMetricBars } from "../components/CompareMetricBars";
import { CompareRadarOverlay } from "../components/CompareRadarOverlay";
import {
  ScoutingPlayerSearchPicker,
  type ScoutingSearchPlayer,
} from "../components/ScoutingPlayerSearchPicker";
import {
  buildPerformanceRadarScores,
  initialsFromName,
  resolvePlayerAge,
  resolvePlayerClub,
} from "../utils/strongXiPlayerModalUtils";
import { withCalibratedMetrics } from "../utils/resolveCalibratedPlayerMetrics";

const MAX_PLAYERS = 4;
const MIN_PLAYERS = 2;

const TACTICAL_LABELS: Record<string, string> = {
  gegenpressScore: "Gegenpress",
  tikiTakaScore: "Tiki-taka",
  counterAttackScore: "Counter attack",
  totalFootballScore: "Total football",
  highLineScore: "High line",
  wingerScore: "Winger play",
  lowBlockScore: "Low block",
  pressResistanceScore: "Press resistance",
  possessionHubScore: "Possession hub",
  isolationThreatScore: "Isolation threat",
  twoFootednessScore: "Two-footedness",
};

const RATING_LABELS: Record<string, string> = {
  overallRating: "Overall",
  offensiveRating: "Offensive",
  defensiveRating: "Defensive",
};

type SelectedPlayer = ScoutingSearchPlayer;

export function ComparePage() {
  const [selected, setSelected] = useState<SelectedPlayer[]>([]);
  const [profiles, setProfiles] = useState<PublicPlayerProfile[]>([]);
  const [comparison, setComparison] = useState<ComparisonResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedIds = useMemo(() => selected.map((p) => p.id), [selected]);

  const addPlayer = useCallback((player: ScoutingSearchPlayer) => {
    setSelected((prev) => {
      if (prev.some((p) => p.id === player.id) || prev.length >= MAX_PLAYERS) {
        return prev;
      }
      return [...prev, player];
    });
    setError(null);
  }, []);

  const removePlayer = useCallback((playerId: string) => {
    setSelected((prev) => prev.filter((p) => p.id !== playerId));
    setError(null);
  }, []);

  const clearAll = useCallback(() => {
    setSelected([]);
    setProfiles([]);
    setComparison(null);
    setError(null);
  }, []);

  useEffect(() => {
    if (selected.length < MIN_PLAYERS) {
      setProfiles([]);
      setComparison(null);
      return;
    }

    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);

    Promise.all([
      Promise.all(
        selected.map((player) =>
          apiGet<PublicPlayerProfile>(`/home/players/${player.id}`, controller.signal)
        )
      ),
      apiGet<ComparisonResponse>(
        `/scouting/player-comparison?ids=${selectedIds.join(",")}`,
        controller.signal
      ),
    ])
      .then(([profileRows, comparisonResult]) => {
        if (!active) return;
        const orderedProfiles = selectedIds
          .map((id) => profileRows.find((p) => p.id === id))
          .filter((p): p is PublicPlayerProfile => p != null);
        setProfiles(orderedProfiles);
        setComparison(comparisonResult);
      })
      .catch((e) => {
        if (!active || isAbortError(e)) return;
        setProfiles([]);
        setComparison(null);
        setError(
          e instanceof Error
            ? e.message
            : "Could not load comparison. Players need scouting intelligence data."
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [selected, selectedIds]);

  const radarSeries = useMemo(
    () =>
      profiles.map((player) => ({
        playerId: player.id,
        displayName: player.displayName,
        scores: buildPerformanceRadarScores(withCalibratedMetrics(player)),
      })),
    [profiles]
  );

  const ratingMetrics = useMemo(() => {
    if (!comparison) return [];
    return ["overallRating", "offensiveRating", "defensiveRating"].map((key) => ({
      key,
      label: RATING_LABELS[key] ?? key,
      values: comparison.values[key] ?? [],
    }));
  }, [comparison]);

  const tacticalMetrics = useMemo(() => {
    if (!comparison) return [];
    const keys = comparison.metrics.filter((key) => TACTICAL_LABELS[key]);
    return keys.map((key) => ({
      key,
      label: TACTICAL_LABELS[key] ?? key,
      values: comparison.values[key] ?? [],
    }));
  }, [comparison]);

  const playerNames = profiles.map((p) => p.displayName);

  return (
    <div className="scouting-compare">
      <header className="scouting-compare__header">
        <div>
          <h2 className="scouting-compare__title">Player comparison</h2>
          <p className="muted scouting-compare__lede">
            Search and compare {MIN_PLAYERS}–{MAX_PLAYERS} players with attribute radar overlays
            and rating bars.
          </p>
        </div>
        {selected.length > 0 && (
          <button type="button" className="dtp-btn dtp-btn--secondary" onClick={clearAll}>
            Clear all
          </button>
        )}
      </header>

      <section className="scouting-compare__picker-panel">
        <ScoutingPlayerSearchPicker
          excludeIds={selectedIds}
          maxPlayers={MAX_PLAYERS}
          disabled={loading}
          onAdd={addPlayer}
        />

        {selected.length > 0 ? (
          <ul className="scouting-compare__slots" aria-label="Selected players">
            {selected.map((player, index) => (
              <li key={player.id} className="scouting-compare__slot">
                <span
                  className="scouting-compare__slot-swatch"
                  style={{
                    background:
                      ["#22d3ee", "#f59e0b", "#34d399", "#a78bfa"][index % 4],
                  }}
                  aria-hidden="true"
                />
                <div className="scouting-compare__slot-body">
                  <strong>{player.displayName}</strong>
                  <span className="muted">
                    {player.positionPrimary}
                    {player.overallRating != null ? ` · OVR ${player.overallRating}` : ""}
                  </span>
                </div>
                <button
                  type="button"
                  className="scouting-compare__slot-remove"
                  aria-label={`Remove ${player.displayName}`}
                  onClick={() => removePlayer(player.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="scouting-compare__hint muted">
            Add at least {MIN_PLAYERS} players to start comparing.
          </p>
        )}
      </section>

      {selected.length >= MIN_PLAYERS && loading && (
        <p className="scouting-compare__status muted" role="status">
          Loading comparison…
        </p>
      )}

      {error && <p className="scouting-compare__error sip-error">{error}</p>}

      {profiles.length >= MIN_PLAYERS && !loading && (
        <div className="scouting-compare__dashboard">
          <section className="scouting-compare__cards" aria-label="Player overview">
            {profiles.map((player, index) => (
              <article key={player.id} className="scouting-compare__card">
                <div className="scouting-compare__card-media">
                  {player.playerPhotoUrl ? (
                    <img src={player.playerPhotoUrl} alt="" loading="lazy" />
                  ) : (
                    <span className="scouting-compare__card-initials" aria-hidden="true">
                      {initialsFromName(player.displayName)}
                    </span>
                  )}
                </div>
                <div className="scouting-compare__card-body">
                  <h3>{player.displayName}</h3>
                  <p className="muted">
                    {resolvePositionFullLabel(player.positionPrimary)}
                  </p>
                  <dl className="scouting-compare__card-meta">
                    <div>
                      <dt>Age</dt>
                      <dd>{resolvePlayerAge(player)}</dd>
                    </div>
                    <div>
                      <dt>Club</dt>
                      <dd>{resolvePlayerClub(player)}</dd>
                    </div>
                    <div>
                      <dt>OVR</dt>
                      <dd>{player.overallRating ?? "—"}</dd>
                    </div>
                  </dl>
                  {(() => {
                    const profilePath = playerProfilePath(player);
                    return profilePath ? (
                      <Link to={profilePath} className="scouting-compare__card-link">
                        View profile
                      </Link>
                    ) : null;
                  })()}
                </div>
                <span
                  className="scouting-compare__card-accent"
                  style={{
                    background:
                      ["#22d3ee", "#f59e0b", "#34d399", "#a78bfa"][index % 4],
                  }}
                  aria-hidden="true"
                />
              </article>
            ))}
          </section>

          <section className="scouting-compare__panel scouting-compare__panel--radar">
            <h3 className="scouting-compare__section-title">Attribute radar</h3>
            <p className="muted scouting-compare__panel-lede">
              Overlay of pace, passing, technical, physical, and defending categories.
            </p>
            <CompareRadarOverlay series={radarSeries} />
          </section>

          {ratingMetrics.length > 0 && (
            <CompareMetricBars
              title="Overall ratings"
              metrics={ratingMetrics}
              playerNames={playerNames}
            />
          )}

          {tacticalMetrics.length > 0 && (
            <CompareMetricBars
              title="Tactical intelligence"
              metrics={tacticalMetrics}
              playerNames={playerNames}
            />
          )}
        </div>
      )}
    </div>
  );
}
