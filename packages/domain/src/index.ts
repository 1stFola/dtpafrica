export type ProductModuleId = "directopro" | "scoreboard" | "sip" | "mvce";

export type ProductModule = {
  id: ProductModuleId;
  title: string;
  navLabel: string;
  path: string;
  description: string;
  buildPhase: string;
};

/** Registered modules on www.dtp.africa */
export const PRODUCT_MODULES: ProductModule[] = [
  {
    id: "directopro",
    title: "DirectToPro Home",
    navLabel: "Home",
    path: "/",
    description: "Marketing, registration, featured players, academies, blog",
    buildPhase: "1 — public pages + CMS",
  },
  {
    id: "scoreboard",
    title: "ScoreBoard",
    navLabel: "ScoreBoard",
    path: "/scoreboard",
    description: "Live matches, competitions, highlights, operator tools",
    buildPhase: "1 — live matches + standings (see docs/10)",
  },
  {
    id: "sip",
    title: "Scouting Intelligence",
    navLabel: "Scouting",
    path: "/scouting",
    description: "Tactical scores, philosophy fit, Strong XI, comparison",
    buildPhase: "1 — DB + tactical engine (see SIP spec)",
  },
  {
    id: "mvce",
    title: "Market Value Confidence",
    navLabel: "Valuation",
    path: "/valuation",
    description: "Valuation bands, confidence scores, comparables",
    buildPhase: "1 — valuation engine + dashboard (see docs/11)",
  },
];

export type PlayerId = string;

export type PlayerSummary = {
  id: PlayerId;
  displayName: string;
  positionPrimary: string;
  nationality?: string;
  overallRating?: number;
};
