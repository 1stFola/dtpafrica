import { MOCK_AD_IMAGE_URLS } from "./ads-mock-creatives";

export const ADS_CONFIG_KEY = "ads.config";

export const AD_SLOT_KEYS = [
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
] as const;

export type AdSlotKey = (typeof AD_SLOT_KEYS)[number];

export type AdBannerFormat = "leaderboard" | "square" | "mobile-banner" | "inline";

export type AdSlotConfig = {
  enabled: boolean;
  slotId: string;
  format: AdBannerFormat;
  /** Empty string = client uses bundled fallback asset */
  fallbackImageUrl: string;
  destinationUrl: string;
  label?: string;
  placementNotes?: string;
};

export type AdsConfigPayload = {
  slots: Record<AdSlotKey, AdSlotConfig>;
};

export const AD_SLOT_META: Record<
  AdSlotKey,
  { title: string; placementNotes: string; defaultFormat: AdBannerFormat }
> = {
  scoreboardLeaderboardDesktop: {
    title: "Scoreboard leaderboard (desktop)",
    placementNotes: "ScoreBoard module header. Hidden below 760px.",
    defaultFormat: "leaderboard",
  },
  scoreboardLeaderboardMobile: {
    title: "Scoreboard banner (mobile)",
    placementNotes: "ScoreBoard module header. Shown below 760px when desktop slot is hidden.",
    defaultFormat: "mobile-banner",
  },
  matchCenterInline: {
    title: "Match center inline",
    placementNotes: "Match center page, below live header content.",
    defaultFormat: "inline",
  },
  featuredPlayersInline: {
    title: "Featured players inline",
    placementNotes: "Featured players listing page.",
    defaultFormat: "inline",
  },
  scoutingDirectoryInline: {
    title: "Scouting directory inline",
    placementNotes: "Tactical search / scouting directory page.",
    defaultFormat: "inline",
  },
  scoreboardTop: {
    title: "ScoreBoard top rail",
    placementNotes:
      "Below ScoreBoard subnav on all /scoreboard/* pages. 728×90 leaderboard.",
    defaultFormat: "leaderboard",
  },
  scoreboardLeft: {
    title: "ScoreBoard left rail",
    placementNotes:
      "Left column beside page content on /scoreboard/* (desktop). Use 300×600 creative.",
    defaultFormat: "square",
  },
  scoreboardRight: {
    title: "ScoreBoard right rail",
    placementNotes:
      "Right column beside page content on /scoreboard/* (desktop). Use 300×600 creative.",
    defaultFormat: "square",
  },
  scoutingTop: {
    title: "Scouting top rail",
    placementNotes: "Below Scouting subnav on all /scouting/* pages. 728×90.",
    defaultFormat: "leaderboard",
  },
  scoutingLeft: {
    title: "Scouting left rail",
    placementNotes: "Left column on /scouting/* (desktop). Use 300×600 creative.",
    defaultFormat: "square",
  },
  scoutingRight: {
    title: "Scouting right rail",
    placementNotes: "Right column on /scouting/* (desktop). Use 300×600 creative.",
    defaultFormat: "square",
  },
  valuationTop: {
    title: "Valuation top rail",
    placementNotes: "Below Valuation subnav on all /valuation/* pages. 728×90.",
    defaultFormat: "leaderboard",
  },
  valuationLeft: {
    title: "Valuation left rail",
    placementNotes: "Left column on /valuation/* (desktop). Use 300×600 creative.",
    defaultFormat: "square",
  },
  valuationRight: {
    title: "Valuation right rail",
    placementNotes: "Right column on /valuation/* (desktop). Use 300×600 creative.",
    defaultFormat: "square",
  },
};

