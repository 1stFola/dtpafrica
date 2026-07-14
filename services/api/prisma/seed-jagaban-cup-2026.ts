// @ts-nocheck
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildJagabanCupStages,
  normalizeClubName,
  normalizePlayerName,
  playerLookupKey,
  toGoogleDrivePreviewUrl,
  toMatchPhotoEntries,
} from "@dtp/engines";
import {
  isFullSeed,
  shouldPreserveSbMatch,
  type SeedOptions,
} from "../src/seed/seed-options";
import { JAGABAN_MATCH_MEDIA } from "./seed-jagaban-media-data";
import { allocateMatchSlug, loadExistingMatchSlugs } from "../src/scoreboard/match-slug";
import { resolveUniquePlayerSlug } from "../src/players/player-slug";

const COMP_SLUG = "jagaban-cup-2026";
const COMP_ID = "00000000-0000-4000-8jc0-000000000001";
const LEGACY_VENUE = "Legacy Pitch - Surulere Lagos";

type TeamSeed = {
  slug: string;
  name: string;
  shortName: string;
  groupKey: "A" | "B";
  city?: string;
  logoUrl: string;
};

type SquadSeed = {
  teamSlug: string;
  displayName: string;
  position?: string;
  shirtNumber?: number;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string | null;
  imageUrl?: string | null;
};

type SeededSquadRow = {
  id: string;
  teamId: string;
  playerId: string | null;
  displayName: string;
  position: string | null;
  shirtNumber: number | null;
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
  stageKey: string;
  matchday: number;
  roundLabel: string;
  kickoffAt: string;
  venue: string;
  homeScore: number;
  awayScore: number;
  stats: Prisma.InputJsonValue;
  meta?: Prisma.InputJsonValue;
  events: EventSeed[];
};

const TEAMS: TeamSeed[] = [
  {
    slug: "sgfc-athletics",
    name: "SGFC Athletics SC",
    shortName: "SGFC",
    groupKey: "A",
    city: "Lagos",
    logoUrl:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTBZU0CsIuq_Oh7tqhPA1zo8eXf27LQ0SN9P99eGQx0eCPTcixCo9cIAGatr1_TYgg_h3ioDD20DFsmXBDoJy0NAGw&s&ec=121630540",
  },
  {
    slug: "36-lions-fc",
    name: "36 Lion FC",
    shortName: "36L",
    groupKey: "A",
    city: "Lagos",
    logoUrl:
      "https://36lionfc.com/wp-content/uploads/2021/10/Untitled-design-25.png",
  },
  {
    slug: "fc-bethel",
    name: "FC Bethel Sporting",
    shortName: "BTH",
    groupKey: "A",
    city: "Lagos",
    logoUrl:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT7GCH_ePTnUUA1_bbT2_QgnPAiHDfI6o95_Q&s",
  },
  {
    slug: "klassisc-fc",
    name: "Klassisch FA",
    shortName: "KLA",
    groupKey: "A",
    city: "Lagos",
    logoUrl:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTJ5bYL-YkWg1DkeMyKLUlME-qIDSNkrYerdQ&s",
  },
  {
    slug: "ikorodu-city-fc",
    name: "Ikorodu City FC",
    shortName: "IKC",
    groupKey: "B",
    city: "Ikorodu",
    logoUrl: "https://www.ikoroducityfc.com/wp-content/uploads/2024/07/ikd-logo.png",
  },
  {
    slug: "smart-city-fc",
    name: "Smart City FC",
    shortName: "SMC",
    groupKey: "B",
    city: "Lagos",
    logoUrl: "https://smartcityfc.com.ng/wp-content/uploads/2026/02/download.png",
  },
  {
    slug: "mavlon-fc",
    name: "Mavlon FC",
    shortName: "MAV",
    groupKey: "B",
    city: "Lagos",
    logoUrl:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSNMw_9BsRdd0ICTeIfU_QvLp5dMNqTUpBd8A&s",
  },
  {
    slug: "broad-city-fc",
    name: "Broad City FC",
    shortName: "BRC",
    groupKey: "B",
    city: "Lagos",
    logoUrl:
      "https://static.wixstatic.com/media/f54d0c_e63c8669ed3248fd8e5866263926fc60~mv2.png/v1/fill/w_120,h_222,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/989a161b-b1d5-45ad-92ad-a91344061fb8.png",
  },
];

