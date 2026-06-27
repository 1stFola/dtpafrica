// @ts-nocheck
import type { Prisma, PrismaClient } from "@prisma/client";
import { COMPETITION_TEMPLATES, normalizeClubName } from "@dtp/engines";
import * as bcrypt from "bcrypt";
import {
  isFullSeed,
  shouldPreserveSbMatch,
  type SeedOptions,
} from "../src/seed/seed-options";
import { allocateMatchSlug, loadExistingMatchSlugs } from "../src/scoreboard/match-slug";

/** Shared dev password for all Ex Internationals seeded academy accounts. */
export const EX_INTL_ACADEMY_SEED_PASSWORD = "ExIntl-Cup2026";

/**
 * If `pnpm db:push` fails on duplicate `login_username` values, run in psql first:
 *
 * ```sql
 * UPDATE academies
 * SET login_username = NULL, password_hash = NULL
 * WHERE login_username IS NOT NULL;
 * ```
 *
 * Then re-run `pnpm db:push && pnpm db:seed`.
 */

const COMP_SLUG = "ex-internationals-cup-2026";
const COMP_ID = "00000000-0000-4000-8e1c-000000000000";
const BRACKET_ASSET = "/scoreboard/ex-internationals-cup-2026-bracket.png";
const TIMEZONE = "Africa/Lagos";

type TeamSeed = {
  seed: number;
  id: string;
  slug: string;
  name: string;
  shortName: string;
  logoUrl: string | null;
  academyId: string;
};

type EventSeed = {
  type: string;
  minute: number;
  teamSlug: string;
  playerLabel: string;
  assistLabel?: string;
  detail?: string;
};

type MatchSeed = {
  id: string;
  homeSlug: string;
  awaySlug: string;
  kickoffAt: string;
  venue: string;
  matchday: number;
  stageKey?: "r32" | "r16";
  leg?: "first_leg" | "second_leg";
  firstLegMatchId?: string;
  homeScore?: number;
  awayScore?: number;
  status?: "scheduled" | "finished";
  minute?: number | null;
  stats?: Prisma.InputJsonValue;
  events?: EventSeed[];
};

function matchStats(opts: {
  homePoss: number;
  awayPoss: number;
  homeSaves?: number | null;
  awaySaves?: number | null;
  homeShots?: number;
  awayShots?: number;
  narrative?: string;
}): Prisma.InputJsonValue {
  const homeShots = opts.homeShots ?? 10;
  const awayShots = opts.awayShots ?? 10;
  return {
    possession: { home: opts.homePoss, away: opts.awayPoss },
    saves: {
      home: opts.homeSaves ?? null,
      away: opts.awaySaves ?? null,
    },
    shots: { home: homeShots, away: awayShots },
    shotsOnTarget: {
      home: Math.max(1, Math.round(homeShots * 0.4)),
      away: Math.max(1, Math.round(awayShots * 0.4)),
    },
    narrative: opts.narrative ?? null,
  };
}

function teamId(seed: number): string {
  return `00000000-0000-4000-8e1c-${String(seed).padStart(12, "0")}`;
}

function academyId(seed: number): string {
  return `00000000-0000-4000-8ead-${String(seed).padStart(12, "0")}`;
}

function matchId(n: number): string {
  return `00000000-0000-4000-8e1c-${(0x100 + n).toString(16).padStart(12, "0")}`;
}

/** WAT (UTC+1) kickoff stored as ISO with explicit offset. */
function watKickoff(date: string, time: string): string {
  const [h, m] = time.split(":").map((x) => Number(x));
  const hh = String(h).padStart(2, "0");
  const mm = String(m ?? 0).padStart(2, "0");
  return `${date}T${hh}:${mm}:00+01:00`;
}

