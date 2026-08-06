import type { MvceCardData } from "@dtp/ui";
import type { FeaturedPlayer } from "../../../api/client";
import { playerProfilePath, slugifyDisplayName } from "../../../utils/playerSlug";
import { resolvePositionFullLabel } from "../../../utils/positionLabels";

/**
 * Adapts a `FeaturedPlayer` into the shape the Figma MVCE card expects
 * (node 241:3165 — three star-marked metric rows above the value band).
 *
 * The design's three rows map to the ratings the featured-players endpoint
 * already returns: overall, offensive, defensive. Rows with no data are
 * dropped so the card never renders an empty track.
 */
export function toMvceCardData(player: FeaturedPlayer): MvceCardData {
  const metrics: MvceCardData["metrics"] = [];

  if (player.overallRating != null) {
    metrics.push({
      label: "Overall rating",
      value: String(Math.round(player.overallRating)),
      percent: player.overallRating,
      tone: "primary",
    });
  }
  if (player.offensiveRating != null) {
    metrics.push({
      label: "Attacking rating",
      value: `${Math.round(player.offensiveRating)}%`,
      percent: player.offensiveRating,
      tone: "attack",
    });
  }
  if (player.defensiveRating != null) {
    metrics.push({
      label: "Defensive rating",
      value: `${Math.round(player.defensiveRating)}%`,
      percent: player.defensiveRating,
      tone: "defense",
    });
  }

  return {
    id: player.id,
    slug: player.slug ?? (slugifyDisplayName(player.displayName) || null),
    displayName: player.displayName,
    position: resolvePositionFullLabel(player.positionPrimary, player.positionFull),
    photoUrl: player.playerPhotoUrl ?? null,
    badge: player.nationality ?? null,
    metrics,
  };
}

/** Profile destination for a featured player, falling back to the id route. */
export function mvceCardHref(player: FeaturedPlayer): string {
  return playerProfilePath(player) ?? `/players/${player.id}`;
}
