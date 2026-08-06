import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/**
 * Market Value & Confidence Engine card.
 *
 * Figma "DTP" -> node 241:3165 ("Product Card", 283x352) and its 315x392
 * instance in the Homepage featured-talent grid (3:189). Portrait, name,
 * position, market-value band, and up to three star-marked metric bars.
 *
 * Styles live in apps/web/src/styles/dtp-figma.css (`.mvce-card`).
 */

/** Track gradient. Semantic rather than positional, so a row keeps its colour
 *  even when an earlier row is absent (e.g. a keeper with no attack rating). */
export type MvceMetricTone = "primary" | "attack" | "defense";

export type MvceMetric = {
  /** Row label — surfaced to assistive tech, not painted in the design. */
  label: string;
  /** Formatted figure shown at the end of the row, e.g. "64%" or "0.69". */
  value: string;
  /** Track fill, 0-100. Derived from `value` when omitted. */
  percent?: number;
  tone?: MvceMetricTone;
};

export type MvceCardData = {
  id: string;
  slug?: string | null;
  displayName: string;
  /** Full position label, e.g. "Defensive Midfielder". */
  position?: string | null;
  photoUrl?: string | null;
  /** Market-value band headline, e.g. "$12k - $18k". */
  marketValue?: string | null;
  /** Caption under the value, e.g. "MVCE BAND". */
  marketValueLabel?: string | null;
  /** Corner badge, e.g. "DTP VERIFIED" or a tier name. */
  badge?: string | null;
  metrics?: MvceMetric[];
};

export type MvceCardProps = {
  player: MvceCardData;
  /** Destination override; defaults to the player profile route. */
  to?: string;
  /** Light variant for placement on the lime / paper bands. */
  tone?: "dark" | "light";
  footer?: ReactNode;
  className?: string;
};

/** Parse "64%" / "0.69" / "82" into a 0-100 track width. */
function toPercent(metric: MvceMetric): number {
  if (typeof metric.percent === "number") {
    return Math.max(0, Math.min(100, metric.percent));
  }
  const numeric = Number.parseFloat(metric.value.replace(/[^0-9.+-]/g, ""));
  if (!Number.isFinite(numeric)) return 0;
  // Ratio-style figures (0.69) scale up; percentages and 0-100 ratings do not.
  const scaled = metric.value.includes("%") || numeric > 1 ? numeric : numeric * 100;
  return Math.max(0, Math.min(100, scaled));
}

function StarGlyph() {
  return (
    <svg
      className="mvce-card__star"
      viewBox="0 0 12 12"
      width="12"
      height="12"
      aria-hidden="true"
      focusable="false"
    >
      <path fill="currentColor" d="M6 0l1.76 3.82L12 4.4 8.9 7.3l.78 4.2L6 9.5 2.32 11.5l.78-4.2L0 4.4l4.24-.58z" />
    </svg>
  );
}

export function MvceCard({
  player,
  to,
  tone = "dark",
  footer,
  className = "",
}: MvceCardProps) {
  const href = to ?? (player.slug ? `/players/${player.slug}` : `/players/${player.id}`);
  const metrics = (player.metrics ?? []).slice(0, 3);
  const classes = ["mvce-card", tone === "light" ? "mvce-card--light" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <Link to={href} className={classes}>
      <div className="mvce-card__media">
        {player.photoUrl ? (
          <img className="mvce-card__img" src={player.photoUrl} alt="" loading="lazy" />
        ) : null}
        {player.badge ? <span className="mvce-card__badge">{player.badge}</span> : null}
      </div>

      <h3 className="mvce-card__name">{player.displayName}</h3>

      {player.position ? <p className="mvce-card__position">{player.position}</p> : null}

      {player.marketValue ? (
        <p className="mvce-card__value">
          {player.marketValue}
          {player.marketValueLabel ? <small>{player.marketValueLabel}</small> : null}
        </p>
      ) : null}

      {metrics.length > 0 && (
        <ul className="mvce-card__metrics">
          {metrics.map((metric) => {
            const percent = toPercent(metric);
            return (
              <li
                className={`mvce-card__metric mvce-card__metric--${metric.tone ?? "primary"}`}
                key={metric.label}
              >
                <StarGlyph />
                <span
                  className="mvce-card__track"
                  role="meter"
                  aria-label={metric.label}
                  aria-valuenow={percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuetext={`${metric.label}: ${metric.value}`}
                >
                  <span className="mvce-card__fill" style={{ width: `${percent}%` }} />
                </span>
                <span className="mvce-card__figure">{metric.value}</span>
              </li>
            );
          })}
        </ul>
      )}

      {footer}
    </Link>
  );
}