const TEAMS: TeamSeed[] = [
  {
    seed: 1,
    id: teamId(1),
    slug: "fc-ekpo",
    name: "FC EKPO",
    shortName: "EKP",
    logoUrl:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSb1dt3V4dazvKZLN6mksSGj58fT2QGH0oSGA&s",
    academyId: academyId(1),
  },
  {
    seed: 2,
    id: teamId(2),
    slug: "fc-ipaye",
    name: "FC IPAYE",
    shortName: "IPY",
    logoUrl:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ8ifimMzTNFIDFhvD3LoZw0xorRNI1XREpKg&s",
    academyId: academyId(2),
  },
  {
    seed: 3,
    id: teamId(3),
    slug: "fc-amoo",
    name: "FC AMOO",
    shortName: "AMO",
    logoUrl:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQYTkAPAM4zlIdtxmuHOI4DHJQdXaea-R21bg&s",
    academyId: academyId(3),
  },
  {
    seed: 4,
    id: teamId(4),
    slug: "fc-ogunlade",
    name: "FC OGUNLADE",
    shortName: "OGL",
    logoUrl: "https://www.sports247.ng/wp-content/uploads/2023/12/Akeem-Ogunlade.jpg",
    academyId: academyId(4),
  },
  {
    seed: 5,
    id: teamId(5),
    slug: "fc-agali",
    name: "FC AGALI",
    shortName: "AGL",
    logoUrl:
      "https://media.gettyimages.com/id/965817/photo/portrait-of-victor-agali-of-nigeria-before-the-international-friendly-match-against-japan-played.jpg?s=612x612&w=gi&k=20&c=XEQNjqwZxLNk6YOjOZctSM46gSZaKVvAwvjzhgc8h8M=",
    academyId: academyId(5),
  },
  {
    seed: 6,
    id: teamId(6),
    slug: "fc-oloyede",
    name: "FC OLOYEDE",
    shortName: "OLY",
    logoUrl: "https://independent.ng/wp-content/uploads/Oloyede-22.jpg",
    academyId: academyId(6),
  },
  {
    seed: 7,
    id: teamId(7),
    slug: "fc-ayila",
    name: "FC AYILA",
    shortName: "AYL",
    logoUrl:
      "https://media.gettyimages.com/id/101681823/photo/johannesburg-south-africa-yussuf-ayila-of-nigeria-poses-during-the-official-fifa-world-cup.jpg?s=612x612&w=gi&k=20&c=-sa2gY6mkIY7BxG4Q76PYYyP-c60jS_VgIo54aqVXFw=",
    academyId: academyId(7),
  },
  {
    seed: 8,
    id: teamId(8),
    slug: "fc-aloy",
    name: "FC ALOY",
    shortName: "ALY",
    logoUrl:
      "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEjI5zMRCZuAnDhnpG8kPxOkNH2dAf5j6KVJT2c4RL6ejPnZqW5jKXHFnX7TRQSlL1agKYH-o-043j5xmcmGvglDLIt74vUa5ak8fVwuXCw8WUzhRAELmCPOBKJm0H1gvolUHDmK77qKMuc/s1600/Alloy+Agu.jpg",
    academyId: academyId(8),
  },
  {
    seed: 9,
    id: teamId(9),
    slug: "fc-poto",
    name: "FC POTO",
    shortName: "POT",
    logoUrl:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRQeMNs0hAIkOir5mzFr11PYImHcfno4PQoWg&s",
    academyId: academyId(9),
  },
  {
    seed: 10,
    id: teamId(10),
    slug: "fc-odiaka",
    name: "FC ODIAKA",
    shortName: "ODK",
    logoUrl:
      "https://cdn.vanguardngr.com/wp-content/uploads/2019/02/Odiaka-2-e1551211646614.jpg",
    academyId: academyId(10),
  },
  {
    seed: 11,
    id: teamId(11),
    slug: "fc-giwa",
    name: "FC GIWA",
    shortName: "GIW",
    logoUrl:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQDZf6YkkI973h2ouFeMtfnVS8wfPoR49OKkA&s",
    academyId: academyId(11),
  },
  {
    seed: 12,
    id: teamId(12),
    slug: "fc-temile",
    name: "FC TEMILE",
    shortName: "TEM",
    logoUrl:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQeF8VHdpEC2iYjJNCe7Q5pAyMJerSdPrjrug&s",
    academyId: academyId(12),
  },
  {
    seed: 13,
    id: teamId(13),
    slug: "fc-akanni",
    name: "FC AKANNI",
    shortName: "AKN",
    logoUrl:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTwgehzwz5veXE2Lgfa_UJBQwdAQAtHn_o6jg&s",
    academyId: academyId(13),
  },
  {
    seed: 14,
    id: teamId(14),
    slug: "fc-dominic",
    name: "FC DOMINIC",
    shortName: "DOM",
    logoUrl:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQBScgOi4Xi9A91c4y9KUpvXo_fDYu0h5qPUg&s",
    academyId: academyId(14),
  },
  {
    seed: 15,
    id: teamId(15),
    slug: "fc-babington",
    name: "FC BABINGTON",
    shortName: "BAB",
    logoUrl:
      "https://www.shutterstock.com/editorial/image-editorial/M9z4g252Mdz8Yf36ODQxNw==/michael-babatunde-nigeria-1500w-3869935ha.jpg",
    academyId: academyId(15),
  },
  {
    seed: 16,
    id: teamId(16),
    slug: "fc-dosu",
    name: "FC DOSU",
    shortName: "DOS",
    logoUrl:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSvFawgY08K0X2PgTd022P3fX1pj3NY8yFg3w&s",
    academyId: academyId(16),
  },
  {
    seed: 17,
    id: teamId(17),
    slug: "fc-disu",
    name: "FC DISU",
    shortName: "DIS",
    logoUrl:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRS5YPgT7O-fJGb0NqQPjDXQP5tBldlRiJCMg&s",
    academyId: academyId(17),
  },
  {
    seed: 18,
    id: teamId(18),
    slug: "fc-enegwea",
    name: "FC ENEGWEA",
    shortName: "ENG",
    logoUrl:
      "https://c8.alamy.com/comp/G8JBP4/international-soccer-nigeria-v-cameroon-enegwae-taiwo-nigeria-G8JBP4.jpg",
    academyId: academyId(18),
  },
  {
    seed: 19,
    id: teamId(19),
    slug: "fc-odini",
    name: "FC ODINI",
    shortName: "ODN",
    logoUrl:
      "https://www.sports247.ng/wp-content/uploads/2024/03/Festus-Odini-sports247.jpeg",
    academyId: academyId(19),
  },
  {
    seed: 20,
    id: teamId(20),
    slug: "fc-ikpeba",
    name: "FC IKPEBA",
    shortName: "IKP",
    logoUrl:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQDeudWR_qRSN4ivC1yAo_VATbhLA7O_ysn4A&s",
    academyId: academyId(20),
  },
  {
    seed: 21,
    id: teamId(21),
    slug: "fc-edema",
    name: "FC EDEMA",
    shortName: "EDE",
    logoUrl: null,
    academyId: academyId(21),
  },
  {
    seed: 22,
    id: teamId(22),
    slug: "fc-nieketien",
    name: "FC NIEKETIEN",
    shortName: "NIE",
    logoUrl:
      "https://www.sports247.ng/wp-content/uploads/2024/06/WhatsApp-Image-2024-06-01-at-6.20.13-PM.jpeg",
    academyId: academyId(22),
  },
  {
    seed: 23,
    id: teamId(23),
    slug: "fc-udeze",
    name: "FC UDEZE",
    shortName: "UDZ",
    logoUrl:
      "https://media.gettyimages.com/id/51514162/photo/portrait-of-nigerian-defender-ifeanyi-udeze-taken.jpg?s=612x612&w=gi&k=20&c=sXID760h4k-DQzEoZcK6ytDIFt4PMUqSu1JsZgrTdek=",
    academyId: academyId(23),
  },
  {
    seed: 24,
    id: teamId(24),
    slug: "fc-ugbade",
    name: "FC UGBADE",
    shortName: "UGB",
    logoUrl:
      "https://www.sports247.ng/wp-content/uploads/2025/04/IMG-20250425-WA0009.jpg",
    academyId: academyId(24),
  },
  {
    seed: 25,
    id: teamId(25),
    slug: "fc-atine",
    name: "FC ATINE",
    shortName: "ATN",
    logoUrl:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSBVcB8_GpFLJJY8TKI-4lMOMgmO4r3dOw4Lg&s",
    academyId: academyId(25),
  },
  {
    seed: 26,
    id: teamId(26),
    slug: "fc-obafemi",
    name: "FC OBAFEMI",
    shortName: "OBA",
    logoUrl:
      "https://www.ethiosports.com/wp-content/uploads/2013/03/Obafemi-Martins-Nigeria.jpg",
    academyId: academyId(26),
  },
  {
    seed: 27,
    id: teamId(27),
    slug: "fc-oguntuase",
    name: "FC OGUNTUASE",
    shortName: "OGT",
    logoUrl:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSw5j4CoYXkykk1AzeXCklfCFLHkkFsYGw05A&s",
    academyId: academyId(27),
  },
  {
    seed: 28,
    id: teamId(28),
    slug: "fc-omoruyi",
    name: "FC OMORUYI",
    shortName: "OMO",
    logoUrl:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRC020opy2tlOGj1lN1wtiZAUipcuLq7tgprQ&s",
    academyId: academyId(28),
  },
  {
    seed: 29,
    id: teamId(29),
    slug: "fc-aiyegbeni",
    name: "FC AIYEGBENI",
    shortName: "AIY",
    logoUrl:
      "https://media.gettyimages.com/id/101681662/photo/johannesburg-south-africa-yakubu-aiyegbeni-of-nigeria-poses-during-the-official-fifa-world-cup.jpg?s=612x612&w=gi&k=20&c=WW1jNr8Id69ZcNj_pkUUejl2hQe0qx96GPMp2dkGkD0=",
    academyId: academyId(29),
  },
  {
    seed: 30,
    id: teamId(30),
    slug: "fc-elaho",
    name: "FC ELAHO",
    shortName: "ELA",
    logoUrl:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSaYShRHhRRea2sq54jHvsM5T8wAiWKIsLsgA&s",
    academyId: academyId(30),
  },
  {
    seed: 31,
    id: teamId(31),
    slug: "fc-okpara",
    name: "FC OKPARA",
    shortName: "OKP",
    logoUrl:
      "https://media.gettyimages.com/id/78983754/photo/2000-olympic-games-sydney-australia-men-s-football-australia-2-v-nigeria-3-16th-september.jpg?s=612x612&w=gi&k=20&c=WqXiGSvINbf8vIzm2KjmXX8YtJwa7q3Ojq7wJdWJiBU=",
    academyId: academyId(31),
  },
  {
    seed: 32,
    id: teamId(32),
    slug: "fc-agbai",
    name: "FC AGBAI",
    shortName: "AGB",
    logoUrl:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSqIoZRxgcGxQy8f8sIXDYrAlZQCnpDt_HJdA&s",
    academyId: academyId(32),
  },
];