export const DEFAULT_AD_SLOTS: Record<AdSlotKey, AdSlotConfig> = {
  scoreboardLeaderboardDesktop: {
    enabled: false,
    slotId: "scoreboard-leaderboard-desktop",
    format: "leaderboard",
    fallbackImageUrl: MOCK_AD_IMAGE_URLS.leaderboard728x90Blue,
    destinationUrl: "https://dtp.africa/sponsors/scoreboard-desktop",
    label: "Legacy · Header desktop (unused)",
    placementNotes:
      "Deprecated: desktop uses scoreboardTop below subnav. Enable only for custom layouts.",
  },
  scoreboardLeaderboardMobile: {
    enabled: false,
    slotId: "scoreboard-leaderboard-mobile",
    format: "mobile-banner",
    fallbackImageUrl: MOCK_AD_IMAGE_URLS.mobileBanner320x50,
    destinationUrl: "https://dtp.africa/sponsors/scoreboard-mobile",
    label: "Demo · Scoreboard mobile",
    placementNotes:
      "Upload 320×50 px (IAB Mobile Banner). ScoreBoard header; shown below 760px.",
  },
  matchCenterInline: {
    enabled: false,
    slotId: "match-center-inline",
    format: "inline",
    fallbackImageUrl: MOCK_AD_IMAGE_URLS.leaderboard728x90Purple,
    destinationUrl: "https://dtp.africa/sponsors/match-center",
    label: "Demo · Match center",
    placementNotes:
      "Upload 728×90 px (same frame as Leaderboard). Match center page below score header.",
  },
  featuredPlayersInline: {
    enabled: false,
    slotId: "featured-players-inline",
    format: "inline",
    fallbackImageUrl: MOCK_AD_IMAGE_URLS.leaderboard728x90Green,
    destinationUrl: "https://dtp.africa/sponsors/featured-players",
    label: "Demo · Featured players",
    placementNotes:
      "Upload 728×90 px. Inserted every 8 cards on /featured-players.",
  },
  scoutingDirectoryInline: {
    enabled: false,
    slotId: "scouting-directory-inline",
    format: "inline",
    fallbackImageUrl: MOCK_AD_IMAGE_URLS.leaderboard728x90Amber,
    destinationUrl: "https://dtp.africa/sponsors/scouting-directory",
    label: "Demo · Scouting directory",
    placementNotes:
      "Upload 728×90 px. Inserted every 8 rows on tactical search.",
  },
  scoreboardTop: {
    enabled: false,
    slotId: "scoreboard-top",
    format: "leaderboard",
    fallbackImageUrl: MOCK_AD_IMAGE_URLS.scoreboardTop728x90,
    destinationUrl: "https://dtp.africa/sponsors/scoreboard-top",
    label: "Demo · ScoreBoard top",
    placementNotes: AD_SLOT_META.scoreboardTop.placementNotes,
  },
  scoreboardLeft: {
    enabled: false,
    slotId: "scoreboard-left",
    format: "square",
    fallbackImageUrl: MOCK_AD_IMAGE_URLS.scoreboardLeft300x600,
    destinationUrl: "https://dtp.africa/sponsors/scoreboard-left",
    label: "Demo · ScoreBoard left",
    placementNotes: AD_SLOT_META.scoreboardLeft.placementNotes,
  },
  scoreboardRight: {
    enabled: false,
    slotId: "scoreboard-right",
    format: "square",
    fallbackImageUrl: MOCK_AD_IMAGE_URLS.scoreboardRight300x600,
    destinationUrl: "https://dtp.africa/sponsors/scoreboard-right",
    label: "Demo · ScoreBoard right",
    placementNotes: AD_SLOT_META.scoreboardRight.placementNotes,
  },
  scoutingTop: {
    enabled: false,
    slotId: "scouting-top",
    format: "leaderboard",
    fallbackImageUrl: MOCK_AD_IMAGE_URLS.scoutingTop728x90,
    destinationUrl: "https://dtp.africa/sponsors/scouting-top",
    label: "Demo · Scouting top",
    placementNotes: AD_SLOT_META.scoutingTop.placementNotes,
  },
  scoutingLeft: {
    enabled: false,
    slotId: "scouting-left",
    format: "square",
    fallbackImageUrl: MOCK_AD_IMAGE_URLS.scoutingLeft300x600,
    destinationUrl: "https://dtp.africa/sponsors/scouting-left",
    label: "Demo · Scouting left",
    placementNotes: AD_SLOT_META.scoutingLeft.placementNotes,
  },
  scoutingRight: {
    enabled: false,
    slotId: "scouting-right",
    format: "square",
    fallbackImageUrl: MOCK_AD_IMAGE_URLS.scoutingRight300x600,
    destinationUrl: "https://dtp.africa/sponsors/scouting-right",
    label: "Demo · Scouting right",
    placementNotes: AD_SLOT_META.scoutingRight.placementNotes,
  },
  valuationTop: {
    enabled: false,
    slotId: "valuation-top",
    format: "leaderboard",
    fallbackImageUrl: MOCK_AD_IMAGE_URLS.valuationTop728x90,
    destinationUrl: "https://dtp.africa/sponsors/valuation-top",
    label: "Demo · Valuation top",
    placementNotes: AD_SLOT_META.valuationTop.placementNotes,
  },
  valuationLeft: {
    enabled: false,
    slotId: "valuation-left",
    format: "square",
    fallbackImageUrl: MOCK_AD_IMAGE_URLS.valuationLeft300x600,
    destinationUrl: "https://dtp.africa/sponsors/valuation-left",
    label: "Demo · Valuation left",
    placementNotes: AD_SLOT_META.valuationLeft.placementNotes,
  },
  valuationRight: {
    enabled: false,
    slotId: "valuation-right",
    format: "square",
    fallbackImageUrl: MOCK_AD_IMAGE_URLS.valuationRight300x600,
    destinationUrl: "https://dtp.africa/sponsors/valuation-right",
    label: "Demo · Valuation right",
    placementNotes: AD_SLOT_META.valuationRight.placementNotes,
  },
};

const FORMATS = new Set<AdBannerFormat>([
  "leaderboard",
  "square",
  "mobile-banner",
  "inline",
]);

export function isAdSlotKey(key: string): key is AdSlotKey {
  return (AD_SLOT_KEYS as readonly string[]).includes(key);
}

export function isAdBannerFormat(value: string): value is AdBannerFormat {
  return FORMATS.has(value as AdBannerFormat);
}
