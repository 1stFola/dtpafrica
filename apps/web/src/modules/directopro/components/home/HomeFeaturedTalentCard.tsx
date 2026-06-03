import { Link } from "react-router-dom";
import type { FeaturedPlayer } from "../../../../api/client";
import { playerProfilePath } from "../../../../utils/playerSlug";
import { isGoalkeeper } from "../../../../utils/position";
import { resolvePositionFullLabel } from "../../../../utils/positionLabels";

type HomeFeaturedTalentCardProps = {
  player: FeaturedPlayer;
};

function formatStat(value: number | null | undefined): string {
  return value != null ? String(value) : "—";
}

function ratingTone(rating: number): string {
  if (rating >= 85) return "home-talent-card__rating--elite";
  if (rating >= 75) return "home-talent-card__rating--ready";
  return "";
}

export function HomeFeaturedTalentCard({ player }: HomeFeaturedTalentCardProps) {
  const gk = isGoalkeeper(player.positionPrimary);
  const initial = player.displayName.charAt(0);
  const rating = player.overallRating;
  const profileTo = playerProfilePath(player);
  const positionLabel = resolvePositionFullLabel(
    player.positionPrimary,
    player.positionFull
  );
  const philosophies = player.philosophies ?? [];

  const body = (
    <>
      <div className="home-talent-card__banner">
        {player.playerPhotoUrl ? (
          <img src={player.playerPhotoUrl} alt="" className="home-talent-card__banner-img" />
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
        {gk ? (
          <div className="home-talent-card__gk">
            <dl className="home-talent-card__stat home-talent-card__stat--highlight">
              <dt>Clean Sheets</dt>
              <dd>{formatStat(player.careerCleanSheets)}</dd>
            </dl>
            {philosophies.length > 0 && (
              <ul className="home-talent-card__philosophies" aria-label="Top playing philosophies">
                {philosophies.map((p) => (
                  <li key={p.name} className="home-talent-card__philosophy-pill">
                    <span className="home-talent-card__philosophy-label">{p.name}</span>
                    <span className="home-talent-card__philosophy-score">{p.score}%</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : philosophies.length > 0 ? (
          <ul className="home-talent-card__philosophies" aria-label="Top playing philosophies">
            {philosophies.map((p) => (
              <li key={p.name} className="home-talent-card__philosophy-pill">
                <span className="home-talent-card__philosophy-label">{p.name}</span>
                <span className="home-talent-card__philosophy-score">{p.score}%</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="home-talent-card__philosophies-empty muted">Philosophies pending</p>
        )}
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
