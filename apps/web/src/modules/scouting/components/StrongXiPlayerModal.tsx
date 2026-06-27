import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  apiGet,
  isAbortError,
  type PlayerSkeletonProfile,
  type PublicPlayerProfile,
} from "../../../api/client";
import { fetchStatLeaders, type StatLeaderMetric } from "../../../api/scoreboard";
import { playerProfilePath } from "../../../utils/playerSlug";
import { resolvePositionFullLabel } from "../../../utils/position";
import {
  PlayerCategoryRadar,
} from "../../directopro/components/playerProfile/PlayerCategoryRadar";
import {
  buildPerformanceRadarScores,
  buildStatLeaderHonor,
  formatStatValue,
  initialsFromName,
  isGkProfile,
  philosophyFitTier,
  philosophyFitTierClass,
  resolvePlayerAge,
  resolvePlayerClub,
} from "../utils/strongXiPlayerModalUtils";
import { PositionScoutingMetricsRow } from "./PositionScoutingMetricsRow";
import { withCalibratedMetrics } from "../utils/resolveCalibratedPlayerMetrics";

export type StrongXiPlayerSelection = {
  playerId: string;
  displayName: string;
  slotLabel: string;
  philosophyFitScore: number;
  positionFitScore: number;
  confidenceScore: number;
  photoUrl?: string | null;
  positionPrimary?: string;
  overallRating?: number;
  offensiveRating?: number;
  defensiveRating?: number;
};

type Props = {
  open: boolean;
  selection: StrongXiPlayerSelection | null;
  formation: string;
  philosophy: string;
  onClose: () => void;
};

const HONOR_METRICS: StatLeaderMetric[] = ["goals", "assists"];
const MODAL_EXIT_MS = 280;

type StatIconKind = "matches" | "goals" | "assists" | "cleanSheets";

