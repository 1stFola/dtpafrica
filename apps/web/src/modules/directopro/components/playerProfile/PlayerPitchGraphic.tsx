import { useId } from "react";
import {
  pitchMarkerBadgeParts,
  resolveHybridPitchLabel,
  resolveHybridPitchMarker,
  resolveMarkerLabelTransform,
  resolvePrimaryPitchLabel,
  resolvePrimaryPitchMarker,
  resolveSecondaryPitchLabel,
  resolveSecondaryPitchMarker,
  type PitchMarkerCoords,
  type PitchMarkerRole,
  type SecondaryPitchInput,
} from "./resolvePitchMarker";

type Props = SecondaryPitchInput & {
  positionPrimary: string;
  positionFull?: string | null;
  role?: string | null;
  variant?: "default" | "snapshot";
};

function formatMarkerAria(x: number, y: number): string {
  return `${Math.round(x)}%, ${Math.round(y)}%`;
}

function PitchMarkerBadge({
  role,
  label,
}: {
  role: PitchMarkerRole;
  label?: string | null;
}) {
  const { prefix, token } = pitchMarkerBadgeParts(role, label);
  return (
    <>
      <span className="player-profile-pitch__role-prefix">{prefix}</span>
      {token ? (
        <>
          <span className="player-profile-pitch__role-sep" aria-hidden="true">
            ·
          </span>
          <span className="player-profile-pitch__role-token">{token}</span>
        </>
      ) : null}
    </>
  );
}

function buildLabelSiblings(
  primaryMarker: PitchMarkerCoords,
  secondaryMarker: PitchMarkerCoords | null,
  hybridMarker: PitchMarkerCoords | null
): Array<{ role: PitchMarkerRole; coords: PitchMarkerCoords }> {
  const siblings: Array<{ role: PitchMarkerRole; coords: PitchMarkerCoords }> = [
    { role: "primary", coords: primaryMarker },
  ];
  if (secondaryMarker) siblings.push({ role: "secondary", coords: secondaryMarker });
  if (hybridMarker) siblings.push({ role: "hybrid", coords: hybridMarker });
  return siblings;
}

