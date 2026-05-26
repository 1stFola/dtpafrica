import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export type PlayerCardData = {
  id: string;
  slug?: string | null;
  displayName: string;
  positionPrimary: string;
  nationality?: string | null;
  ageGroup?: string | null;
  overallRating?: number | null;
  playerPhotoUrl?: string | null;
};

type PlayerCardProps = {
  player: PlayerCardData;
  to?: string;
  footer?: ReactNode;
  className?: string;
};

export function PlayerCard({ player, to, footer, className = "" }: PlayerCardProps) {
  const profileTo = to ?? (player.slug ? `/player/${player.slug}` : `/player/${player.id}`);
  const initial = player.displayName.charAt(0);

  const inner = (
    <>
      <div className="dtp-player-card__avatar">
        {player.playerPhotoUrl ? (
          <img src={player.playerPhotoUrl} alt="" />
        ) : (
          <span aria-hidden>{initial}</span>
        )}
      </div>
      <div className="dtp-player-card__body">
        <h3>{player.displayName}</h3>
        <p className="dtp-player-card__meta">
          {player.positionPrimary}
          {player.ageGroup ? ` · ${player.ageGroup}` : ""}
          {player.nationality ? ` · ${player.nationality}` : ""}
        </p>
        {player.overallRating != null && (
          <p className="dtp-player-card__rating">Overall {player.overallRating}</p>
        )}
      </div>
    </>
  );

  return (
    <article className={`dtp-player-card ${className}`.trim()}>
      <Link to={profileTo} className="dtp-player-card__link">
        {inner}
      </Link>
      {footer}
    </article>
  );
}