/** Placeholder squads for event linking (display names match match events). */
const SQUAD: SquadSeed[] = [
  { teamSlug: "sgfc-athletics", displayName: "Micheal Hunsa", position: "FW", shirtNumber: 9 },
  { teamSlug: "sgfc-athletics", displayName: "Igaga", position: "GK", shirtNumber: 1 },
  { teamSlug: "sgfc-athletics", displayName: "Abdulmartin", position: "MF", shirtNumber: 6 },
  { teamSlug: "sgfc-athletics", displayName: "Faisal Umar", position: "GK", shirtNumber: 22 },
  { teamSlug: "36-lions-fc", displayName: "Uche Emeribe", position: "FW", shirtNumber: 11 },
  { teamSlug: "36-lions-fc", displayName: "Azuka Alatan", position: "FW", shirtNumber: 7 },
  { teamSlug: "36-lions-fc", displayName: "Okwuosa Chukwudi", position: "MF", shirtNumber: 10 },
  { teamSlug: "36-lions-fc", displayName: "Gbadamosi Sulieman", position: "GK", shirtNumber: 1 },
  { teamSlug: "36-lions-fc", displayName: "Nonso", position: "DF", shirtNumber: 4 },
  { teamSlug: "36-lions-fc", displayName: "Stephen Uche", position: "MF", shirtNumber: 8 },
  { teamSlug: "36-lions-fc", displayName: "Soumah Mohamed", position: "MF", shirtNumber: 14 },
  { teamSlug: "fc-bethel", displayName: "Amos Akinsipe", position: "DF", shirtNumber: 5 },
  { teamSlug: "fc-bethel", displayName: "Tijani Ridwan", position: "FW", shirtNumber: 9 },
  { teamSlug: "fc-bethel", displayName: "Ebuka Emmanuel", position: "FW", shirtNumber: 11 },
  { teamSlug: "fc-bethel", displayName: "Ezekiel Victor", position: "FW", shirtNumber: 19 },
  { teamSlug: "fc-bethel", displayName: "Muhammed Adeiza", position: "MF", shirtNumber: 8 },
  { teamSlug: "fc-bethel", displayName: "Dagogo Ifubara", position: "MF", shirtNumber: 6 },
  { teamSlug: "klassisc-fc", displayName: "Charles Obani", position: "FW", shirtNumber: 9 },
  { teamSlug: "klassisc-fc", displayName: "Buhari Saeed", position: "FW", shirtNumber: 11 },
  { teamSlug: "klassisc-fc", displayName: "Uche", position: "GK", shirtNumber: 1 },
  { teamSlug: "ikorodu-city-fc", displayName: "Farouk Salami", position: "FW", shirtNumber: 10 },
  { teamSlug: "ikorodu-city-fc", displayName: "Hassan Haddi", position: "MF", shirtNumber: 8 },
  { teamSlug: "ikorodu-city-fc", displayName: "Ali Moses", position: "FW", shirtNumber: 9 },
  { teamSlug: "ikorodu-city-fc", displayName: "Aderemi Adeoye", position: "DF", shirtNumber: 5 },
  { teamSlug: "ikorodu-city-fc", displayName: "Nasiru Sulaimon", position: "FW", shirtNumber: 7 },
  { teamSlug: "ikorodu-city-fc", displayName: "Awal Abdulkareem", position: "FW", shirtNumber: 17 },
  { teamSlug: "ikorodu-city-fc", displayName: "Oladeji", position: "GK", shirtNumber: 1 },
  { teamSlug: "smart-city-fc", displayName: "Daniel Adetunji", position: "DF", shirtNumber: 3 },
  { teamSlug: "smart-city-fc", displayName: "Tominwa Awojobi", position: "FW", shirtNumber: 11 },
  { teamSlug: "smart-city-fc", displayName: "Uche Jaguar", position: "MF", shirtNumber: 10 },
  { teamSlug: "smart-city-fc", displayName: "Muiz Lawal", position: "FW", shirtNumber: 9 },
  { teamSlug: "smart-city-fc", displayName: "Ayomide Bakare", position: "FW", shirtNumber: 7 },
  { teamSlug: "smart-city-fc", displayName: "Hanif Sanusi", position: "MF", shirtNumber: 6 },
  { teamSlug: "smart-city-fc", displayName: "Hassan Haddi", position: "AM", shirtNumber: 10 },
  { teamSlug: "smart-city-fc", displayName: "Warith Olaoye", position: "MF", shirtNumber: 8 },
  { teamSlug: "smart-city-fc", displayName: "Godwin", position: "GK", shirtNumber: 1 },
  { teamSlug: "mavlon-fc", displayName: "Quadri Adewale", position: "DF", shirtNumber: 4 },
  { teamSlug: "mavlon-fc", displayName: "Ifeanyi Onyene", position: "FW", shirtNumber: 9 },
  { teamSlug: "mavlon-fc", displayName: "Kufre", position: "GK", shirtNumber: 1 },
  { teamSlug: "broad-city-fc", displayName: "Ayomide Bakare", position: "FW", shirtNumber: 11 },
  { teamSlug: "broad-city-fc", displayName: "Noah Idris", position: "FW", shirtNumber: 9 },
  { teamSlug: "broad-city-fc", displayName: "Ahmed Adesanu", position: "MF", shirtNumber: 7 },
  { teamSlug: "broad-city-fc", displayName: "Uche Ezugwu", position: "FW", shirtNumber: 10 },
  { teamSlug: "broad-city-fc", displayName: "Christopher Jeremiah", position: "FW", shirtNumber: 14 },
  { teamSlug: "broad-city-fc", displayName: "Emmanuel Udeogu", position: "MF", shirtNumber: 6 },
  { teamSlug: "broad-city-fc", displayName: "Solomon Agbalaka", position: "FW", shirtNumber: 19 },
  { teamSlug: "broad-city-fc", displayName: "Muiz Lawal", position: "FW", shirtNumber: 20 },
];

const SQUAD_ROSTER_ASSET = "seed-jagaban-squad-rosters.txt";
const SQUAD_TEAM_SLUGS: Record<string, string> = {
  "36 Lion FC": "36-lions-fc",
  "FC Bethel Sporting": "fc-bethel",
  "Mavlon FC": "mavlon-fc",
  "SGFC ATHLETICS SC": "sgfc-athletics",
  "Smart City FC": "smart-city-fc",
  "Broad City FC": "broad-city-fc",
};

