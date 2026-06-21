import {
  ATTRIBUTE_LABELS,
  attributeTierClass,
  clampScore,
} from "./playerProfileAttributes";

export type PlayerAttributeMicroGridVariant = "core" | "full";

type PlayerAttributeMicroGridProps = {
  attributes: Record<string, number>;
  keys: readonly string[];
  variant?: PlayerAttributeMicroGridVariant;
  className?: string;
};

export function PlayerAttributeMicroGrid({
  attributes,
  keys,
  variant = "core",
  className,
}: PlayerAttributeMicroGridProps) {
  if (keys.length === 0) return null;

  const gridClassName = [
    "player-profile-attr-grid",
    variant === "core" ? "player-profile-attr-grid--core" : "player-profile-attr-grid--full",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={gridClassName}>
      {keys.map((key) => {
        const score = clampScore(attributes[key] ?? 0);
        return (
          <article
            key={key}
            className={`player-profile-attr ${attributeTierClass(score)}`}
          >
            <div className="player-profile-attr__head">
              <span className="player-profile-attr__label">{ATTRIBUTE_LABELS[key] ?? key}</span>
              <strong className="player-profile-attr__score">{score}</strong>
            </div>
            <div className="player-profile-attr__track" aria-hidden="true">
              <span className="player-profile-attr__fill" style={{ width: `${score}%` }} />
            </div>
          </article>
        );
      })}
    </div>
  );
}
