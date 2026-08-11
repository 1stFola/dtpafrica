import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@dtp/ui";
import { BenchmarkPlayerHeadshot } from "./BenchmarkPlayerHeadshot";
import { benchmarkNameFromRecord } from "../utils/benchmarkPlayerHeadshot";

const ATTRIBUTE_GROUPS = [
  {
    title: "Physical / Athletic",
    keys: ["pace", "acceleration", "sprint_speed", "stamina", "strength", "agility"],
  },
  {
    title: "Technical",
    keys: ["dribbling", "ball_control", "passing", "finishing", "technique", "first_touch"],
  },
  {
    title: "Mental",
    keys: ["vision", "composure", "decision_making"],
  },
  {
    title: "Tactical / Team Impact",
    keys: ["work_rate", "positioning", "team_play"],
  },
] as const;

const ATTRIBUTE_LABELS: Record<string, string> = {
  pace: "Pace",
  acceleration: "Acceleration",
  sprint_speed: "Sprint speed",
  stamina: "Stamina",
  strength: "Strength",
  agility: "Agility",
  dribbling: "Dribbling",
  ball_control: "Ball control",
  passing: "Passing",
  finishing: "Finishing",
  technique: "Technique",
  first_touch: "First touch",
  vision: "Vision",
  composure: "Composure",
  decision_making: "Decision making",
  work_rate: "Work rate",
  positioning: "Positioning",
  team_play: "Team play",
};

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function numberFrom(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key];
  return isNumber(value) ? value : null;
}

function benchmarkName(benchmark: Record<string, unknown>) {
  return benchmarkNameFromRecord(benchmark);
}

function similarityPercent(benchmark: Record<string, unknown>) {
  const value = benchmark.__similarity;
  return isNumber(value) ? clampScore(value) : null;
}

