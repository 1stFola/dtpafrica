import { Link } from "react-router-dom";
import type { FeaturedPlayer } from "../../../../api/client";
import { PositionScoutingMetricsRow } from "../../../scouting/components/PositionScoutingMetricsRow";
import { playerProfilePath } from "../../../../utils/playerSlug";
import { resolvePositionFullLabel } from "../../../../utils/positionLabels";

type HomeFeaturedTalentCardProps = {
  player: FeaturedPlayer;
};

function ratingTone(rating: number): string {
  if (rating >= 85) return "home-talent-card__rating--elite";
  if (rating >= 75) return "home-talent-card__rating--ready";
  return "";
}

export function HomeFeaturedTalentCard({ player }: HomeFeaturedTalentCardProps) {
  const initial = player.displayName.charAt(0);
  const rating = player.overallRating;
  const profileTo = playerProfilePath(player);
  const positionLabel = resolvePositionFullLabel(
    player.positionPrimary,
    player.positionFull
  );

  const body = (
    <>
      <div className="home-talent-card__banner">
        {player.playerPhotoUrl ? (
          <img
            src={player.playerPhotoUrl}
            alt=""
            className="home-talent-card__banner-img"
            loading="lazy"
          />
        ) : (
          <span className="home-talent-card__banner-fallback" aria-hidden>
            {initial}
          </span>
        )}
        <div className="home-talent-card__banner-shade" aria-hidden="true" />
        {rating != null && (
          <span
            className={`home-talent-card__rating ${ratingTone(rating)}`}
            aria-label={`Overall rating ${rating}`}
          >
            {rating}
          </span>
        )}
        <div className="home-talent-card__identity">
          <h3>{player.displayName}</h3>
          <p className="home-talent-card__meta">
            <span className="home-talent-card__position">{positionLabel}</span>
            {player.ageGroup && <span>{player.ageGroup}</span>}
            {player.nationality && <span>{player.nationality}</span>}
          </p>
        </div>
      </div>

      <div className="home-talent-card__body">
        <PositionScoutingMetricsRow
          player={player}
          variant="strip"
          limit={3}
          showInfo={false}
          className="home-talent-card__metrics-grid"
        />
      </div>
    </>
  );

  return (
    <article className="home-talent-card">
      {profileTo ? (
        <Link to={profileTo} className="home-talent-card__link">
          {body}
        </Link>
      ) : (
        <div className="home-talent-card__link home-talent-card__link--static">{body}</div>
      )}
    </article>
  );
}
