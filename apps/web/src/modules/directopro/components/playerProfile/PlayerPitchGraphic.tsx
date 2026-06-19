import {
  resolvePrimaryPitchMarker,
  resolveSecondaryPitchMarker,
  type SecondaryPitchInput,
} from "./resolvePitchMarker";

type Props = SecondaryPitchInput & {
  positionPrimary: string;
  positionFull?: string | null;
  role?: string | null;
};

export function PlayerPitchGraphic({
  positionPrimary,
  positionFull,
  role,
  positionSecondary,
  positionFitSecondary,
  scoutingSecondaryPositionFit,
  ratingAttributes,
  tacticalSummary,
}: Props) {
  const primaryMarker = resolvePrimaryPitchMarker(positionPrimary, positionFull, role);
  const secondaryMarker = resolveSecondaryPitchMarker(
    {
      positionPrimary,
      positionFull,
      role,
      positionSecondary,
      positionFitSecondary,
      scoutingSecondaryPositionFit,
      ratingAttributes,
      tacticalSummary,
    },
    primaryMarker
  );

  const ariaLabel = secondaryMarker
    ? `Tactical positions on pitch — primary (${Math.round(primaryMarker.x)}%, ${Math.round(primaryMarker.y)}%), secondary (${Math.round(secondaryMarker.x)}%, ${Math.round(secondaryMarker.y)}%)`
    : `Tactical position on pitch (${Math.round(primaryMarker.x)}%, ${Math.round(primaryMarker.y)}%)`;

  return (
    <div className="player-profile-pitch" role="img" aria-label={ariaLabel}>
      <span
        className="player-profile-pitch__attack-edge player-profile-pitch__attack-edge--left"
        aria-hidden="true"
      >
        ‹
      </span>
      <span
        className="player-profile-pitch__attack-edge player-profile-pitch__attack-edge--right"
        aria-hidden="true"
      >
        ‹
      </span>
      <svg
        className="player-profile-pitch__svg"
        viewBox="0 0 68 100"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="player-profile-pitch-grass" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#14532d" />
            <stop offset="100%" stopColor="#166534" />
          </linearGradient>
          <pattern
            id="player-profile-pitch-stripes"
            width="68"
            height="12"
            patternUnits="userSpaceOnUse"
          >
            <rect width="68" height="6" fill="rgba(255,255,255,0.04)" />
            <rect y="6" width="68" height="6" fill="rgba(0,0,0,0.06)" />
          </pattern>
        </defs>

        <rect width="68" height="100" fill="url(#player-profile-pitch-grass)" rx="4" />
        <rect width="68" height="100" fill="url(#player-profile-pitch-stripes)" rx="4" />

        <rect
          x="4"
          y="4"
          width="60"
          height="18"
          fill="none"
          stroke="rgba(255,255,255,0.22)"
          strokeWidth="0.6"
        />
        <rect
          x="4"
          y="78"
          width="60"
          height="18"
          fill="none"
          stroke="rgba(255,255,255,0.22)"
          strokeWidth="0.6"
        />
        <line
          x1="4"
          y1="50"
          x2="64"
          y2="50"
          stroke="rgba(255,255,255,0.2)"
          strokeWidth="0.55"
        />
        <circle
          cx="34"
          cy="50"
          r="9"
          fill="none"
          stroke="rgba(255,255,255,0.2)"
          strokeWidth="0.55"
        />
        <circle cx="34" cy="50" r="0.9" fill="rgba(255,255,255,0.28)" />
      </svg>

      <span
        className="player-profile-pitch__marker player-profile-pitch__marker--primary"
        style={{ left: `${primaryMarker.x}%`, top: `${primaryMarker.y}%` }}
        aria-hidden="true"
      />
      <span
        className="player-profile-pitch__main-role-label"
        style={{ left: `${primaryMarker.x}%`, top: `${primaryMarker.y}%` }}
        aria-hidden="true"
      >
        Main Role
      </span>
      {secondaryMarker && (
        <>
          <span
            className="player-profile-pitch__marker player-profile-pitch__marker--secondary"
            style={{ left: `${secondaryMarker.x}%`, top: `${secondaryMarker.y}%` }}
            aria-hidden="true"
          />
          <span
            className="player-profile-pitch__alt-role-label"
            style={{ left: `${secondaryMarker.x}%`, top: `${secondaryMarker.y}%` }}
            aria-hidden="true"
          >
            Alt. Role
          </span>
        </>
      )}
    </div>
  );
}
