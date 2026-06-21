import { useId } from "react";
import {
  resolveHybridPitchMarker,
  resolvePrimaryPitchMarker,
  resolveSecondaryPitchMarker,
  type SecondaryPitchInput,
} from "./resolvePitchMarker";

type Props = SecondaryPitchInput & {
  positionPrimary: string;
  positionFull?: string | null;
  role?: string | null;
};

function formatMarkerAria(x: number, y: number): string {
  return `${Math.round(x)}%, ${Math.round(y)}%`;
}

export function PlayerPitchGraphic({
  positionPrimary,
  positionFull,
  role,
  positionSecondary,
  positionFitSecondary,
  scoutingSecondaryPositionFit,
  positionFitHybrid,
  scoutingHybridFit,
  ratingAttributes,
  tacticalSummary,
}: Props) {
  const uid = useId().replace(/:/g, "");
  const pitchInput: SecondaryPitchInput = {
    positionPrimary,
    positionFull,
    role,
    positionSecondary,
    positionFitSecondary,
    scoutingSecondaryPositionFit,
    positionFitHybrid,
    scoutingHybridFit,
    ratingAttributes,
    tacticalSummary,
  };

  const primaryMarker = resolvePrimaryPitchMarker(positionPrimary, positionFull, role);
  const secondaryMarker = resolveSecondaryPitchMarker(pitchInput, primaryMarker);
  const hybridMarker = resolveHybridPitchMarker(pitchInput, primaryMarker, secondaryMarker);

  const hybridLabel = positionFitHybrid ?? scoutingHybridFit ?? null;

  const ariaParts = [
    `primary (${formatMarkerAria(primaryMarker.x, primaryMarker.y)})`,
    secondaryMarker
      ? `secondary (${formatMarkerAria(secondaryMarker.x, secondaryMarker.y)})`
      : null,
    hybridMarker
      ? `hybrid${hybridLabel ? ` ${hybridLabel}` : ""} (${formatMarkerAria(hybridMarker.x, hybridMarker.y)})`
      : null,
  ].filter(Boolean);

  const ariaLabel = `Tactical positions on pitch — ${ariaParts.join(", ")}`;

  const connectorGradId = `player-profile-pitch-hybrid-connector-${uid}`;
  const zoneGradId = `player-profile-pitch-hybrid-zone-${uid}`;

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

      {hybridMarker && (
        <svg
          className="player-profile-pitch__overlay"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={connectorGradId} gradientUnits="userSpaceOnUse" x1={primaryMarker.x} y1={primaryMarker.y} x2={hybridMarker.x} y2={hybridMarker.y}>
              <stop offset="0%" stopColor="rgba(34, 197, 94, 0.85)" />
              <stop offset="55%" stopColor="rgba(251, 191, 36, 0.75)" />
              <stop offset="100%" stopColor="rgba(167, 139, 250, 0.9)" />
            </linearGradient>
            <radialGradient id={zoneGradId} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(251, 191, 36, 0.45)" />
              <stop offset="70%" stopColor="rgba(167, 139, 250, 0.18)" />
              <stop offset="100%" stopColor="rgba(167, 139, 250, 0)" />
            </radialGradient>
          </defs>
          <ellipse
            className="player-profile-pitch__hybrid-zone"
            cx={hybridMarker.x}
            cy={hybridMarker.y}
            rx="9"
            ry="7.5"
            fill={`url(#${zoneGradId})`}
          />
          <line
            className="player-profile-pitch__hybrid-connector"
            x1={primaryMarker.x}
            y1={primaryMarker.y}
            x2={hybridMarker.x}
            y2={hybridMarker.y}
            stroke={`url(#${connectorGradId})`}
            strokeWidth="1.1"
            strokeLinecap="round"
          />
        </svg>
      )}

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
      {hybridMarker && (
        <>
          <span
            className="player-profile-pitch__hybrid-halo"
            style={{ left: `${hybridMarker.x}%`, top: `${hybridMarker.y}%` }}
            aria-hidden="true"
          />
          <span
            className="player-profile-pitch__marker player-profile-pitch__marker--hybrid"
            style={{ left: `${hybridMarker.x}%`, top: `${hybridMarker.y}%` }}
            aria-hidden="true"
          />
          <span
            className="player-profile-pitch__hybrid-role-label"
            style={{ left: `${hybridMarker.x}%`, top: `${hybridMarker.y}%` }}
            aria-hidden="true"
          >
            Hybrid{hybridLabel ? ` · ${hybridLabel}` : " Role"}
          </span>
        </>
      )}
    </div>
  );
}
