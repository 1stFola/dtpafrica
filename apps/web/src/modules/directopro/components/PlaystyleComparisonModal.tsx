import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@dtp/ui";

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
  return String(benchmark.full_name ?? benchmark.playerName ?? "Benchmark profile");
}

function readBenchmarkOverall(benchmark: Record<string, unknown>) {
  const value = benchmark.overall_rating ?? benchmark.overallRating;
  return isNumber(value) ? clampScore(value) : null;
}

function similarityPercent(benchmark: Record<string, unknown>) {
  const value = benchmark.__similarity;
  return isNumber(value) ? clampScore(value) : null;
}

function ageFromDateOfBirth(dob: unknown) {
  if (typeof dob !== "string" || !dob) return null;
  const born = new Date(dob);
  if (Number.isNaN(born.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - born.getFullYear();
  const monthDelta = today.getMonth() - born.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < born.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

function formatAgeLabel(playerAge?: number | null, benchmark?: Record<string, unknown>) {
  if (playerAge != null) return String(playerAge);
  const benchmarkAge = ageFromDateOfBirth(benchmark?.date_of_birth);
  if (benchmarkAge != null) return String(benchmarkAge);
  const band = benchmark?.age_band;
  return band ? String(band) : "N/A";
}

type PlaystyleComparisonModalProps = {
  open: boolean;
  onClose: () => void;
  playerName: string;
  playerAge?: number | null;
  playerRating?: number | null;
  benchmark: Record<string, unknown>;
  attributes: Record<string, number>;
};

function PlaystyleComparisonModal({
  open,
  onClose,
  playerName,
  playerAge,
  playerRating,
  benchmark,
  attributes,
}: PlaystyleComparisonModalProps) {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const benchLabel = benchmarkName(benchmark);
  const similarity = similarityPercent(benchmark) ?? "—";
  const playerOverall = playerRating != null ? clampScore(playerRating) : "—";
  const benchmarkOverallLabel = readBenchmarkOverall(benchmark) ?? "—";
  const ageLabel = formatAgeLabel(playerAge, benchmark);

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

  return (
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
          <div className="playstyle-modal__badge playstyle-modal__badge--player">
            <span className="playstyle-modal__badge-value">{playerOverall}</span>
            <span className="playstyle-modal__badge-label">Player</span>
            <strong>{playerName}</strong>
          </div>
          <div className="playstyle-modal__badge playstyle-modal__badge--benchmark">
            <span className="playstyle-modal__badge-value">{benchmarkOverallLabel}</span>
            <span className="playstyle-modal__badge-label">Benchmark</span>
            <strong>{benchLabel}</strong>
          </div>
        </header>

        <div className="playstyle-modal__banner">
          <h2 id={titleId}>Benchmark Similarity: {similarity}%</h2>
          <p>
            This comparison maps <strong>{playerName}</strong>, age {ageLabel}, against the
            early-professional benchmark profile of <strong>{benchLabel}</strong> to show how
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
              Player (Blue)
            </span>
            <span>
              <i className="playstyle-modal__dot playstyle-modal__dot--benchmark" />
              Benchmark (Purple)
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
    </div>
  );
}

export function BenchmarkPlaystyleComparison({
  playerName,
  playerAge,
  playerRating,
  benchmark,
  attributes,
}: {
  playerName: string;
  playerAge?: number | null;
  playerRating?: number | null;
  benchmark: Record<string, unknown> | null;
  attributes: Record<string, number>;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  if (!benchmark) {
    return (
      <article className="profile-panel profile-benchmark">
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

  return (
    <>
      <article className="profile-panel profile-benchmark">
        <div className="profile-section-heading">
          <div>
            <h3>Playstyle comparison</h3>
            <p className="muted">
              Compared with {benchLabel}
              {benchmark.archetype ? ` · ${String(benchmark.archetype)}` : ""}
              {similarity != null ? ` · ${similarity}% similarity` : ""}
            </p>
          </div>
          <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
            View Playstyle Comparison
          </Button>
        </div>
      </article>

      <PlaystyleComparisonModal
        open={open}
        onClose={close}
        playerName={playerName}
        playerAge={playerAge}
        playerRating={playerRating}
        benchmark={benchmark}
        attributes={attributes}
      />
    </>
  );
}