export function PlayerPitchGraphic({
  positionPrimary,
  positionFull,
  role,
  variant = "default",
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
  const projectMarker = (marker: PitchMarkerCoords): PitchMarkerCoords =>
    variant === "snapshot" ? { x: marker.y, y: marker.x } : marker;
  const primaryDisplayMarker = projectMarker(primaryMarker);
  const secondaryDisplayMarker = secondaryMarker ? projectMarker(secondaryMarker) : null;
  const hybridDisplayMarker = hybridMarker ? projectMarker(hybridMarker) : null;
  const primaryLabel = resolvePrimaryPitchLabel(positionPrimary, positionFull, role);
  const secondaryLabel = secondaryMarker
    ? resolveSecondaryPitchLabel(pitchInput, primaryMarker)
    : null;
  const hybridLabel = resolveHybridPitchLabel(pitchInput, primaryMarker, secondaryMarker);
  const labelSiblings = buildLabelSiblings(
    primaryDisplayMarker,
    secondaryDisplayMarker,
    hybridDisplayMarker
  );

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
    <div
      className={
        variant === "snapshot"
          ? "player-profile-pitch player-profile-pitch--snapshot"
          : "player-profile-pitch"
      }
      role="img"
      aria-label={ariaLabel}
    >
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
        viewBox={variant === "snapshot" ? "0 0 100 60" : "0 0 68 100"}
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

        {variant === "snapshot" ? (
          <>
            <rect width="100" height="60" fill="url(#player-profile-pitch-grass)" rx="0" />
            <rect width="100" height="60" fill="url(#player-profile-pitch-stripes)" rx="0" />
            <rect
              x="4.5"
              y="4"
              width="91"
              height="52"
              fill="none"
              stroke="rgba(255,255,255,0.64)"
              strokeWidth="0.8"
            />
            <line
              x1="50"
              y1="4"
              x2="50"
              y2="56"
              stroke="rgba(255,255,255,0.64)"
              strokeWidth="0.75"
            />
            <circle
              cx="50"
              cy="30"
              r="7.5"
              fill="none"
              stroke="rgba(255,255,255,0.78)"
              strokeWidth="0.8"
            />
            <circle cx="50" cy="30" r="0.95" fill="rgba(255,255,255,0.9)" />
            <rect
              x="4.5"
              y="18"
              width="9.5"
              height="24"
              fill="none"
              stroke="rgba(255,255,255,0.64)"
              strokeWidth="0.75"
            />
            <rect
              x="86"
              y="18"
              width="9.5"
              height="24"
              fill="none"
              stroke="rgba(255,255,255,0.64)"
              strokeWidth="0.75"
            />
            <rect
              x="2.5"
              y="25"
              width="3"
              height="10"
              fill="none"
              stroke="rgba(255,255,255,0.7)"
              strokeWidth="0.75"
            />
            <rect
              x="94.5"
              y="25"
              width="3"
              height="10"
              fill="none"
              stroke="rgba(255,255,255,0.7)"
              strokeWidth="0.75"
            />
          </>
        ) : (
          <>
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
          </>
        )}
      </svg>

      {hybridDisplayMarker && (
        <svg
          className="player-profile-pitch__overlay"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={connectorGradId} gradientUnits="userSpaceOnUse" x1={primaryDisplayMarker.x} y1={primaryDisplayMarker.y} x2={hybridDisplayMarker.x} y2={hybridDisplayMarker.y}>
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
            cx={hybridDisplayMarker.x}
            cy={hybridDisplayMarker.y}
            rx="9"
            ry="7.5"
            fill={`url(#${zoneGradId})`}
          />
          <line
            className="player-profile-pitch__hybrid-connector"
            x1={primaryDisplayMarker.x}
            y1={primaryDisplayMarker.y}
            x2={hybridDisplayMarker.x}
            y2={hybridDisplayMarker.y}
            stroke={`url(#${connectorGradId})`}
            strokeWidth="1.1"
            strokeLinecap="round"
          />
        </svg>
      )}

      <span
        className="player-profile-pitch__marker player-profile-pitch__marker--primary"
        style={{ left: `${primaryDisplayMarker.x}%`, top: `${primaryDisplayMarker.y}%` }}
        aria-hidden="true"
      />
      <span
        className="player-profile-pitch__main-role-label"
        style={{
          left: `${primaryDisplayMarker.x}%`,
          top: `${primaryDisplayMarker.y}%`,
          transform: resolveMarkerLabelTransform(primaryDisplayMarker, "primary", labelSiblings),
        }}
        aria-hidden="true"
      >
        <PitchMarkerBadge role="primary" label={primaryLabel} />
      </span>
      {secondaryDisplayMarker && (
        <>
          <span
            className="player-profile-pitch__marker player-profile-pitch__marker--secondary"
            style={{ left: `${secondaryDisplayMarker.x}%`, top: `${secondaryDisplayMarker.y}%` }}
            aria-hidden="true"
          />
          <span
            className="player-profile-pitch__alt-role-label"
            style={{
              left: `${secondaryDisplayMarker.x}%`,
              top: `${secondaryDisplayMarker.y}%`,
              transform: resolveMarkerLabelTransform(secondaryDisplayMarker, "secondary", labelSiblings),
            }}
            aria-hidden="true"
          >
            <PitchMarkerBadge role="secondary" label={secondaryLabel} />
          </span>
        </>
      )}
      {hybridDisplayMarker && (
        <>
          <span
            className="player-profile-pitch__hybrid-halo"
            style={{ left: `${hybridDisplayMarker.x}%`, top: `${hybridDisplayMarker.y}%` }}
            aria-hidden="true"
          />
          <span
            className="player-profile-pitch__marker player-profile-pitch__marker--hybrid"
            style={{ left: `${hybridDisplayMarker.x}%`, top: `${hybridDisplayMarker.y}%` }}
            aria-hidden="true"
          />
          <span
            className="player-profile-pitch__hybrid-role-label"
            style={{
              left: `${hybridDisplayMarker.x}%`,
              top: `${hybridDisplayMarker.y}%`,
              transform: resolveMarkerLabelTransform(hybridDisplayMarker, "hybrid", labelSiblings),
            }}
            aria-hidden="true"
          >
            <PitchMarkerBadge role="hybrid" label={hybridLabel} />
          </span>
        </>
      )}
    </div>
  );
}
