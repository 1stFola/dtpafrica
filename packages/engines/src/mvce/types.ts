export type VerificationLevel =
  | "none"
  | "video_only"
  | "video_match_sheets"
  | "full_verified"
  | "national_team";

export type MarketDemandLevel =
  | "none"
  | "local_club"
  | "npfl"
  | "african_club"
  | "european_club"
  | "elite_european";

export type MvceValuationInput = {
  age?: number;
  positionPrimary: string;
  nationality?: string;
  heightCm?: number;
  weightKg?: number;
  dominantFoot?: string;
  /** 1–5 club tier (grassroots → elite) */
  competitionTier?: number;
  matchesPlayed?: number;
  goals?: number;
  assists?: number;
  /** 0–100 SIP overall or performance proxy */
  performanceScore?: number;
  /** 0–100 from SIP athletic / tactical blend */
  athleticScore?: number;
  verifiedFootage?: boolean;
  scoutReports?: boolean;
  tournamentExposure?: boolean;
  socialVisibility?: boolean;
  youthNationalTeam?: boolean;
  clubInterestRumors?: boolean;
  hasProfessionalContract?: boolean;
  verificationLevel?: VerificationLevel;
  marketDemand?: MarketDemandLevel;
};

export type FactorBreakdown = {
  key: string;
  label: string;
  weight: number;
  rawScore: number;
  weightedContribution: number;
};

export type MvceValuationResult = {
  baseScore: number;
  adjustedScore: number;
  confidenceLabel: string;
  marketValueLabel: string;
  marketValueMinEur: number | null;
  marketValueMaxEur: number | null;
  factors: FactorBreakdown[];
  multipliers: {
    verification: { level: VerificationLevel; value: number };
    marketDemand: { level: MarketDemandLevel; value: number };
    position: { position: string; value: number };
    combined: number;
  };
  strengths: string[];
  weaknesses: string[];
  scoutNotes: string;
};