function StatIcon({ kind }: { kind: StatIconKind }) {
  const paths: Record<StatIconKind, ReactNode> = {
    matches: (
      <path
        d="M4 6.5a2.5 2.5 0 0 1 2.5-2.5h11a2.5 2.5 0 0 1 2.5 2.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5v-11Z"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
    ),
    goals: (
      <>
        <circle cx="12" cy="12" r="7.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <path
          d="M12 4.5v15M4.5 12h15"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
      </>
    ),
    assists: (
      <>
        <path
          d="M6 16l4-4 4 4M10 12V6"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <path
          d="M16 8h4v4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </>
    ),
    cleanSheets: (
      <path
        d="M6 10.5 9.5 14 18 6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    ),
  };

  return (
    <svg
      className="strong-xi-modal__stat-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {paths[kind]}
    </svg>
  );
}

function StatChip({
  icon,
  label,
  value,
}: {
  icon: StatIconKind;
  label: string;
  value: string;
}) {
  const isEmpty = value === "—";

  return (
    <div className={`strong-xi-modal__stat${isEmpty ? " strong-xi-modal__stat--empty" : ""}`}>
      <StatIcon kind={icon} />
      <span className="strong-xi-modal__stat-value">{value}</span>
      <span className="strong-xi-modal__stat-label">{label}</span>
    </div>
  );
}

export function StrongXiPlayerModal({
  open,
  selection,
  formation,
  philosophy,
  onClose,
}: Props) {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [profile, setProfile] = useState<PublicPlayerProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [honor, setHonor] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open && selection) {
      setMounted(true);
      const frame = requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
      return () => cancelAnimationFrame(frame);
    }

    setVisible(false);
    const timer = window.setTimeout(() => setMounted(false), MODAL_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open, selection]);

  useEffect(() => {
    if (!mounted) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mounted, onClose]);

  useEffect(() => {
    if (!mounted) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, [mounted]);

  useEffect(() => {
    if (!mounted || !selection) {
      setProfile(null);
      setHonor(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setProfile(null);
    setHonor(null);
    setLoading(true);

    apiGet<PublicPlayerProfile | PlayerSkeletonProfile>(
      `/home/players/${selection.playerId}`,
      controller.signal
    )
      .then((data) => {
        if (cancelled) return;
        if (!data.isSkeleton) {
          setProfile(data);
        }
      })
      .catch((error) => {
        if (cancelled || isAbortError(error)) return;
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [mounted, selection]);

  useEffect(() => {
    if (!mounted || !profile) {
      setHonor(null);
      return;
    }

    const competition = profile.scoreboardHistory?.teams?.[0]?.competition;
    const slug = profile.slug?.trim() || selection?.playerId;
    if (!competition?.slug || !slug) {
      setHonor(null);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    Promise.all(
      HONOR_METRICS.map((metric) =>
        fetchStatLeaders(competition.slug, metric, controller.signal).catch(() => null)
      )
    ).then((responses) => {
      if (cancelled) return;
      for (const response of responses) {
        if (!response) continue;
        const leader = response.leaders.find((row) => row.rank === 1);
        if (!leader) continue;
        const matches =
          leader.playerId === profile.id ||
          leader.playerSlug === profile.slug ||
          leader.playerName.toLowerCase() === profile.displayName.toLowerCase();
        if (!matches) continue;
        const label = buildStatLeaderHonor(competition.name, response.metric, leader.rank);
        if (label) {
          setHonor(label);
          return;
        }
      }
      setHonor(null);
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [mounted, profile, selection?.playerId]);

  if (!mounted || !selection) return null;

  const mergedProfile: PublicPlayerProfile = profile ?? {
    id: selection.playerId,
    slug: null,
    displayName: selection.displayName,
    positionPrimary: selection.positionPrimary ?? "—",
    role: null,
    playerPhotoUrl: selection.photoUrl,
    overallRating: selection.overallRating ?? null,
    offensiveRating: selection.offensiveRating ?? null,
    defensiveRating: selection.defensiveRating ?? null,
  };
  const displayProfile = withCalibratedMetrics(mergedProfile);

  const photoUrl = mergedProfile.playerPhotoUrl ?? selection.photoUrl;
  const positionLabel = resolvePositionFullLabel(
    mergedProfile.positionPrimary?.trim() || selection.positionPrimary || "—",
    mergedProfile.positionFull
  );
  const isGk = isGkProfile(mergedProfile);
  const stats = mergedProfile.stats;
  const radarScores = buildPerformanceRadarScores(displayProfile);
  const profileLink = playerProfilePath({
    slug: mergedProfile.slug,
    displayName: mergedProfile.displayName,
  });

  const savedFit = mergedProfile.scoutingIntelligence?.philosophyFits?.find(
    (fit) => fit.philosophy === philosophy && fit.formation === formation
  );
  const philosophyFitScore = savedFit?.philosophyFitScore ?? selection.philosophyFitScore;
  const positionFitScore = savedFit?.positionFitScore ?? selection.positionFitScore;
  const confidenceScore = savedFit?.confidenceScore ?? selection.confidenceScore;
  const fitTierLabel = philosophyFitTier(philosophyFitScore);
  const fitTierClass = philosophyFitTierClass(philosophyFitScore);

  const topStatsSection = (
    <section
      className="strong-xi-modal__module strong-xi-modal__module--secondary-stats"
      aria-labelledby="strong-xi-modal-stats"
    >
      <h3 id="strong-xi-modal-stats">Top Stats</h3>
      {loading && !profile ? (
        <div className="strong-xi-modal__loading" aria-live="polite">
          <span className="strong-xi-modal__loading-dot" />
          <span className="strong-xi-modal__loading-dot" />
          <span className="strong-xi-modal__loading-dot" />
          <span className="strong-xi-modal__loading-text">Loading profile…</span>
        </div>
      ) : (
        <>
          <div className="strong-xi-modal__stats-grid strong-xi-modal__stats-grid--compact">
            <StatChip
              icon="matches"
              label="Matches"
              value={formatStatValue(stats?.appearances)}
            />
            <StatChip icon="goals" label="Goals" value={formatStatValue(stats?.goals)} />
            <StatChip icon="assists" label="Assists" value={formatStatValue(stats?.assists)} />
            {isGk && (
              <StatChip
                icon="cleanSheets"
                label="Clean sheets"
                value={formatStatValue(stats?.cleanSheets)}
              />
            )}
          </div>

          <div
            className={`strong-xi-modal__honor strong-xi-modal__honor--compact${honor ? "" : " strong-xi-modal__honor--empty"}`}
          >
            <svg
              className="strong-xi-modal__honor-icon"
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M8 4h8l1 4-4 2-4-2 1-4Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
                fill="none"
              />
              <path
                d="M12 10v10M8 20h8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            <div className="strong-xi-modal__honor-copy">
              <span className="strong-xi-modal__honor-label">Honors</span>
              <span className="strong-xi-modal__honor-value">
                {honor ?? "No stat leader honors yet"}
              </span>
            </div>
          </div>
        </>
      )}
    </section>
  );

  return (
    <div
      className={`strong-xi-modal-backdrop${visible ? " strong-xi-modal-backdrop--visible" : ""}`}
      role="presentation"
      onClick={onClose}
    >
      <div
        className={`strong-xi-modal${visible ? " strong-xi-modal--visible" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="strong-xi-modal__handle" aria-hidden="true" />

        <button
          type="button"
          ref={closeButtonRef}
          className="strong-xi-modal__close"
          onClick={onClose}
          aria-label="Close player details"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              d="M6 6l12 12M18 6 6 18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>

        <header className="strong-xi-modal__header">
          <div className="strong-xi-modal__header-row">
            <div className="strong-xi-modal__avatar-ring">
              <div className="strong-xi-modal__avatar" aria-hidden="true">
                {photoUrl ? (
                  <img src={photoUrl} alt="" loading="lazy" decoding="async" />
                ) : (
                  <span>{initialsFromName(selection.displayName)}</span>
                )}
              </div>
            </div>

            <div className="strong-xi-modal__header-info">
              <h2 id={titleId} className="strong-xi-modal__name">
                {selection.displayName}
              </h2>

              <div className="strong-xi-modal__header-meta">
                <span className="strong-xi-modal__position-pill">{positionLabel}</span>
                <p className="strong-xi-modal__meta">
                  <span>{resolvePlayerClub(mergedProfile)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{resolvePlayerAge(mergedProfile)}</span>
                </p>
                {selection.slotLabel && (
                  <span className="strong-xi-modal__slot">{selection.slotLabel}</span>
                )}
                <span className={`strong-xi-modal__tier-badge ${fitTierClass}`}>
                  {fitTierLabel}
                </span>
              </div>
            </div>
          </div>

          <PositionScoutingMetricsRow player={displayProfile} compact />
        </header>

        <div className="strong-xi-modal__body">
          <section className="strong-xi-modal__module" aria-labelledby="strong-xi-modal-radar">
            <h3 id="strong-xi-modal-radar">Performance Radar</h3>
            <div className="strong-xi-modal__radar-frame">
              <PlayerCategoryRadar scores={radarScores} expandLabels />
            </div>
          </section>

          <section className="strong-xi-modal__module" aria-labelledby="strong-xi-modal-tier">
            <h3 id="strong-xi-modal-tier">Scouting Tier</h3>
            <div className="strong-xi-modal__tier-card">
              <div className="strong-xi-modal__tier-highlight">
                <span className="strong-xi-modal__tier-highlight-label">Compatibility</span>
                <span className={`strong-xi-modal__tier-badge ${fitTierClass}`}>
                  {fitTierLabel}
                </span>
              </div>

              <div className="strong-xi-modal__tier-grid">
                <div className="strong-xi-modal__tier-row">
                  <span>Philosophy</span>
                  <strong>{philosophy}</strong>
                </div>
                <div className="strong-xi-modal__tier-row">
                  <span>Formation</span>
                  <strong>{formation}</strong>
                </div>
                <div className="strong-xi-modal__tier-row">
                  <span>Philosophy fit</span>
                  <strong>{formatStatValue(philosophyFitScore)}</strong>
                </div>
                <div className="strong-xi-modal__tier-row">
                  <span>Position fit</span>
                  <strong>{formatStatValue(positionFitScore)}</strong>
                </div>
                <div className="strong-xi-modal__tier-row">
                  <span>Confidence</span>
                  <strong>{formatStatValue(confidenceScore)}</strong>
                </div>
              </div>
            </div>
          </section>

          {topStatsSection}
        </div>

        <footer className="strong-xi-modal__footer">
          {profileLink ? (
            <Link to={profileLink} className="strong-xi-modal__btn strong-xi-modal__btn--profile">
              View Profile
            </Link>
          ) : (
            <span
              className="strong-xi-modal__btn strong-xi-modal__btn--profile strong-xi-modal__btn--disabled"
              aria-disabled="true"
            >
              View Profile
            </span>
          )}
          <button
            type="button"
            className="strong-xi-modal__btn strong-xi-modal__btn--ghost"
            onClick={onClose}
          >
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