function benchmarkTacticalRole(benchmark: Record<string, unknown>) {
  const candidates = [
    benchmark.tactical_role,
    benchmark.tacticalRole,
    benchmark.position,
    benchmark.role,
    benchmark.archetype,
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return null;
}

function initialsFromName(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

type PlaystyleComparisonModalProps = {
  open: boolean;
  onClose: () => void;
  playerName: string;
  playerPhotoUrl?: string | null;
  benchmark: Record<string, unknown>;
  attributes: Record<string, number>;
};

function PlaystyleComparisonModal({
  open,
  onClose,
  playerName,
  playerPhotoUrl,
  benchmark,
  attributes,
}: PlaystyleComparisonModalProps) {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const benchLabel = benchmarkName(benchmark);
  const similarity = similarityPercent(benchmark) ?? "—";

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // Move focus into the dialog on open, and restore it to the trigger on close.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  /* Rendered through a portal on <body>. Inline, the dialog sat inside
     `.player-profile-body-sheet`, which sets `position: relative; z-index: 0`
     and so opens a stacking context — the backdrop's z-index 120 was scoped
     inside a layer stacked at 0, leaving the whole modal (and its close button)
     underneath the sticky nav at z-index 60. A portal puts it at the document
     root where its own z-index actually applies. */
  return createPortal(
    <div
      className="playstyle-modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="playstyle-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          ref={closeButtonRef}
          className="playstyle-modal__close"
          onClick={onClose}
          aria-label="Close playstyle comparison"
        >
          ×
        </button>

        <header className="playstyle-modal__header">
          <div className="playstyle-modal__profile playstyle-modal__profile--player">
            <div className="playstyle-modal__badge playstyle-modal__badge--player">
              <div className="playstyle-modal__identity">
                <div className="playstyle-modal__photo playstyle-modal__photo--player">
                  {playerPhotoUrl ? (
                    <img src={playerPhotoUrl} alt="" loading="lazy" decoding="async" />
                  ) : (
                    <span className="playstyle-modal__photo-fallback" aria-hidden="true">
                      {initialsFromName(playerName)}
                    </span>
                  )}
                </div>
                <div className="playstyle-modal__name">
                  <span className="playstyle-modal__badge-label">Player</span>
                  <strong>{playerName}</strong>
                </div>
              </div>
            </div>
          </div>
          <div className="playstyle-modal__profile playstyle-modal__profile--benchmark">
            <div className="playstyle-modal__badge playstyle-modal__badge--benchmark">
              <div className="playstyle-modal__identity">
                <BenchmarkPlayerHeadshot
                  playerName={benchLabel}
                  className="playstyle-modal__photo playstyle-modal__photo--benchmark"
                />
                <div className="playstyle-modal__name">
                  <span className="playstyle-modal__badge-label">Benchmark</span>
                  <strong>{benchLabel}</strong>
                </div>
              </div>
            </div>
          </div>
        </header>

        <div className="playstyle-modal__banner">
          <h2 id={titleId}>Benchmark Similarity: {similarity}%</h2>
          <p>
            This comparison maps <strong>{playerName}</strong> against the early-professional
            benchmark profile of <strong>{benchLabel}</strong> to show how
            closely the player&apos;s calibrated attributes align at a comparable development
            stage.
          </p>
          <p className="playstyle-modal__banner-sub">
            The similarity percentage reflects how closely attribute scores match early pro
            development metrics for this position—not peak career output.
          </p>
        </div>

        <div className="playstyle-modal__body">
          <div className="playstyle-modal__legend" aria-hidden>
            <span>
              <i className="playstyle-modal__dot playstyle-modal__dot--player" />
              Player
            </span>
            <span>
              <i className="playstyle-modal__dot playstyle-modal__dot--benchmark" />
              Benchmark
            </span>
          </div>

          {ATTRIBUTE_GROUPS.map((group) => (
            <section key={group.title} className="playstyle-modal__group">
              <h3>{group.title}</h3>
              <ul className="playstyle-modal__rows">
                {group.keys.map((key) => {
                  const playerScore = clampScore(attributes[key] ?? 0);
                  const rawBenchmark = numberFrom(benchmark, key);
                  const benchmarkScore =
                    rawBenchmark == null ? null : clampScore(rawBenchmark);

                  return (
                    <li key={key} className="playstyle-compare-row">
                      <span className="playstyle-compare-row__label">
                        {ATTRIBUTE_LABELS[key]}
                      </span>
                      <div className="playstyle-compare-row__bars">
                        <div className="playstyle-dual-bar">
                          <div className="playstyle-dual-bar__track">
                            <span
                              className="playstyle-dual-bar__fill playstyle-dual-bar__fill--player"
                              style={{ width: `${playerScore}%` }}
                            />
                          </div>
                          <strong className="playstyle-dual-bar__value playstyle-dual-bar__value--player">
                            {playerScore}
                          </strong>
                        </div>
                        <div className="playstyle-dual-bar">
                          <div className="playstyle-dual-bar__track">
                            <span
                              className="playstyle-dual-bar__fill playstyle-dual-bar__fill--benchmark"
                              style={{
                                width: `${benchmarkScore ?? 0}%`,
                              }}
                            />
                          </div>
                          <strong className="playstyle-dual-bar__value playstyle-dual-bar__value--benchmark">
                            {benchmarkScore == null ? "N/A" : benchmarkScore}
                          </strong>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        <footer className="playstyle-modal__footer">
          <h3>How Similarity Works</h3>
          <p>
            Similarity is calculated from a weighted distance across all 18 calibrated profile
            attributes, then converted to a percentage score. Ratings are adjusted for position,
            development stage, and realism penalties so comparisons stay grounded in plausible
            early-professional pathways rather than peak-career outliers.
          </p>
          <p>
            When benchmark attribute values are missing for a field, that row shows N/A for the
            benchmark bar while the player score still reflects calibrated or derived profile data.
          </p>
        </footer>
      </div>
    </div>,
    document.body
  );
}

export function BenchmarkPlaystyleComparison({
  playerName,
  playerPhotoUrl,
  benchmark,
  attributes,
}: {
  playerName: string;
  playerPhotoUrl?: string | null;
  benchmark: Record<string, unknown> | null;
  attributes: Record<string, number>;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  if (!benchmark) {
    return (
      <article className="profile-panel profile-benchmark player-profile-playstyle-comparison">
        <h3>Playstyle comparison</h3>
        <p className="muted">
          Playstyle comparison will appear after calibration saves nearest-pro metadata for this
          player.
        </p>
      </article>
    );
  }

  const benchLabel = benchmarkName(benchmark);
  const similarity = similarityPercent(benchmark);
  const tacticalRole = benchmarkTacticalRole(benchmark);

  return (
    <>
      <article className="profile-panel profile-benchmark player-profile-playstyle-comparison">
        <div className="player-profile-playstyle-comparison__inner">
          <div className="player-profile-playstyle-comparison__left">
            <span className="player-profile-eyebrow">Playstyle comparison</span>
            <p className="muted player-profile-playstyle-comparison__copy">
              Compared with {benchLabel}
              {tacticalRole ? ` · ${tacticalRole}` : ""}
              {similarity != null ? ` · ${similarity}% similarity` : ""}
            </p>
          </div>
          <div className="player-profile-playstyle-comparison__right">
            <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
              View Playstyle Comparison
            </Button>
            <BenchmarkPlayerHeadshot
              playerName={benchLabel}
              className="player-profile-playstyle-comparison__headshot"
            />
          </div>
        </div>
      </article>

      <PlaystyleComparisonModal
        open={open}
        onClose={close}
        playerName={playerName}
        playerPhotoUrl={playerPhotoUrl}
        benchmark={benchmark}
        attributes={attributes}
      />
    </>
  );
}
