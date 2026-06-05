import leaderboardFallback from "../assets/ads/leaderboard-fallback.svg";
import mobileBannerFallback from "../assets/ads/mobile-banner-fallback.svg";
import squareFallback from "../assets/ads/square-fallback.svg";
import type { AdBannerFormat, AdBannerProps } from "../components/AdBanner";

/** Demo HTTPS creatives (placehold.co) — used when API is unavailable */
const MOCK = {
  leaderboardBlue: "https://placehold.co/728x90/1e40af/ffffff/png?text=728x90+Leaderboard",
  mobile: "https://placehold.co/320x50/b45309/ffffff/png?text=320x50+Mobile+Banner",
  leaderboardPurple: "https://placehold.co/728x90/6d28d9/ffffff/png?text=728x90+Match+Center",
  leaderboardGreen: "https://placehold.co/728x90/047857/ffffff/png?text=728x90+Featured+Players",
  leaderboardAmber: "https://placehold.co/728x90/9a3412/ffffff/png?text=728x90+Scouting",
  scoreboardTop: "https://placehold.co/728x90/0e7490/ffffff/png?text=ScoreBoard+Top+728x90",
  scoreboardLeft: "https://placehold.co/300x600/155e75/ffffff/png?text=ScoreBoard+Left+300x600",
  scoreboardRight: "https://placehold.co/300x600/164e63/ffffff/png?text=ScoreBoard+Right+300x600",
  scoutingTop: "https://placehold.co/728x90/7c3aed/ffffff/png?text=Scouting+Top+728x90",
  scoutingLeft: "https://placehold.co/300x600/6d28d9/ffffff/png?text=Scouting+Left+300x600",
  scoutingRight: "https://placehold.co/300x600/5b21b6/ffffff/png?text=Scouting+Right+300x600",
  valuationTop: "https://placehold.co/728x90/ca8a04/ffffff/png?text=Valuation+Top+728x90",
  valuationLeft: "https://placehold.co/300x600/a16207/ffffff/png?text=Valuation+Left+300x600",
  valuationRight: "https://placehold.co/300x600/854d0e/ffffff/png?text=Valuation+Right+300x600",
} as const;

export type { AdBannerFormat };

export type AdSlotKey =
  | "scoreboardLeaderboardDesktop"
  | "scoreboardLeaderboardMobile"
  | "scoreboardTop"
  | "scoreboardLeft"
  | "scoreboardRight"
  | "matchCenterInline"
  | "featuredPlayersInline"
  | "scoutingTop"
  | "scoutingLeft"
  | "scoutingRight"
  | "scoutingDirectoryInline"
  | "valuationTop"
  | "valuationLeft"
  | "valuationRight";

export const AD_SLOT_KEYS: AdSlotKey[] = [
  "scoreboardLeaderboardDesktop",
  "scoreboardLeaderboardMobile",
  "scoreboardTop",
  "scoreboardLeft",
  "scoreboardRight",
  "matchCenterInline",
  "featuredPlayersInline",
  "scoutingTop",
  "scoutingLeft",
  "scoutingRight",
  "scoutingDirectoryInline",
  "valuationTop",
  "valuationLeft",
  "valuationRight",
];

export const defaultAdConfig: Record<AdSlotKey, AdBannerProps> = {
  scoreboardLeaderboardDesktop: {
    slotId: "scoreboard-leaderboard-desktop",
    format: "leaderboard",
    fallbackImageUrl: MOCK.leaderboardBlue,
    destinationUrl: "https://dtp.africa/sponsors/scoreboard-desktop",
    label: "Legacy · Header desktop (unused)",
  },
  scoreboardLeaderboardMobile: {
    slotId: "scoreboard-leaderboard-mobile",
    format: "mobile-banner",
    fallbackImageUrl: MOCK.mobile,
    destinationUrl: "https://dtp.africa/sponsors/scoreboard-mobile",
    label: "Demo · Scoreboard mobile",
  },
  scoreboardTop: {
    slotId: "scoreboard-top",
    format: "leaderboard",
    fallbackImageUrl: MOCK.scoreboardTop,
    destinationUrl: "https://dtp.africa/sponsors/scoreboard-top",
    label: "Demo · ScoreBoard top",
  },
  scoreboardLeft: {
    slotId: "scoreboard-left",
    format: "square",
    fallbackImageUrl: MOCK.scoreboardLeft,
    destinationUrl: "https://dtp.africa/sponsors/scoreboard-left",
    label: "Demo · ScoreBoard left",
  },
  scoreboardRight: {
    slotId: "scoreboard-right",
    format: "square",
    fallbackImageUrl: MOCK.scoreboardRight,
    destinationUrl: "https://dtp.africa/sponsors/scoreboard-right",
    label: "Demo · ScoreBoard right",
  },
  matchCenterInline: {
    slotId: "match-center-inline",
    format: "inline",
    fallbackImageUrl: MOCK.leaderboardPurple,
    destinationUrl: "https://dtp.africa/sponsors/match-center",
    label: "Demo · Match center",
  },
  featuredPlayersInline: {
    slotId: "featured-players-inline",
    format: "inline",
    fallbackImageUrl: MOCK.leaderboardGreen,
    destinationUrl: "https://dtp.africa/sponsors/featured-players",
    label: "Demo · Featured players",
  },
  scoutingTop: {
    slotId: "scouting-top",
    format: "leaderboard",
    fallbackImageUrl: MOCK.scoutingTop,
    destinationUrl: "https://dtp.africa/sponsors/scouting-top",
    label: "Demo · Scouting top",
  },
  scoutingLeft: {
    slotId: "scouting-left",
    format: "square",
    fallbackImageUrl: MOCK.scoutingLeft,
    destinationUrl: "https://dtp.africa/sponsors/scouting-left",
    label: "Demo · Scouting left",
  },
  scoutingRight: {
    slotId: "scouting-right",
    format: "square",
    fallbackImageUrl: MOCK.scoutingRight,
    destinationUrl: "https://dtp.africa/sponsors/scouting-right",
    label: "Demo · Scouting right",
  },
  scoutingDirectoryInline: {
    slotId: "scouting-directory-inline",
    format: "inline",
    fallbackImageUrl: MOCK.leaderboardAmber,
    destinationUrl: "https://dtp.africa/sponsors/scouting-directory",
    label: "Demo · Scouting directory",
  },
  valuationTop: {
    slotId: "valuation-top",
    format: "leaderboard",
    fallbackImageUrl: MOCK.valuationTop,
    destinationUrl: "https://dtp.africa/sponsors/valuation-top",
    label: "Demo · Valuation top",
  },
  valuationLeft: {
    slotId: "valuation-left",
    format: "square",
    fallbackImageUrl: MOCK.valuationLeft,
    destinationUrl: "https://dtp.africa/sponsors/valuation-left",
    label: "Demo · Valuation left",
  },
  valuationRight: {
    slotId: "valuation-right",
    format: "square",
    fallbackImageUrl: MOCK.valuationRight,
    destinationUrl: "https://dtp.africa/sponsors/valuation-right",
    label: "Demo · Valuation right",
  },
};

/** Bundled SVG fallbacks when remote image URL is empty */
export const bundledAdFallbacks = {
  square: squareFallback,
  leaderboard: leaderboardFallback,
  mobile: mobileBannerFallback,
};

/** @deprecated Use defaultAdConfig or useAdSlot() */
export const adConfig = defaultAdConfig;
