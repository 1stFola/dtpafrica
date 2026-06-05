import type { AdBannerFormat, AdSlotKey } from "./ads.constants";

export { MOCK_AD_IMAGE_URLS } from "./ads-mock-creatives";

/** Matches `apps/web/src/styles/global.css` (.ad-banner--*) */
export const AD_FORMAT_SPECS: Record<
  AdBannerFormat,
  {
    width: number;
    height: number;
    maxWidthPx: number;
    iabName: string;
    aspectRatio: string;
  }
> = {
  leaderboard: {
    width: 728,
    height: 90,
    maxWidthPx: 728,
    iabName: "Leaderboard",
    aspectRatio: "728:90",
  },
  square: {
    width: 300,
    height: 250,
    maxWidthPx: 300,
    iabName: "Medium Rectangle",
    aspectRatio: "6:5",
  },
  "mobile-banner": {
    width: 320,
    height: 50,
    maxWidthPx: 320,
    iabName: "Mobile Banner",
    aspectRatio: "32:5",
  },
  inline: {
    width: 728,
    height: 90,
    maxWidthPx: 728,
    iabName: "Leaderboard (inline)",
    aspectRatio: "728:90",
  },
};

export const AD_SLOT_SIZE_HINTS: Record<
  AdSlotKey,
  { format: AdBannerFormat; recommendedPx: string; iabName: string; maxWidthPx: number }
> = {
  scoreboardLeaderboardDesktop: {
    format: "leaderboard",
    recommendedPx: "728×90",
    iabName: AD_FORMAT_SPECS.leaderboard.iabName,
    maxWidthPx: AD_FORMAT_SPECS.leaderboard.maxWidthPx,
  },
  scoreboardLeaderboardMobile: {
    format: "mobile-banner",
    recommendedPx: "320×50",
    iabName: AD_FORMAT_SPECS["mobile-banner"].iabName,
    maxWidthPx: AD_FORMAT_SPECS["mobile-banner"].maxWidthPx,
  },
  matchCenterInline: {
    format: "inline",
    recommendedPx: "728×90",
    iabName: AD_FORMAT_SPECS.inline.iabName,
    maxWidthPx: AD_FORMAT_SPECS.inline.maxWidthPx,
  },
  featuredPlayersInline: {
    format: "inline",
    recommendedPx: "728×90",
    iabName: AD_FORMAT_SPECS.inline.iabName,
    maxWidthPx: AD_FORMAT_SPECS.inline.maxWidthPx,
  },
  scoutingDirectoryInline: {
    format: "inline",
    recommendedPx: "728×90",
    iabName: AD_FORMAT_SPECS.inline.iabName,
    maxWidthPx: AD_FORMAT_SPECS.inline.maxWidthPx,
  },
  scoreboardTop: {
    format: "leaderboard",
    recommendedPx: "728×90",
    iabName: AD_FORMAT_SPECS.leaderboard.iabName,
    maxWidthPx: AD_FORMAT_SPECS.leaderboard.maxWidthPx,
  },
  scoreboardLeft: {
    format: "square",
    recommendedPx: "300×600",
    iabName: AD_FORMAT_SPECS.square.iabName,
    maxWidthPx: AD_FORMAT_SPECS.square.maxWidthPx,
  },
  scoreboardRight: {
    format: "square",
    recommendedPx: "300×600",
    iabName: AD_FORMAT_SPECS.square.iabName,
    maxWidthPx: AD_FORMAT_SPECS.square.maxWidthPx,
  },
  scoutingTop: {
    format: "leaderboard",
    recommendedPx: "728×90",
    iabName: AD_FORMAT_SPECS.leaderboard.iabName,
    maxWidthPx: AD_FORMAT_SPECS.leaderboard.maxWidthPx,
  },
  scoutingLeft: {
    format: "square",
    recommendedPx: "300×600",
    iabName: AD_FORMAT_SPECS.square.iabName,
    maxWidthPx: AD_FORMAT_SPECS.square.maxWidthPx,
  },
  scoutingRight: {
    format: "square",
    recommendedPx: "300×600",
    iabName: AD_FORMAT_SPECS.square.iabName,
    maxWidthPx: AD_FORMAT_SPECS.square.maxWidthPx,
  },
  valuationTop: {
    format: "leaderboard",
    recommendedPx: "728×90",
    iabName: AD_FORMAT_SPECS.leaderboard.iabName,
    maxWidthPx: AD_FORMAT_SPECS.leaderboard.maxWidthPx,
  },
  valuationLeft: {
    format: "square",
    recommendedPx: "300×600",
    iabName: AD_FORMAT_SPECS.square.iabName,
    maxWidthPx: AD_FORMAT_SPECS.square.maxWidthPx,
  },
  valuationRight: {
    format: "square",
    recommendedPx: "300×600",
    iabName: AD_FORMAT_SPECS.square.iabName,
    maxWidthPx: AD_FORMAT_SPECS.square.maxWidthPx,
  },
};
