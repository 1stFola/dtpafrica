import type { MarketDemandLevel, VerificationLevel } from "./types";

export const VERIFICATION_MULTIPLIERS: Record<VerificationLevel, number> = {
  none: 0.6,
  video_only: 0.8,
  video_match_sheets: 1.0,
  full_verified: 1.15,
  national_team: 1.25,
};

export const MARKET_DEMAND_MULTIPLIERS: Record<MarketDemandLevel, number> = {
  none: 1.0,
  local_club: 1.05,
  npfl: 1.15,
  african_club: 1.3,
  european_club: 1.6,
  elite_european: 2.0,
};

const POSITION_MULTIPLIERS: Record<string, number> = {
  GK: 0.85,
  CB: 1.0,
  FB: 1.05,
  WB: 1.05,
  LB: 1.05,
  RB: 1.05,
  DM: 1.1,
  CDM: 1.1,
  CM: 1.15,
  AM: 1.2,
  CAM: 1.2,
  LW: 1.35,
  RW: 1.35,
  W: 1.35,
  ST: 1.4,
  CF: 1.4,
};

export function positionMultiplier(position: string): number {
  const key = position.toUpperCase().trim();
  if (POSITION_MULTIPLIERS[key] != null) return POSITION_MULTIPLIERS[key];
  if (key.includes("ST") || key.includes("CF")) return 1.4;
  if (key.includes("W") || key.includes("LW") || key.includes("RW")) return 1.35;
  if (key.includes("AM")) return 1.2;
  if (key.includes("CM") || key.includes("DM")) return 1.12;
  if (key.includes("GK")) return 0.85;
  return 1.0;
}

export function inferVerificationLevel(input: {
  verificationLevel?: VerificationLevel;
  verifiedFootage?: boolean;
  scoutReports?: boolean;
  youthNationalTeam?: boolean;
}): VerificationLevel {
  if (input.verificationLevel) return input.verificationLevel;
  if (input.youthNationalTeam) return "national_team";
  if (input.verifiedFootage && input.scoutReports) return "full_verified";
  if (input.verifiedFootage) return "video_only";
  return "none";
}

export function inferMarketDemand(input: {
  marketDemand?: MarketDemandLevel;
  clubInterestRumors?: boolean;
  youthNationalTeam?: boolean;
}): MarketDemandLevel {
  if (input.marketDemand) return input.marketDemand;
  if (input.youthNationalTeam) return "african_club";
  if (input.clubInterestRumors) return "local_club";
  return "none";
}