const MATCHES: MatchSeed[] = [
  {
    id: matchId(1),
    homeSlug: "fc-ekpo",
    awaySlug: "fc-ipaye",
    kickoffAt: watKickoff("2026-06-08", "15:00"),
    venue: "Eleja Pry Sch, Igbogbo, Ikorodu",
    matchday: 1,
    status: "finished",
    minute: 90,
    homeScore: 1,
    awayScore: 3,
    stats: matchStats({
      homePoss: 48,
      awayPoss: 52,
      narrative:
        "FC IPAYE advanced with a 3-1 win over FC EKPO. Sammy Udoh (34'), Anu (#16) and No. 19 struck for Ipaye before Ekpo pulled one back from the penalty spot through No. 5.",
    }),
    events: [
      { type: "goal", minute: 34, teamSlug: "fc-ipaye", playerLabel: "Sammy Udoh" },
      { type: "goal", minute: 52, teamSlug: "fc-ipaye", playerLabel: "Anu", detail: "#16" },
      { type: "goal", minute: 68, teamSlug: "fc-ipaye", playerLabel: "No. 19" },
      { type: "goal", minute: 82, teamSlug: "fc-ekpo", playerLabel: "No. 5", detail: "penalty" },
    ],
  },
  {
    id: matchId(2),
    homeSlug: "fc-agali",
    awaySlug: "fc-oloyede",
    kickoffAt: watKickoff("2026-06-08", "08:00"),
    venue: "Agali Field, Imeke Village, Aradagun, Badagry",
    matchday: 1,
  },
  {
    id: matchId(3),
    homeSlug: "fc-giwa",
    awaySlug: "fc-temile",
    kickoffAt: watKickoff("2026-06-08", "08:00"),
    venue: "Mobolaji Johnson Arena, Onikan",
    matchday: 1,
  },
  {
    id: matchId(4),
    homeSlug: "fc-babington",
    awaySlug: "fc-dosu",
    kickoffAt: watKickoff("2026-06-08", "16:00"),
    venue: "Mobolaji Johnson Arena, Onikan",
    matchday: 1,
    status: "finished",
    minute: 90,
    homeScore: 2,
    awayScore: 1,
    stats: matchStats({
      homePoss: 55,
      awayPoss: 45,
      narrative:
        "FC BABINGTON came from behind to beat FC DOSU 2-1. Dosu led through a first-half strike (26') before Babington equalised (54') and won it late (77') as the Dosu goalkeeper was sent off in the 77th minute.",
    }),
    events: [
      { type: "goal", minute: 26, teamSlug: "fc-dosu", playerLabel: "Player" },
      { type: "goal", minute: 54, teamSlug: "fc-babington", playerLabel: "Player" },
      { type: "goal", minute: 77, teamSlug: "fc-babington", playerLabel: "Player" },
      {
        type: "red_card",
        minute: 77,
        teamSlug: "fc-dosu",
        playerLabel: "Goalkeeper",
        detail: "straight red",
      },
    ],
  },
  {
    id: matchId(5),
    homeSlug: "fc-oguntuase",
    awaySlug: "fc-omoruyi",
    kickoffAt: watKickoff("2026-06-08", "15:00"),
    venue: "CMS Grammar School, Bariga",
    matchday: 1,
    status: "finished",
    minute: 90,
    homeScore: 0,
    awayScore: 1,
    stats: matchStats({
      homePoss: 50,
      awayPoss: 50,
      narrative:
        "FC OMORUYI edged FC OGUNTUASE 1-0 through a late Destiny Nosa strike (84').",
    }),
    events: [
      {
        type: "substitution",
        minute: 46,
        teamSlug: "fc-oguntuase",
        playerLabel: "Anuoluwapo Oluwow",
        assistLabel: "Korede Elejoba",
        detail: "#12 off, #17 on",
      },
      {
        type: "substitution",
        minute: 53,
        teamSlug: "fc-omoruyi",
        playerLabel: "Ololade Yusuf",
        assistLabel: "Destiny",
        detail: "#11 off, #12 on",
      },
      {
        type: "substitution",
        minute: 58,
        teamSlug: "fc-oguntuase",
        playerLabel: "Shodakin Sodiq",
        assistLabel: "Luka Samuel",
        detail: "#9 off, #8 on",
      },
      {
        type: "substitution",
        minute: 58,
        teamSlug: "fc-oguntuase",
        playerLabel: "Jide Oluseye",
        assistLabel: "Baare Adeyemi",
        detail: "#19 off, #14 on",
      },
      {
        type: "substitution",
        minute: 58,
        teamSlug: "fc-oguntuase",
        playerLabel: "Tunde Oladejo",
        assistLabel: "Okanlawon Adedapo",
        detail: "#7 off, #16 on",
      },
      {
        type: "substitution",
        minute: 61,
        teamSlug: "fc-omoruyi",
        playerLabel: "David Adesanya",
        assistLabel: "Sunday Komolafe",
        detail: "#9 off, #7 on",
      },
      { type: "goal", minute: 84, teamSlug: "fc-omoruyi", playerLabel: "Destiny Nosa" },
    ],
  },
  {
    id: matchId(6),
    homeSlug: "fc-amoo",
    awaySlug: "fc-ogunlade",
    kickoffAt: watKickoff("2026-06-09", "10:00"),
    venue: "Main Bowl, National Stadium",
    matchday: 2,
  },
  {
    id: matchId(7),
    homeSlug: "fc-edema",
    awaySlug: "fc-nieketien",
    kickoffAt: watKickoff("2026-06-09", "16:00"),
    venue: "Maracana Sports Complex, Ajegunle",
    matchday: 2,
  },
  {
    id: matchId(8),
    homeSlug: "fc-akanni",
    awaySlug: "fc-dominic",
    kickoffAt: watKickoff("2026-06-10", "13:00"),
    venue: "Mobolaji Johnson Arena, Onikan",
    matchday: 3,
  },
  {
    id: matchId(9),
    homeSlug: "fc-odini",
    awaySlug: "fc-ikpeba",
    kickoffAt: watKickoff("2026-06-10", "07:00"),
    venue: "Alade Stadium, Ayobo-Ipaja",
    matchday: 3,
  },
  {
    id: matchId(10),
    homeSlug: "fc-poto",
    awaySlug: "fc-odiaka",
    kickoffAt: watKickoff("2026-06-11", "16:00"),
    venue: "FHA Field, Festac",
    matchday: 4,
  },
  {
    id: matchId(11),
    homeSlug: "fc-atine",
    awaySlug: "fc-obafemi",
    kickoffAt: watKickoff("2026-06-11", "09:30"),
    venue: "Abesan Estate Mini Stadium",
    matchday: 4,
  },
  {
    id: matchId(12),
    homeSlug: "fc-okpara",
    awaySlug: "fc-agbai",
    kickoffAt: watKickoff("2026-06-11", "15:00"),
    venue: "Gospel City Field, Command Road, Ipaja",
    matchday: 4,
  },
  {
    id: matchId(13),
    homeSlug: "fc-ayila",
    awaySlug: "fc-aloy",
    kickoffAt: watKickoff("2026-06-12", "10:00"),
    venue: "Landmark Sports Complex, Agric Ikorodu",
    matchday: 5,
  },
  {
    id: matchId(14),
    homeSlug: "fc-udeze",
    awaySlug: "fc-ugbade",
    kickoffAt: watKickoff("2026-06-12", "16:00"),
    venue: "Maracana Sports Complex, Ajegunle",
    matchday: 5,
  },
  {
    id: matchId(15),
    homeSlug: "fc-aiyegbeni",
    awaySlug: "fc-elaho",
    kickoffAt: watKickoff("2026-06-12", "09:00"),
    venue: "Legacy Pitch, National Stadium",
    matchday: 5,
  },
  {
    id: matchId(16),
    homeSlug: "fc-disu",
    awaySlug: "fc-enegwea",
    kickoffAt: watKickoff("2026-06-14", "14:00"),
    venue: "Landmark Sports Complex, Agric Ikorodu",
    matchday: 6,
  },
  // R32 second legs (home/away reversed from first leg)
  {
    id: matchId(17),
    homeSlug: "fc-ipaye",
    awaySlug: "fc-ekpo",
    kickoffAt: watKickoff("2026-06-11", "11:00"),
    venue: "Legacy Pitch, National Stadium",
    matchday: 2,
    leg: "second_leg",
    firstLegMatchId: matchId(1),
  },
  {
    id: matchId(18),
    homeSlug: "fc-ogunlade",
    awaySlug: "fc-amoo",
    kickoffAt: watKickoff("2026-06-12", "07:30"),
    venue: "Bethlehem Field, Omo-Onile, Abule-Ado",
    matchday: 2,
    leg: "second_leg",
    firstLegMatchId: matchId(6),
  },
  {
    id: matchId(19),
    homeSlug: "fc-dosu",
    awaySlug: "fc-babington",
    kickoffAt: watKickoff("2026-06-12", "08:00"),
    venue: "Rehab Centre, Isheri-Berger",
    matchday: 2,
    leg: "second_leg",
    firstLegMatchId: matchId(4),
  },
  {
    id: matchId(20),
    homeSlug: "fc-temile",
    awaySlug: "fc-giwa",
    kickoffAt: watKickoff("2026-06-12", "10:00"),
    venue: "Arch. Bishop Aggrey, Mushin",
    matchday: 2,
    leg: "second_leg",
    firstLegMatchId: matchId(3),
  },
  {
    id: matchId(21),
    homeSlug: "fc-ikpeba",
    awaySlug: "fc-odini",
    kickoffAt: watKickoff("2026-06-13", "11:00"),
    venue: "Legacy Pitch, National Stadium",
    matchday: 2,
    leg: "second_leg",
    firstLegMatchId: matchId(9),
  },
  {
    id: matchId(22),
    homeSlug: "fc-ugbade",
    awaySlug: "fc-udeze",
    kickoffAt: watKickoff("2026-06-14", "09:00"),
    venue: "Legacy Pitch, National Stadium",
    matchday: 2,
    leg: "second_leg",
    firstLegMatchId: matchId(14),
  },
  {
    id: matchId(23),
    homeSlug: "fc-elaho",
    awaySlug: "fc-aiyegbeni",
    kickoffAt: watKickoff("2026-06-14", "13:00"),
    venue: "Legacy Pitch, National Stadium",
    matchday: 2,
    leg: "second_leg",
    firstLegMatchId: matchId(15),
  },
  {
    id: matchId(24),
    homeSlug: "fc-agbai",
    awaySlug: "fc-okpara",
    kickoffAt: watKickoff("2026-06-16", "11:00"),
    venue: "Legacy Pitch, National Stadium",
    matchday: 2,
    leg: "second_leg",
    firstLegMatchId: matchId(12),
  },
  {
    id: matchId(25),
    homeSlug: "fc-dominic",
    awaySlug: "fc-akanni",
    kickoffAt: watKickoff("2026-06-16", "13:00"),
    venue: "Legacy Pitch, National Stadium",
    matchday: 2,
    leg: "second_leg",
    firstLegMatchId: matchId(8),
  },
  {
    id: matchId(26),
    homeSlug: "fc-obafemi",
    awaySlug: "fc-atine",
    kickoffAt: watKickoff("2026-06-16", "15:00"),
    venue: "Legacy Pitch, National Stadium",
    matchday: 2,
    leg: "second_leg",
    firstLegMatchId: matchId(11),
  },
  {
    id: matchId(27),
    homeSlug: "fc-oloyede",
    awaySlug: "fc-agali",
    kickoffAt: watKickoff("2026-06-16", "16:00"),
    venue: "Eleja Pry Sch, Igbogbo, Ikorodu",
    matchday: 2,
    leg: "second_leg",
    firstLegMatchId: matchId(2),
  },
  {
    id: matchId(28),
    homeSlug: "fc-aloy",
    awaySlug: "fc-ayila",
    kickoffAt: watKickoff("2026-06-17", "09:00"),
    venue: "Christ Gospel Mission, Command Rd, Ikola, Ipaja",
    matchday: 2,
    leg: "second_leg",
    firstLegMatchId: matchId(13),
  },
  {
    id: matchId(29),
    homeSlug: "fc-odiaka",
    awaySlug: "fc-poto",
    kickoffAt: watKickoff("2026-06-17", "13:00"),
    venue: "Legacy Pitch, National Stadium",
    matchday: 2,
    leg: "second_leg",
    firstLegMatchId: matchId(10),
  },
  {
    id: matchId(30),
    homeSlug: "fc-nieketien",
    awaySlug: "fc-edema",
    kickoffAt: watKickoff("2026-06-17", "15:00"),
    venue: "Nathaniel Idowu Pitch, Unity Pry Sch, Oregie, Ajegunle",
    matchday: 2,
    leg: "second_leg",
    firstLegMatchId: matchId(7),
  },
  {
    id: matchId(31),
    homeSlug: "fc-omoruyi",
    awaySlug: "fc-oguntuase",
    kickoffAt: watKickoff("2026-06-18", "14:00"),
    venue: "St. Jude Primary School, Mushin",
    matchday: 2,
    leg: "second_leg",
    firstLegMatchId: matchId(5),
  },
  {
    id: matchId(32),
    homeSlug: "fc-enegwea",
    awaySlug: "fc-disu",
    kickoffAt: watKickoff("2026-06-19", "16:30"),
    venue: "Nathaniel Idowu Pitch, Unity Pry Sch, Oregie, Ajegunle",
    matchday: 2,
    leg: "second_leg",
    firstLegMatchId: matchId(16),
  },
  // R16 first legs
  {
    id: matchId(33),
    homeSlug: "fc-ipaye",
    awaySlug: "fc-ogunlade",
    kickoffAt: watKickoff("2026-06-18", "11:00"),
    venue: "Legacy Pitch, National Stadium",
    matchday: 1,
    stageKey: "r16",
  },
  {
    id: matchId(34),
    homeSlug: "fc-elaho",
    awaySlug: "fc-okpara",
    kickoffAt: watKickoff("2026-06-21", "13:00"),
    venue: "Legacy Pitch, National Stadium",
    matchday: 1,
    stageKey: "r16",
  },
  {
    id: matchId(35),
    homeSlug: "fc-ikpeba",
    awaySlug: "fc-enegwea",
    kickoffAt: watKickoff("2026-06-22", "11:00"),
    venue: "Legacy Pitch, National Stadium",
    matchday: 1,
    stageKey: "r16",
  },
  {
    id: matchId(36),
    homeSlug: "fc-giwa",
    awaySlug: "fc-odiaka",
    kickoffAt: watKickoff("2026-06-22", "13:00"),
    venue: "Mobolaji Johnson Arena, Onikan",
    matchday: 1,
    stageKey: "r16",
  },
  {
    id: matchId(37),
    homeSlug: "fc-dominic",
    awaySlug: "fc-babington",
    kickoffAt: watKickoff("2026-06-23", "13:00"),
    venue: "Legacy Pitch, National Stadium",
    matchday: 1,
    stageKey: "r16",
  },
  {
    id: matchId(38),
    homeSlug: "fc-obafemi",
    awaySlug: "fc-omoruyi",
    kickoffAt: watKickoff("2026-06-23", "15:00"),
    venue: "Legacy Pitch, National Stadium",
    matchday: 1,
    stageKey: "r16",
  },
  {
    id: matchId(39),
    homeSlug: "fc-oloyede",
    awaySlug: "fc-aloy",
    kickoffAt: watKickoff("2026-06-23", "15:00"),
    venue: "Eleja Pry Sch, Igbogbo, Ikorodu",
    matchday: 1,
    stageKey: "r16",
  },
  {
    id: matchId(40),
    homeSlug: "fc-nieketien",
    awaySlug: "fc-udeze",
    kickoffAt: watKickoff("2026-06-24", "15:00"),
    venue: "Nathaniel Idowu Pitch, Unity Pry Sch, Oregie, Ajegunle",
    matchday: 1,
    stageKey: "r16",
  },
  // R16 second legs (home/away reversed from first leg)
  {
    id: matchId(41),
    homeSlug: "fc-ogunlade",
    awaySlug: "fc-ipaye",
    kickoffAt: watKickoff("2026-06-23", "07:30"),
    venue: "Bethlehem Field, Omo-Onile, Abule-Ado",
    matchday: 2,
    stageKey: "r16",
    leg: "second_leg",
    firstLegMatchId: matchId(33),
  },
  {
    id: matchId(42),
    homeSlug: "fc-okpara",
    awaySlug: "fc-elaho",
    kickoffAt: watKickoff("2026-06-25", "15:00"),
    venue: "Gospel City Field, Command Road, Ipaja",
    matchday: 2,
    stageKey: "r16",
    leg: "second_leg",
    firstLegMatchId: matchId(34),
  },
  {
    id: matchId(43),
    homeSlug: "fc-odiaka",
    awaySlug: "fc-giwa",
    kickoffAt: watKickoff("2026-06-24", "15:00"),
    venue: "Legacy Pitch, National Stadium",
    matchday: 2,
    stageKey: "r16",
    leg: "second_leg",
    firstLegMatchId: matchId(36),
  },
  {
    id: matchId(44),
    homeSlug: "fc-omoruyi",
    awaySlug: "fc-obafemi",
    kickoffAt: watKickoff("2026-06-25", "14:00"),
    venue: "St. Jude Pry Sch, Mushin",
    matchday: 2,
    stageKey: "r16",
    leg: "second_leg",
    firstLegMatchId: matchId(38),
  },
  {
    id: matchId(45),
    homeSlug: "fc-aloy",
    awaySlug: "fc-oloyede",
    kickoffAt: watKickoff("2026-06-26", "10:00"),
    venue: "Gospel City Field, Command Road, Ipaja",
    matchday: 2,
    stageKey: "r16",
    leg: "second_leg",
    firstLegMatchId: matchId(39),
  },
  {
    id: matchId(46),
    homeSlug: "fc-udeze",
    awaySlug: "fc-nieketien",
    kickoffAt: watKickoff("2026-06-26", "15:00"),
    venue: "Navy Barracks, Ajegunle",
    matchday: 2,
    stageKey: "r16",
    leg: "second_leg",
    firstLegMatchId: matchId(40),
  },
  {
    id: matchId(47),
    homeSlug: "fc-babington",
    awaySlug: "fc-dominic",
    kickoffAt: watKickoff("2026-06-26", "16:00"),
    venue: "Mobolaji Johnson Arena, Onikan",
    matchday: 2,
    stageKey: "r16",
    leg: "second_leg",
    firstLegMatchId: matchId(37),
  },
  {
    id: matchId(48),
    homeSlug: "fc-enegwea",
    awaySlug: "fc-ikpeba",
    kickoffAt: watKickoff("2026-06-26", "16:30"),
    venue: "Nathaniel Idowu Pitch, Unity Pry Sch, Oregie, Ajegunle",
    matchday: 2,
    stageKey: "r16",
    leg: "second_leg",
    firstLegMatchId: matchId(35),
  },
];

