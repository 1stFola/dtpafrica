import { Link } from "react-router-dom";
import type { PublicPlayerProfile } from "../../../../api/client";
import { InfoTip } from "../../../../components/InfoTip";
import { isGoalkeeper } from "../../../../utils/position";
import { resolvePositionFullLabel } from "../../../../utils/positionLabels";
import {
  resolvePositionGroup,
  type PositionMetricGroup,
} from "../../../scouting/utils/positionScoutingMetrics";

const POSITION_GROUP_LABELS: Record<PositionMetricGroup, string> = {
  goalkeeper: "Goalkeeper",
  striker: "Striker",
  winger: "Winger",
  cm_am: "Central / attacking midfield",
  fullback: "Full-back",
  center_back: "Centre-back",
};

const TACTICAL_TRAIT_LABELS: { key: string; label: string; description: string }[] = [
  { key: "gegenpressScore", label: "Gegenpress", description: "Intensity and recovery pressing." },
  { key: "tikiTakaScore", label: "Tiki-taka", description: "Short passing and positional circulation." },
  { key: "counterAttackScore", label: "Counter attack", description: "Direct transitions and vertical threat." },
  { key: "wingerScore", label: "Wide play", description: "Width, crossing, and isolation threat." },
  { key: "pressResistanceScore", label: "Press resistance", description: "Composure when pressed in possession." },
  { key: "twoFootednessScore", label: "Two-footedness", description: "Balance using left and right foot in play." },
  { key: "ballRetentionScore", label: "Ball retention", description: "Ability to keep possession under pressure." },
  { key: "quickReleaseScore", label: "Quick release", description: "Speed of first pass or shot after receiving." },
];

function formatMinutesPlayed(value: number | null | undefined): string {
  if (value == null || value <= 0) return "—";
  return value.toLocaleString();
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString() : "Date pending";
}

function formatCurrencyRange(min?: number | null, max?: number | null) {
  if (min == null && max == null) return "Undisclosed";
  const formatter = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
  if (min != null && max != null) return `${formatter.format(min)} - ${formatter.format(max)}`;
  return formatter.format(min ?? max ?? 0);
}

function stringList(value: unknown) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).map(String).filter(Boolean);
  }
  return [];
}

function ratingTier(rating?: number | null) {
  if (rating == null) return "Emerging";
  if (rating >= 85) return "Elite";
  if (rating >= 75) return "Pro-ready";
  if (rating >= 65) return "Developing";
  return "Emerging";
}

function isGkProfile(player: Pick<PublicPlayerProfile, "role" | "positionPrimary">): boolean {
  return isGoalkeeper(player.role) || isGoalkeeper(player.positionPrimary);
}

function philosophyIcon(philosophy: string): string {
  const key = philosophy.toLowerCase();
  if (key.includes("press") || key.includes("gegen")) return "⚡";
  if (key.includes("possession") || key.includes("tiki")) return "◎";
  if (key.includes("counter") || key.includes("direct")) return "➤";
  if (key.includes("wing") || key.includes("wide")) return "↗";
  return "◆";
}

type Props = {
  player: PublicPlayerProfile;
};