function normalizeSeedDate(raw?: string | null): Date | null {
  if (!raw?.trim()) return null;
  const normalized = raw
    .trim()
    .replace(/\bSept\.\b/i, "Sep")
    .replace(/\bSept\b/i, "Sep")
    .replace(/\bJan\.\b/i, "Jan")
    .replace(/\bFeb\.\b/i, "Feb")
    .replace(/\bMar\.\b/i, "Mar")
    .replace(/\bApr\.\b/i, "Apr")
    .replace(/\bJun\.\b/i, "Jun")
    .replace(/\bJul\.\b/i, "Jul")
    .replace(/\bAug\.\b/i, "Aug")
    .replace(/\bOct\.\b/i, "Oct")
    .replace(/\bNov\.\b/i, "Nov")
    .replace(/\bDec\.\b/i, "Dec")
    .replace(/\./g, "");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function titleCaseName(raw?: string | null) {
  return (raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function splitDisplayName(displayName: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? displayName,
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : "",
  };
}

function readFullSquadRows(): SquadSeed[] {
  const candidatePaths = [
    join(__dirname, SQUAD_ROSTER_ASSET),
    join(__dirname, "../../../..", "prisma", SQUAD_ROSTER_ASSET),
    join(process.cwd(), "prisma", SQUAD_ROSTER_ASSET),
    join(process.cwd(), "services/api/prisma", SQUAD_ROSTER_ASSET),
  ];
  const assetPath = candidatePaths.find((path) => existsSync(path));
  if (!assetPath) {
    throw new Error(
      `Missing ${SQUAD_ROSTER_ASSET}. Checked: ${candidatePaths.join(", ")}`
    );
  }
  const text = readFileSync(assetPath, "utf8");
  let teamSlug: string | null = null;
  const rows: SquadSeed[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("Team Name - ")) {
      const teamName = line.slice("Team Name - ".length).trim();
      teamSlug = SQUAD_TEAM_SLUGS[teamName] ?? null;
      continue;
    }
    if (!teamSlug || line.toLowerCase().startsWith("jersey number")) continue;

    const parts = line.split(",").map((part) => part.trim());
    const shirtNumber = Number.parseInt(parts[0] ?? "", 10);
    if (!Number.isFinite(shirtNumber)) continue;

    let firstName = parts[1] ?? "";
    let lastName = parts[2] ?? "";
    let dateOfBirth = parts[3] ?? "";
    let position = parts[4] ?? "";
    let imageUrl = parts.slice(5).join(",").trim() || null;

    // Repair a known Broad City row with an accidental empty DOB column.
    if (!dateOfBirth && /^\d{1,2}-/.test(parts[4] ?? "")) {
      dateOfBirth = parts[4] ?? "";
      position = parts[5] ?? "";
      imageUrl = parts.slice(6).join(",").trim() || null;
    }

    const displayName = normalizePlayerName(`${firstName} ${lastName}`.trim());
    if (!displayName) continue;

    rows.push({
      teamSlug,
      displayName,
      firstName: titleCaseName(firstName),
      lastName: titleCaseName(lastName),
      dateOfBirth: dateOfBirth || null,
      position: position || undefined,
      shirtNumber,
      imageUrl,
    });
  }

  return rows;
}

function mergedSquadRows() {
  const byKey = new Map<string, SquadSeed>();
  for (const row of SQUAD) {
    byKey.set(`${row.teamSlug}:${normalizePlayerName(row.displayName)}`, row);
  }
  for (const row of readFullSquadRows()) {
    byKey.set(`${row.teamSlug}:${normalizePlayerName(row.displayName)}`, row);
  }
  return [...byKey.values()];
}

function matchStats(opts: {
  homePoss: number;
  awayPoss: number;
  homeSaves?: number;
  awaySaves?: number;
  homeShots?: number;
  awayShots?: number;
  narrative?: string;
  extras?: Record<string, unknown>;
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
    ...opts.extras,
  };
}

const MATCHES: MatchSeed[] = [
  // DAY 1 — Match 1
  {
    id: "00000000-0000-4000-8jc0-000000000101",
    homeSlug: "sgfc-athletics",
    awaySlug: "36-lions-fc",
    stageKey: "group_a",
    matchday: 1,
    roundLabel: "Group A · DAY 1",
    kickoffAt: "2026-05-20T09:00:00Z",
    venue: LEGACY_VENUE,
    homeScore: 1,
    awayScore: 3,
    stats: matchStats({
      homePoss: 55,
      awayPoss: 45,
      homeSaves: 2,
      awaySaves: 2,
      homeShots: 8,
      awayShots: 12,
      narrative:
        "36 Lions FC opened Jagaban Cup 2026 with a convincing 3-1 win over SGFC Athletics. Uche Emeribe, Azuka Alatan and Okwuosa Chukwudi scored for the Lions; Micheal Hunsa pulled one back late for SGFC. Goalkeepers Igaga and Gbadamosi Sulieman made key saves at both ends.",
    }),
    events: [
      { type: "goal", minute: 15, teamSlug: "36-lions-fc", playerLabel: "Uche Emeribe" },
      { type: "goal", minute: 26, teamSlug: "36-lions-fc", playerLabel: "Azuka Alatan" },
      { type: "goal", minute: 42, teamSlug: "36-lions-fc", playerLabel: "Okwuosa Chukwudi" },
      { type: "goal", minute: 59, teamSlug: "sgfc-athletics", playerLabel: "Micheal Hunsa" },
    ],
  },
  // DAY 1 — Match 2
  {
    id: "00000000-0000-4000-8jc0-000000000102",
    homeSlug: "ikorodu-city-fc",
    awaySlug: "smart-city-fc",
    stageKey: "group_b",
    matchday: 1,
    roundLabel: "Group B · DAY 1",
    kickoffAt: "2026-05-20T11:30:00Z",
    venue: LEGACY_VENUE,
    homeScore: 3,
    awayScore: 2,
    stats: matchStats({
      homePoss: 60,
      awayPoss: 40,
      homeSaves: 4,
      awaySaves: 3,
      narrative:
        "Ikorodu City FC edged a five-goal thriller 3-2 against Smart City FC. Farouk Salami, Hassan Haddi and Ali Moses struck for Ikorodu; Tominwa Awojobi (assist Uche Jaguar) and Muiz Lawal replied. Daniel Adetunji was booked early for Smart City. Oladeji and Godwin combined for seven saves between the posts.",
    }),
    events: [
      { type: "yellow_card", minute: 10, teamSlug: "smart-city-fc", playerLabel: "Daniel Adetunji", detail: "Foul" },
      { type: "goal", minute: 29, teamSlug: "ikorodu-city-fc", playerLabel: "Farouk Salami" },
      { type: "goal", minute: 31, teamSlug: "ikorodu-city-fc", playerLabel: "Hassan Haddi" },
      { type: "goal", minute: 41, teamSlug: "ikorodu-city-fc", playerLabel: "Ali Moses" },
      {
        type: "goal",
        minute: 48,
        teamSlug: "smart-city-fc",
        playerLabel: "Tominwa Awojobi",
        assistLabel: "Uche Jaguar",
      },
      { type: "goal", minute: 52, teamSlug: "smart-city-fc", playerLabel: "Muiz Lawal" },
    ],
  },
  // DAY 1 — Match 3
  {
    id: "00000000-0000-4000-8jc0-000000000103",
    homeSlug: "fc-bethel",
    awaySlug: "klassisc-fc",
    stageKey: "group_a",
    matchday: 1,
    roundLabel: "Group A · DAY 1",
    kickoffAt: "2026-05-20T14:00:00Z",
    venue: LEGACY_VENUE,
    homeScore: 0,
    awayScore: 1,
    stats: matchStats({
      homePoss: 60,
      awayPoss: 40,
      homeSaves: 2,
      awaySaves: 3,
      narrative:
        "Klassisc FC beat FC Bethel 1-0 from the penalty spot through Charles Obani (25'). Amos Akinsipe was cautioned for Bethel. Keepers Umar and Uche were busy with five saves combined.",
    }),
    events: [
      { type: "yellow_card", minute: 8, teamSlug: "fc-bethel", playerLabel: "Amos Akinsipe", detail: "Foul" },
      { type: "goal", minute: 25, teamSlug: "klassisc-fc", playerLabel: "Charles Obani", detail: "penalty" },
    ],
  },
  // DAY 1 — Match 4
  {
    id: "00000000-0000-4000-8jc0-000000000104",
    homeSlug: "mavlon-fc",
    awaySlug: "broad-city-fc",
    stageKey: "group_b",
    matchday: 1,
    roundLabel: "Group B · DAY 1",
    kickoffAt: "2026-05-20T16:30:00Z",
    venue: LEGACY_VENUE,
    homeScore: 1,
    awayScore: 4,
    stats: matchStats({
      homePoss: 35,
      awayPoss: 65,
      homeShots: 6,
      awayShots: 16,
      narrative:
        "Broad City FC routed Mavlon 4-1 in an dominant display (65% possession). Ayomide Bakare, Noah Idris, Ahmed Adesanu, Uche Ezugwu (assist Ahmed Adesanu) and Christopher Jeremiah (assist Uche Ezugwu) scored. Quadri Adewale was yellow-carded for Mavlon.",
    }),
    events: [
      { type: "goal", minute: 12, teamSlug: "broad-city-fc", playerLabel: "Ayomide Bakare" },
      { type: "goal", minute: 15, teamSlug: "broad-city-fc", playerLabel: "Noah Idris" },
      { type: "goal", minute: 17, teamSlug: "broad-city-fc", playerLabel: "Ahmed Adesanu" },
      {
        type: "goal",
        minute: 23,
        teamSlug: "broad-city-fc",
        playerLabel: "Uche Ezugwu",
        assistLabel: "Ahmed Adesanu",
      },
      {
        type: "goal",
        minute: 25,
        teamSlug: "broad-city-fc",
        playerLabel: "Christopher Jeremiah",
        assistLabel: "Uche Ezugwu",
      },
      { type: "yellow_card", minute: 42, teamSlug: "mavlon-fc", playerLabel: "Quadri Adewale", detail: "Foul" },
    ],
  },
  // DAY 2 — Match 5
  {
    id: "00000000-0000-4000-8jc0-000000000201",
    homeSlug: "sgfc-athletics",
    awaySlug: "fc-bethel",
    stageKey: "group_a",
    matchday: 2,
    roundLabel: "Group A · DAY 2",
    kickoffAt: "2026-05-21T09:00:00Z",
    venue: LEGACY_VENUE,
    homeScore: 0,
    awayScore: 1,
    stats: matchStats({
      homePoss: 60,
      awayPoss: 40,
      narrative: "Tijani Ridwan's sixth-minute strike was enough for FC Bethel to beat SGFC Athletics 1-0.",
    }),
    events: [{ type: "goal", minute: 6, teamSlug: "fc-bethel", playerLabel: "Tijani Ridwan" }],
  },
  // DAY 2 — Match 6
  {
    id: "00000000-0000-4000-8jc0-000000000202",
    homeSlug: "smart-city-fc",
    awaySlug: "mavlon-fc",
    stageKey: "group_b",
    matchday: 2,
    roundLabel: "Group B · DAY 2",
    kickoffAt: "2026-05-21T11:30:00Z",
    venue: LEGACY_VENUE,
    homeScore: 0,
    awayScore: 1,
    stats: matchStats({
      homePoss: 50,
      awayPoss: 50,
      homeSaves: 5,
      awaySaves: 4,
      narrative:
        "Mavlon FC won 1-0 thanks to Ifeanyi Onyene (40'). Smart City goalkeeper Kufre made four standout saves to keep the score close.",
    }),
    events: [{ type: "goal", minute: 40, teamSlug: "mavlon-fc", playerLabel: "Ifeanyi Onyene" }],
  },
  // DAY 2 — Match 7
  {
    id: "00000000-0000-4000-8jc0-000000000203",
    homeSlug: "klassisc-fc",
    awaySlug: "36-lions-fc",
    stageKey: "group_a",
    matchday: 2,
    roundLabel: "Group A · DAY 2",
    kickoffAt: "2026-05-21T14:00:00Z",
    venue: LEGACY_VENUE,
    homeScore: 0,
    awayScore: 0,
    stats: matchStats({
      homePoss: 50,
      awayPoss: 50,
      narrative: "Klassisc FC and 36 Lions FC played out a goalless draw. Nonso was booked for Klassisc.",
    }),
    events: [{ type: "yellow_card", minute: 19, teamSlug: "klassisc-fc", playerLabel: "Nonso", detail: "Foul" }],
  },
  // DAY 2 — Match 8
  {
    id: "00000000-0000-4000-8jc0-000000000204",
    homeSlug: "broad-city-fc",
    awaySlug: "ikorodu-city-fc",
    stageKey: "group_b",
    matchday: 2,
    roundLabel: "Group B · DAY 2",
    kickoffAt: "2026-05-21T16:30:00Z",
    venue: LEGACY_VENUE,
    homeScore: 1,
    awayScore: 0,
    stats: matchStats({
      homePoss: 52,
      awayPoss: 48,
      narrative:
        "Emmanuel Udeogu (15') gave Broad City a 1-0 win over Ikorodu. Aderemi Adeoye was sent off for Ikorodu on a second yellow (57').",
    }),
    events: [
      { type: "goal", minute: 15, teamSlug: "broad-city-fc", playerLabel: "Emmanuel Udeogu" },
      {
        type: "red_card",
        minute: 57,
        teamSlug: "ikorodu-city-fc",
        playerLabel: "Aderemi Adeoye",
        detail: "second yellow",
      },
    ],
  },
  // DAY 3 — Match 9
  {
    id: "00000000-0000-4000-8jc0-000000000301",
    homeSlug: "36-lions-fc",
    awaySlug: "fc-bethel",
    stageKey: "group_a",
    matchday: 3,
    roundLabel: "Group A · DAY 3",
    kickoffAt: "2026-05-22T09:00:00Z",
    venue: LEGACY_VENUE,
    homeScore: 0,
    awayScore: 1,
    stats: matchStats({
      homePoss: 48,
      awayPoss: 52,
      narrative:
        "Ebuka Emmanuel (30') secured FC Bethel a 1-0 win over 36 Lions. Stephen Uche and Soumah Mohamed were cautioned for the Lions.",
    }),
    events: [
      { type: "goal", minute: 30, teamSlug: "fc-bethel", playerLabel: "Ebuka Emmanuel" },
      { type: "yellow_card", minute: 42, teamSlug: "36-lions-fc", playerLabel: "Stephen Uche", detail: "Foul" },
      { type: "yellow_card", minute: 59, teamSlug: "36-lions-fc", playerLabel: "Soumah Mohamed", detail: "Foul" },
    ],
  },
  // DAY 3 — Match 10
  {
    id: "00000000-0000-4000-8jc0-000000000302",
    homeSlug: "ikorodu-city-fc",
    awaySlug: "mavlon-fc",
    stageKey: "group_b",
    matchday: 3,
    roundLabel: "Group B · DAY 3",
    kickoffAt: "2026-05-22T11:30:00Z",
    venue: LEGACY_VENUE,
    homeScore: 2,
    awayScore: 0,
    stats: matchStats({
      homePoss: 58,
      awayPoss: 42,
      narrative:
        "Ikorodu City FC beat Mavlon 2-0 with second-half goals from Nasiru Sulaimon (50') and Awal Abdulkareem (58' pen).",
    }),
    events: [
      { type: "goal", minute: 50, teamSlug: "ikorodu-city-fc", playerLabel: "Nasiru Sulaimon" },
      { type: "goal", minute: 58, teamSlug: "ikorodu-city-fc", playerLabel: "Awal Abdulkareem", detail: "penalty" },
    ],
  },
  // DAY 3 — Match 11
  {
    id: "00000000-0000-4000-8jc0-000000000303",
    homeSlug: "sgfc-athletics",
    awaySlug: "klassisc-fc",
    stageKey: "group_a",
    matchday: 3,
    roundLabel: "Group A · DAY 3",
    kickoffAt: "2026-05-22T14:00:00Z",
    venue: LEGACY_VENUE,
    homeScore: 0,
    awayScore: 1,
    stats: matchStats({
      homePoss: 45,
      awayPoss: 55,
      narrative:
        "Klassisc FC defeated SGFC 1-0. Buhari Saeed (21', assist Charles Obani) scored; Abdulmartin was booked and goalkeeper Faisal Umar was sent off (58').",
    }),
    events: [
      {
        type: "goal",
        minute: 21,
        teamSlug: "klassisc-fc",
        playerLabel: "Buhari Saeed",
        assistLabel: "Charles Obani",
      },
      { type: "yellow_card", minute: 49, teamSlug: "sgfc-athletics", playerLabel: "Abdulmartin", detail: "Foul" },
      {
        type: "red_card",
        minute: 58,
        teamSlug: "sgfc-athletics",
        playerLabel: "Faisal Umar",
        detail: "GK — second bookable offence",
      },
    ],
  },
  // DAY 3 — Match 12
  {
    id: "00000000-0000-4000-8jc0-000000000304",
    homeSlug: "smart-city-fc",
    awaySlug: "broad-city-fc",
    stageKey: "group_b",
    matchday: 3,
    roundLabel: "Group B · DAY 3",
    kickoffAt: "2026-05-22T16:30:00Z",
    venue: LEGACY_VENUE,
    homeScore: 2,
    awayScore: 1,
    stats: matchStats({
      homePoss: 51,
      awayPoss: 49,
      narrative:
        "Smart City FC beat Broad City 2-1. Ayomide Bakare (6', assist Hanif Sanusi) and Hassan Haddi (30', assist Warith Olaoye) scored; Muiz Lawal pulled one back for Broad City (50').",
    }),
    events: [
      {
        type: "goal",
        minute: 6,
        teamSlug: "smart-city-fc",
        playerLabel: "Ayomide Bakare",
        assistLabel: "Hanif Sanusi",
      },
      {
        type: "goal",
        minute: 30,
        teamSlug: "smart-city-fc",
        playerLabel: "Hassan Haddi",
        assistLabel: "Warith Olaoye",
      },
      { type: "goal", minute: 50, teamSlug: "broad-city-fc", playerLabel: "Muiz Lawal" },
    ],
  },
  // KNOCKOUT — Third place (Match 13)
  {
    id: "00000000-0000-4000-8jc0-000000000401",
    homeSlug: "fc-bethel",
    awaySlug: "ikorodu-city-fc",
    stageKey: "third_place",
    matchday: 1,
    roundLabel: "Third-Place Playoff",
    kickoffAt: "2026-05-24T14:00:00Z",
    venue: LEGACY_VENUE,
    homeScore: 2,
    awayScore: 0,
    stats: matchStats({
      homePoss: 54,
      awayPoss: 46,
      narrative:
        "FC Bethel won the third-place playoff 2-0 in regulation. Ezekiel Victor (35', assist Muhammed Adeiza) and Dagogo Ifubara (53') scored. Ikorodu missed a penalty before Bethel won the shootout 4-2.",
    }),
    meta: {
      regulationScore: { home: 2, away: 0 },
      missedPenalty: { minute: 72, teamSlug: "ikorodu-city-fc", playerLabel: "Awal Abdulkareem" },
      penaltyShootout: { home: 4, away: 2, winner: "home", winnerTeamSlug: "fc-bethel" },
    },
    events: [
      {
        type: "goal",
        minute: 35,
        teamSlug: "fc-bethel",
        playerLabel: "Ezekiel Victor",
        assistLabel: "Muhammed Adeiza",
      },
      { type: "goal", minute: 53, teamSlug: "fc-bethel", playerLabel: "Dagogo Ifubara" },
    ],
  },
  // KNOCKOUT — Final (Match 14)
  {
    id: "00000000-0000-4000-8jc0-000000000402",
    homeSlug: "broad-city-fc",
    awaySlug: "klassisc-fc",
    stageKey: "grand_final",
    matchday: 1,
    roundLabel: "Grand Finale",
    kickoffAt: "2026-05-25T16:00:00Z",
    venue: LEGACY_VENUE,
    homeScore: 1,
    awayScore: 0,
    stats: matchStats({
      homePoss: 56,
      awayPoss: 44,
      narrative:
        "Broad City FC won the Jagaban Cup 2026 final 1-0. Solomon Agbalaka (42', assist Ahmed Adesanu) scored the only goal.",
    }),
    events: [
      {
        type: "goal",
        minute: 42,
        teamSlug: "broad-city-fc",
        playerLabel: "Solomon Agbalaka",
        assistLabel: "Ahmed Adesanu",
      },
    ],
  },
];

async function seedSquads(
  prisma: PrismaClient,
  teamIds: Record<string, string>
): Promise<Map<string, string>> {
  const squadByLabel = new Map<string, string>();
  for (const row of mergedSquadRows()) {
    const teamId = teamIds[row.teamSlug];
    if (!teamId) continue;
    const team = await prisma.sbTeam.findUnique({
      where: { id: teamId },
      select: { competitionId: true },
    });
    if (!team) continue;

    const displayName = normalizePlayerName(row.displayName);
    const nameParts = splitDisplayName(displayName);
    const firstName = row.firstName ? titleCaseName(row.firstName) : nameParts.firstName;
    const lastName = row.lastName ? titleCaseName(row.lastName) : nameParts.lastName;
    const normalizedName = playerLookupKey(displayName);
    const dateOfBirth = normalizeSeedDate(row.dateOfBirth);
    const position = row.position || "MF";
    let player = await prisma.player.findUnique({
      where: { normalizedName },
    });
    if (player) {
      player = await prisma.player.update({
        where: { id: player.id },
        data: {
          firstName,
          lastName,
          displayName,
          positionPrimary: position,
          ...(dateOfBirth ? { dateOfBirth } : {}),
          ...(row.imageUrl ? { playerPhotoUrl: row.imageUrl } : {}),
          registrationStatus: "approved",
          isPublic: true,
        },
      });
    } else {
      player = await prisma.player.create({
        data: {
          firstName,
          lastName,
          displayName,
          normalizedName,
          slug: await resolveUniquePlayerSlug(prisma, displayName),
          positionPrimary: position,
          dateOfBirth,
          playerPhotoUrl: row.imageUrl || null,
          registrationStatus: "approved",
          isPublic: true,
        },
      });
    }

    const existingForPlayer = await prisma.sbTeamSquad.findFirst({
      where: {
        playerId: player.id,
        team: { competitionId: team.competitionId },
      },
    });
    if (existingForPlayer && existingForPlayer.teamId !== teamId) {
      continue;
    }

    const existing =
      existingForPlayer ??
      (await prisma.sbTeamSquad.findFirst({
        where: {
          teamId,
          displayName: { equals: displayName, mode: "insensitive" },
          ...(row.shirtNumber == null ? {} : { shirtNumber: row.shirtNumber }),
        },
      }));
    const squad =
      existing ??
      (await prisma.sbTeamSquad.create({
        data: {
          teamId,
          playerId: player.id,
          displayName,
          position,
          shirtNumber: row.shirtNumber,
        },
      }));
    if (existing) {
      await prisma.sbTeamSquad.update({
        where: { id: existing.id },
        data: {
          playerId: player.id,
          displayName,
          position,
          shirtNumber: row.shirtNumber,
        },
      });
    }
    squadByLabel.set(`${row.teamSlug}:${displayName}`, squad.id);
  }
  return squadByLabel;
}

function rosterSlot(row: SeededSquadRow, role: "xi" | "sub") {
  return {
    squadId: row.id,
    displayName: row.displayName,
    position: row.position,
    shirtNumber: row.shirtNumber,
    playerId: row.playerId,
    playerSlug: null,
    role,
  };
}

async function buildTeamRoster(prisma: PrismaClient, teamId: string) {
  const rows = await prisma.sbTeamSquad.findMany({
    where: { teamId },
    orderBy: [{ shirtNumber: "asc" }, { displayName: "asc" }],
    select: {
      id: true,
      teamId: true,
      playerId: true,
      displayName: true,
      position: true,
      shirtNumber: true,
    },
  });
  return {
    teamId,
    xi: rows.slice(0, 11).map((row) => rosterSlot(row, "xi")),
    subs: rows.slice(11).map((row) => rosterSlot(row, "sub")),
  };
}

async function seedMatchSquads(
  prisma: PrismaClient,
  match: MatchSeed,
  teamIds: Record<string, string>,
  options?: SeedOptions
) {
  if (await shouldPreserveSbMatch(prisma, match.id, options)) return;

  const homeTeamId = teamIds[match.homeSlug];
  const awayTeamId = teamIds[match.awaySlug];
  if (!homeTeamId || !awayTeamId) return;

  const [homeRoster, awayRoster, existingMatch] = await Promise.all([
    buildTeamRoster(prisma, homeTeamId),
    buildTeamRoster(prisma, awayTeamId),
    prisma.sbMatch.findUnique({ where: { id: match.id }, select: { stats: true } }),
  ]);
  if (!existingMatch) return;

  const stats =
    existingMatch.stats && typeof existingMatch.stats === "object" && !Array.isArray(existingMatch.stats)
      ? (existingMatch.stats as Record<string, unknown>)
      : {};

  await prisma.$transaction(async (tx) => {
    await tx.sbMatch.update({
      where: { id: match.id },
      data: {
        stats: {
          ...stats,
          matchdayRosters: {
            ...((stats.matchdayRosters as Record<string, unknown> | undefined) ?? {}),
            [homeTeamId]: homeRoster,
            [awayTeamId]: awayRoster,
          },
        } as Prisma.InputJsonValue,
      },
    });

    for (const roster of [homeRoster, awayRoster]) {
      const slots = [
        ...roster.xi.map((slot, index) => ({ ...slot, isStarter: true, sortOrder: index })),
        ...roster.subs.map((slot, index) => ({ ...slot, isStarter: false, sortOrder: index })),
      ];
      await tx.sbMatchSquadPlayer.deleteMany({
        where: { matchId: match.id, teamId: roster.teamId },
      });
      if (!slots.length) continue;
      await tx.sbMatchSquadPlayer.createMany({
        data: slots.map((slot) => ({
          matchId: match.id,
          teamId: roster.teamId,
          squadId: slot.squadId,
          playerId: slot.playerId,
          playerName: slot.displayName,
          jerseyNumber: slot.shirtNumber,
          position: slot.position,
          isStarter: slot.isStarter,
          sortOrder: slot.sortOrder,
        })),
      });
    }
  });
}

export async function seedJagabanCup2026(prisma: PrismaClient, options?: SeedOptions) {
  const jagabanConfig = {
    editionLabel: "Jagaban Cup 2026",
    groupCount: 2,
    teamsPerGroup: 4,
    groupLabels: ["A", "B"],
    cloneFromFormat: "JAGABAN_CUP_STANDARD",
  };

  const comp = await prisma.sbCompetition.upsert({
    where: { slug: COMP_SLUG },
    update: {
      name: "Jagaban Cup 2026",
      season: "2026",
      type: "tournament",
      formatType: "JAGABAN_CUP_STANDARD",
      formatConfig: jagabanConfig,
      country: "Nigeria",
      description:
        "Jagaban Cup 2026 — 2×4 group stage, cross-group grand final & third-place playoff. Full match narratives seeded on ScoreBoard.",
      isPublished: true,
    },
    create: {
      id: COMP_ID,
      slug: COMP_SLUG,
      name: "Jagaban Cup 2026",
      season: "2026",
      type: "tournament",
      formatType: "JAGABAN_CUP_STANDARD",
      formatConfig: jagabanConfig,
      country: "Nigeria",
      description:
        "Jagaban Cup 2026 — 2×4 group stage, cross-group grand final & third-place playoff. Full match narratives seeded on ScoreBoard.",
      isPublished: true,
    },
  });

  const stageDefs = buildJagabanCupStages({
    editionLabel: "Jagaban Cup 2026",
    groupCount: 2,
    teamsPerGroup: 4,
    groupLabels: ["A", "B"],
  });

  const stageByKey = new Map<string, string>();
  for (const s of stageDefs) {
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

  const teamIds: Record<string, string> = {};
  for (const t of TEAMS) {
    const name = normalizeClubName(t.name);
    const row = await prisma.sbTeam.upsert({
      where: { competitionId_slug: { competitionId: comp.id, slug: t.slug } },
      update: {
        name,
        shortName: t.shortName,
        groupKey: t.groupKey,
        city: t.city,
        logoUrl: t.logoUrl,
      },
      create: {
        competitionId: comp.id,
        slug: t.slug,
        name,
        shortName: t.shortName,
        groupKey: t.groupKey,
        city: t.city,
        logoUrl: t.logoUrl,
      },
    });
    teamIds[t.slug] = row.id;
  }

  await seedSquads(prisma, teamIds);

  let eventCount = 0;
  const usedMatchSlugs = await loadExistingMatchSlugs(prisma);
  for (const m of MATCHES) {
    const preserve = await shouldPreserveSbMatch(prisma, m.id, options);
    const stageId = stageByKey.get(m.stageKey);
    const slug = allocateMatchSlug(m.homeSlug, m.awaySlug, usedMatchSlugs);

    if (!preserve) {
      await prisma.sbMatch.upsert({
        where: { id: m.id },
        update: {
          slug,
          homeScore: m.homeScore,
          awayScore: m.awayScore,
          status: "finished",
          stats: m.stats,
          meta: m.meta ?? null,
          stageKey: m.stageKey,
          stageId,
          matchday: m.matchday,
          roundLabel: m.roundLabel,
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
          stageKey: m.stageKey,
          matchday: m.matchday,
          homeTeamId: teamIds[m.homeSlug],
          awayTeamId: teamIds[m.awaySlug],
          status: "finished",
          homeScore: m.homeScore,
          awayScore: m.awayScore,
          kickoffAt: new Date(m.kickoffAt),
          venue: m.venue,
          roundLabel: m.roundLabel,
          stats: m.stats,
          meta: m.meta ?? null,
        },
      });

      if (isFullSeed(options)) {
        await prisma.sbMatchEvent.deleteMany({ where: { matchId: m.id } });
      }

      for (const ev of m.events) {
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

  for (const m of MATCHES) {
    await seedMatchSquads(prisma, m, teamIds, options);
  }

  const [matchCount, squadCount] = await Promise.all([
    prisma.sbMatch.count({ where: { competitionId: comp.id } }),
    prisma.sbTeamSquad.count({
      where: { teamId: { in: Object.values(teamIds) } },
    }),
  ]);

  await seedJagabanMatchMedia(prisma, comp.id, options);

  console.log("Jagaban Cup 2026 seeded:", COMP_SLUG);
  console.log("  matches:", matchCount, "(expected 14)");
  console.log("  events:", eventCount);
  console.log("  squad rows:", squadCount);
  console.log("  match media blocks:", JAGABAN_MATCH_MEDIA.length);
  return comp;
}

async function seedJagabanMatchMedia(
  prisma: PrismaClient,
  competitionId: string,
  options?: SeedOptions
) {
  const matchIds = JAGABAN_MATCH_MEDIA.map((m) => m.matchId);
  if (isFullSeed(options)) {
    await prisma.sbHighlight.deleteMany({
      where: { competitionId, matchId: { in: matchIds } },
    });
  }

  for (const block of JAGABAN_MATCH_MEDIA) {
    const match = await prisma.sbMatch.findUnique({
      where: { id: block.matchId },
      select: { id: true, meta: true },
    });
    if (!match) continue;
    if (await shouldPreserveSbMatch(prisma, block.matchId, options)) continue;

    const existingMeta =
      match.meta && typeof match.meta === "object" && !Array.isArray(match.meta)
        ? (match.meta as Record<string, unknown>)
        : {};
    const photos = toMatchPhotoEntries(block.photos);

    await prisma.sbMatch.update({
      where: { id: block.matchId },
      data: {
        meta: {
          ...existingMeta,
          photos,
        } as Prisma.InputJsonValue,
      },
    });

    const existingHighlight = await prisma.sbHighlight.findFirst({
      where: { competitionId, matchId: block.matchId, title: block.title },
    });
    if (!existingHighlight) {
      await prisma.sbHighlight.create({
        data: {
          competitionId,
          matchId: block.matchId,
          title: block.title,
          youtubeUrl: toGoogleDrivePreviewUrl(block.driveId),
          isPublished: true,
        },
      });
    }
  }
}