const BRACKET_LAYOUT = {
  left: [
    [1, 2],
    [3, 4],
    [5, 6],
    [7, 8],
    [9, 10],
    [11, 12],
    [13, 14],
    [15, 16],
  ],
  right: [
    [17, 18],
    [19, 20],
    [21, 22],
    [23, 24],
    [25, 26],
    [27, 28],
    [29, 30],
    [31, 32],
  ],
};

export async function seedExInternationalsCup2026(
  prisma: PrismaClient,
  options?: SeedOptions
) {
  const template = COMPETITION_TEMPLATES.KNOCKOUT_CUP;
  const formatConfig = {
    format: "knockout",
    editionLabel: "Ex Internationals Cup 2026",
    startDate: "2026-06-08",
    timezone: TIMEZONE,
    knockout: { teamCount: 32, legs: 2 },
    bracketImageUrl: BRACKET_ASSET,
    bannerUrl: BRACKET_ASSET,
    imageUrl: BRACKET_ASSET,
    bracketLayout: BRACKET_LAYOUT,
  };

  const comp = await prisma.sbCompetition.upsert({
    where: { slug: COMP_SLUG },
    update: {
      name: "Ex Internationals Cup 2026",
      season: "2026",
      type: "tournament",
      formatType: "KNOCKOUT_CUP",
      formatConfig: formatConfig as Prisma.InputJsonValue,
      country: "Nigeria",
      description:
        "Ex Internationals Cup 2026 — 32-team single-elimination knockout across Lagos venues. Round of 32 fixtures seeded 1v2 through 31v32.",
      isPublished: true,
    },
    create: {
      id: COMP_ID,
      slug: COMP_SLUG,
      name: "Ex Internationals Cup 2026",
      season: "2026",
      type: "tournament",
      formatType: "KNOCKOUT_CUP",
      formatConfig: formatConfig as Prisma.InputJsonValue,
      country: "Nigeria",
      description:
        "Ex Internationals Cup 2026 — 32-team single-elimination knockout across Lagos venues. Round of 32 fixtures seeded 1v2 through 31v32.",
      isPublished: true,
    },
  });

  const stageByKey = new Map<string, string>();
  for (const s of template.stages) {
    const row = await prisma.sbCompetitionStage.upsert({
      where: { competitionId_key: { competitionId: comp.id, key: s.key } },
      update: {
        name: s.name,
        stageType: s.type,
        sortOrder: s.sortOrder,
        config: s as unknown as Prisma.InputJsonValue,
      },
      create: {
        competitionId: comp.id,
        key: s.key,
        name: s.name,
        stageType: s.type,
        sortOrder: s.sortOrder,
        config: s as unknown as Prisma.InputJsonValue,
      },
    });
    stageByKey.set(s.key, row.id);
  }

  const matchIds = MATCHES.map((m) => m.id);
  const teamSlugs = TEAMS.map((t) => t.slug);

  if (isFullSeed(options)) {
    await prisma.sbMatch.deleteMany({
      where: { competitionId: comp.id, id: { notIn: matchIds } },
    });
    await prisma.sbTeam.deleteMany({
      where: { competitionId: comp.id, slug: { notIn: teamSlugs } },
    });
  }

  let academyCount = 0;
  const teamIds: Record<string, string> = {};
  const passwordHash = await bcrypt.hash(EX_INTL_ACADEMY_SEED_PASSWORD, 10);
  const full = isFullSeed(options);

  for (const t of TEAMS) {
    const academySlug = `ex-intl-${t.slug}`;
    const academyShared = {
      name: normalizeClubName(t.name),
      city: "Lagos",
      country: "Nigeria",
      logoUrl: t.logoUrl,
      isPublished: true,
      loginUsername: t.slug,
      description: `Ex Internationals Cup 2026 participant — ${normalizeClubName(t.name)} (seed ${t.seed}).`,
    };
    await prisma.academy.upsert({
      where: { slug: academySlug },
      update: full ? { ...academyShared, passwordHash } : academyShared,
      create: {
        id: t.academyId,
        slug: academySlug,
        name: normalizeClubName(t.name),
        city: "Lagos",
        country: "Nigeria",
        logoUrl: t.logoUrl,
        isPublished: true,
        loginUsername: t.slug,
        passwordHash,
        description: `Ex Internationals Cup 2026 participant — ${normalizeClubName(t.name)} (seed ${t.seed}).`,
      },
    });
    academyCount += 1;

    const name = normalizeClubName(t.name);
    const row = await prisma.sbTeam.upsert({
      where: { competitionId_slug: { competitionId: comp.id, slug: t.slug } },
      update: {
        name,
        shortName: t.shortName,
        groupKey: String(t.seed),
        city: "Lagos",
        logoUrl: t.logoUrl,
      },
      create: {
        id: t.id,
        competitionId: comp.id,
        slug: t.slug,
        name,
        shortName: t.shortName,
        groupKey: String(t.seed),
        city: "Lagos",
        logoUrl: t.logoUrl,
      },
    });
    teamIds[t.slug] = row.id;
  }

  const r32StageId = stageByKey.get("r32");
  let eventCount = 0;
  const usedMatchSlugs = await loadExistingMatchSlugs(prisma);
  for (const m of MATCHES) {
    const preserve = await shouldPreserveSbMatch(prisma, m.id, options);
    const status = m.status ?? "scheduled";
    const homeScore = m.homeScore ?? 0;
    const awayScore = m.awayScore ?? 0;
    const minute = status === "finished" ? (m.minute ?? 90) : null;
    const leg = m.leg ?? "first_leg";
    const stageKey = m.stageKey ?? "r32";
    const stageId = stageByKey.get(stageKey) ?? r32StageId;
    const knockoutRound = stageKey === "r16" ? "R16" : "R32";
    const roundBase = stageKey === "r16" ? "Round of 16" : "Round of 32";
    const meta: Prisma.InputJsonValue = {
      knockoutRound,
      round: knockoutRound,
      timezone: TIMEZONE,
      leg,
      ...(m.firstLegMatchId
        ? { firstLegMatchId: m.firstLegMatchId, aggregateScore: null }
        : {}),
    };
    const roundLabel =
      leg === "second_leg" ? `${roundBase} — Leg 2` : roundBase;
    const slug = allocateMatchSlug(m.homeSlug, m.awaySlug, usedMatchSlugs, leg);

    if (!preserve) {
      await prisma.sbMatch.upsert({
        where: { id: m.id },
        update: {
          slug,
          homeScore,
          awayScore,
          status,
          minute,
          stats: m.stats ?? null,
          meta,
          stageKey,
          stageId,
          matchday: m.matchday,
          roundLabel,
          venue: m.venue,
          kickoffAt: new Date(m.kickoffAt),
          homeTeamId: teamIds[m.homeSlug],
          awayTeamId: teamIds[m.awaySlug],
        },
        create: {
          id: m.id,
          slug,
          competitionId: comp.id,
          stageId,
          stageKey,
          matchday: m.matchday,
          homeTeamId: teamIds[m.homeSlug],
          awayTeamId: teamIds[m.awaySlug],
          status,
          homeScore,
          awayScore,
          minute,
          kickoffAt: new Date(m.kickoffAt),
          venue: m.venue,
          roundLabel,
          stats: m.stats ?? null,
          meta,
        },
      });

      if (full) {
        await prisma.sbMatchEvent.deleteMany({ where: { matchId: m.id } });
      }

      for (const ev of m.events ?? []) {
        await prisma.sbMatchEvent.create({
          data: {
            matchId: m.id,
            teamId: teamIds[ev.teamSlug],
            type: ev.type,
            minute: ev.minute,
            playerLabel: ev.playerLabel,
            assistLabel: ev.assistLabel,
            detail: ev.detail,
          },
        });
        eventCount += 1;
      }
    }
  }

  const [teamCount, matchCount] = await Promise.all([
    prisma.sbTeam.count({ where: { competitionId: comp.id } }),
    prisma.sbMatch.count({ where: { competitionId: comp.id } }),
  ]);

  console.log("Ex Internationals Cup 2026 seeded:", COMP_SLUG);
  console.log("  teams:", teamCount, "(expected 32)");
  console.log("  matches:", matchCount, "(expected 48 — 32 R32 + 16 R16)");
  console.log("  events:", eventCount);
  console.log("  academies:", academyCount);
  console.log(
    `  academy logins: username=<team-slug e.g. fc-ekpo> password=${EX_INTL_ACADEMY_SEED_PASSWORD}`
  );
  console.log("  bracket:", BRACKET_ASSET);
  return { comp, teamCount, matchCount, academyCount };
}