export function ScoutingDetailsTab({ player }: Props) {
  const scouting = player.scoutingIntelligence;
  const valuation = player.valuation;
  const isGk = isGkProfile(player);
  const positionGroup = resolvePositionGroup(player.positionPrimary, player.role);
  const positionGroupLabel = POSITION_GROUP_LABELS[positionGroup];
  const positionLabel = resolvePositionFullLabel(player.positionPrimary.trim(), null);
  const tierLabel = ratingTier(player.overallRating);
  const aggregate = scouting?.aggregateMetrics;
  const tacticalScores = scouting?.tacticalScores ?? null;
  const positionFit = scouting?.positionFit ?? player.positionFit;

  const tacticalTraits = TACTICAL_TRAIT_LABELS.map((trait) => {
    const value = tacticalScores?.[trait.key as keyof typeof tacticalScores];
    return typeof value === "number" && Number.isFinite(value)
      ? { ...trait, value: Math.round(value) }
      : null;
  })
    .filter((trait): trait is { key: string; label: string; description: string; value: number } =>
      Boolean(trait)
    )
    .sort((a, b) => b.value - a.value);

  const hasIntelligence =
    scouting &&
    (scouting.tacticalFit ||
      scouting.philosophyMatch ||
      scouting.topTacticalScores.length > 0 ||
      scouting.positionFit ||
      scouting.philosophyFits.length > 0 ||
      scouting.aggregateMetrics);

  return (
    <div className="scouting-details">
      <section className="profile-section scouting-details__hero" aria-label="Scouting coverage">
        <div className="profile-section-heading">
          <div>
            <span className="player-profile-eyebrow">Scouting intelligence</span>
            <h2 className="player-profile-heading">
              {tierLabel} tier · {positionGroupLabel}
              <InfoTip text="Scouting tier from overall rating. Position group drives which tracking metrics are shown below." />
            </h2>
          </div>
          {aggregate ? (
            <span className="scouting-details__meta">
              {aggregate.matchesPlayed} match{aggregate.matchesPlayed === 1 ? "" : "es"} analysed
              {aggregate.minutesPlayed > 0
                ? ` · ${formatMinutesPlayed(Math.round(aggregate.minutesPlayed))} min`
                : ""}
            </span>
          ) : null}
        </div>

        {player.scoutingSummary ? (
          <p className="scouting-details__summary">{player.scoutingSummary}</p>
        ) : (
          <p className="player-profile-muted scouting-details__summary">
            Scouting summary pending calibration review.
          </p>
        )}

        {hasIntelligence ? (
          <div className="scouting-details__snapshot">
            <article className="scouting-intel__stat-card">
              <span className="scouting-intel__stat-label">
                Tactical fit
                <InfoTip text="Overall score for how well the player suits common tactical systems." />
              </span>
              <strong className="scouting-intel__stat-value">
                {scouting?.tacticalFit
                  ? `${scouting.tacticalFit.score} · ${scouting.tacticalFit.label}`
                  : "Pending"}
              </strong>
            </article>
            <article className="scouting-intel__stat-card">
              <span className="scouting-intel__stat-label">
                Best style match
                <InfoTip text="The playing philosophy this player aligns with most strongly." />
              </span>
              <strong className="scouting-intel__stat-value">
                {scouting?.philosophyMatch
                  ? `${scouting.philosophyMatch.score}% · ${scouting.philosophyMatch.philosophy}`
                  : "Pending"}
              </strong>
            </article>
            <article className="scouting-intel__stat-card">
              <span className="scouting-intel__stat-label">Primary role</span>
              <strong className="scouting-intel__stat-value">{positionLabel}</strong>
            </article>
          </div>
        ) : (
          <div className="profile-empty-state scouting-intel__empty">
            <strong>No scouting snapshot yet.</strong>
            <p>
              Match metrics, calibration imports, or ScoreBoard ingest are required before style fit
              and tactical matching can be computed.
            </p>
          </div>
        )}
      </section>

      <section className="profile-section scouting-details__position" aria-label="Position intelligence">
        <div className="profile-section-heading">
          <div>
            <span className="player-profile-eyebrow">Position intelligence</span>
            <h2 className="player-profile-heading">
              Role fit
              <InfoTip text="Where this player is deployed on the pitch and secondary roles they can cover." />
            </h2>
          </div>
        </div>

        <article className="profile-panel player-profile-panel scouting-details__fit-panel scouting-details__fit-panel--full">
            <h3 className="player-profile-subheading">Role profile</h3>
            <div className="profile-metric-list">
              <span>Registered position</span>
              <strong>{positionLabel}</strong>
              {player.positionSecondary ? (
                <>
                  <span>Secondary position</span>
                  <strong>{player.positionSecondary}</strong>
                </>
              ) : null}
              {positionFit?.secondaryPositionFit ? (
                <>
                  <span>Best secondary fit</span>
                  <strong>{positionFit.secondaryPositionFit}</strong>
                </>
              ) : null}
              {positionFit?.hybridFit ? (
                <>
                  <span>Hybrid fit</span>
                  <strong>{positionFit.hybridFit}</strong>
                </>
              ) : null}
              {positionFit?.confidence != null && positionFit.confidence > 0 ? (
                <>
                  <span>Fit confidence</span>
                  <strong>{Math.round(positionFit.confidence)}%</strong>
                </>
              ) : null}
              {isGk ? (
                <>
                  <span>Clean sheets</span>
                  <strong>{player.stats?.cleanSheets ?? 0}</strong>
                </>
              ) : null}
            </div>
          </article>
      </section>

      {tacticalTraits.length > 0 ? (
        <section className="profile-section scouting-details__tactical" aria-label="Tactical traits">
          <div className="profile-section-heading">
            <div>
              <span className="player-profile-eyebrow">Tactical profile</span>
              <h2 className="player-profile-heading">
                Style traits
                <InfoTip text="Engine-derived tactical scores from match performance data." />
              </h2>
            </div>
          </div>
          <div className="scouting-intel__trait-grid scouting-details__trait-grid">
            {tacticalTraits.slice(0, 6).map((trait) => (
              <article key={trait.key} className="scouting-intel__trait-card">
                <span className="scouting-intel__trait-label">
                  {trait.label}
                  <InfoTip text={trait.description} label={trait.label} />
                </span>
                <strong className="scouting-intel__trait-score">{trait.value}</strong>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {scouting && scouting.philosophyFits.length > 0 ? (
        <section className="profile-section scouting-details__philosophies" aria-label="Playing style fits">
          <div className="profile-section-heading">
            <div>
              <span className="player-profile-eyebrow">System fit</span>
              <h2 className="player-profile-heading">
                Playing style fits
                <InfoTip text="How well this player fits specific formations and philosophies in the SIP engine." />
              </h2>
            </div>
          </div>
          <div className="player-profile-playstyles">
            <ul className="player-profile-playstyles__grid">
              {scouting.philosophyFits.map((fit) => (
                <li
                  key={`${fit.formation}-${fit.philosophy}-${fit.positionSlot ?? "any"}`}
                  className="player-profile-playstyle"
                >
                  <span className="player-profile-playstyle__icon" aria-hidden="true">
                    {philosophyIcon(fit.philosophy)}
                  </span>
                  <div className="player-profile-playstyle__body">
                    <div className="player-profile-playstyle__head">
                      <span className="player-profile-playstyle__title">{fit.philosophy}</span>
                      <span className="player-profile-playstyle__fit">
                        {Math.round(fit.philosophyFitScore)}%
                      </span>
                    </div>
                    <span className="player-profile-playstyle__context">
                      {fit.formation}
                      {fit.positionSlot ? ` · ${fit.positionSlot}` : ""}
                    </span>
                    <p className="player-profile-playstyle__desc">
                      Position fit {Math.round(fit.positionFitScore)}% · confidence{" "}
                      {Math.round(fit.confidenceScore)}%
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      <ScoutingValuationSection valuation={valuation} playerId={player.id} />
    </div>
  );
}

function ScoutingValuationSection({
  valuation,
  playerId,
}: {
  valuation: PublicPlayerProfile["valuation"];
  playerId: string;
}) {
  if (!valuation) {
    return (
      <section className="profile-section scouting-details__valuation">
        <div className="profile-section-heading">
          <div>
            <span className="player-profile-eyebrow">Market value</span>
            <h2 className="player-profile-heading">
              Valuation
              <InfoTip text="Estimated transfer value range based on performance, age, competition level, and market signals." />
            </h2>
          </div>
        </div>
        <div className="profile-empty-state">
          <strong>No valuation has been generated yet.</strong>
          <p>Generate a valuation to show projected market range and scout notes here.</p>
          <Link to={`/scouting/valuation/${playerId}`} className="text-link">
            Open valuation workspace
          </Link>
        </div>
      </section>
    );
  }

  const strengths = stringList(valuation.strengths);
  const weaknesses = stringList(valuation.weaknesses);

  return (
    <section className="profile-section scouting-details__valuation">
      <div className="profile-section-heading">
        <div>
          <span className="player-profile-eyebrow">Market value</span>
          <h2 className="player-profile-heading">
            Valuation snapshot
            <InfoTip text="Projected market value with a confidence band based on available match and verification data." />
          </h2>
        </div>
        <Link to={`/scouting/valuation/${playerId}`} className="text-link">
          Open report
        </Link>
      </div>

      <div className="profile-summary-card">
        <div>
          <h2>{valuation.marketValueLabel}</h2>
          <p>{valuation.scoutNotes}</p>
          <p className="muted">Generated {formatDate(valuation.createdAt)}</p>
        </div>
        <div className="profile-facts">
          <div>
            <span>Overall score</span>
            <strong>{Math.round(valuation.adjustedScore)}</strong>
          </div>
          <div>
            <span>Confidence</span>
            <strong>{valuation.confidenceLabel}</strong>
          </div>
          <div>
            <span>Market range</span>
            <strong>
              {formatCurrencyRange(valuation.marketValueMinEur, valuation.marketValueMaxEur)}
            </strong>
          </div>
        </div>
      </div>

      {(strengths.length > 0 || weaknesses.length > 0) && (
        <div className="profile-detail-grid">
          {strengths.length > 0 ? (
            <article className="profile-panel">
              <h3>Strengths</h3>
              <ul className="profile-list">
                {strengths.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          ) : null}
          {weaknesses.length > 0 ? (
            <article className="profile-panel">
              <h3>Development flags</h3>
              <ul className="profile-list">
                {weaknesses.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          ) : null}
        </div>
      )}
    </section>
  );
}
