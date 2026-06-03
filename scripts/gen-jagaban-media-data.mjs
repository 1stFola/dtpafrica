import fs from "fs";

const rawJson = fs
  .readFileSync(
    "c:/Users/bioni/OneDrive/Desktop/DTP/dtp.africa/services/api/prisma/jagaban-media-blocks.json",
    "utf8"
  )
  .replace(/^\uFEFF/, "");
const blocks = JSON.parse(rawJson).blocks;

const MATCH_IDS = [
  "00000000-0000-4000-8jc0-000000000101",
  "00000000-0000-4000-8jc0-000000000102",
  "00000000-0000-4000-8jc0-000000000103",
  "00000000-0000-4000-8jc0-000000000104",
  "00000000-0000-4000-8jc0-000000000201",
  "00000000-0000-4000-8jc0-000000000202",
  "00000000-0000-4000-8jc0-000000000203",
  "00000000-0000-4000-8jc0-000000000204",
  "00000000-0000-4000-8jc0-000000000301",
  "00000000-0000-4000-8jc0-000000000302",
  "00000000-0000-4000-8jc0-000000000303",
  "00000000-0000-4000-8jc0-000000000304",
  "00000000-0000-4000-8jc0-000000000401",
  "00000000-0000-4000-8jc0-000000000402",
];

const MATCH_TITLES = [
  "SGFC Athletics SC vs 36 Lion FC",
  "Ikorodu City FC vs Smart City FC",
  "FC Bethel Sporting vs Klassisch FA",
  "Mavlon FC vs Broad City FC",
  "SGFC Athletics SC vs FC Bethel Sporting",
  "Smart City FC vs Mavlon FC",
  "Klassisch FA vs 36 Lion FC",
  "Broad City FC vs Ikorodu City FC",
  "36 Lion FC vs FC Bethel Sporting",
  "Ikorodu City FC vs Mavlon FC",
  "SGFC Athletics SC vs Klassisch FA",
  "Smart City FC vs Broad City FC",
  "FC Bethel Sporting vs Ikorodu City FC — Third Place",
  "Klassisch FA vs Broad City FC — Final",
];

const rows = blocks.map((b, i) => ({
  matchId: MATCH_IDS[i],
  title: MATCH_TITLES[i],
  driveId: b.driveId,
  photos: b.photos,
}));

const out = `/** Auto-generated Jagaban Cup 2026 match media (photos + Drive video ids). */
export type JagabanMatchMediaSeed = {
  matchId: string;
  title: string;
  driveId: string;
  photos: string[];
};

export const JAGABAN_MATCH_MEDIA: JagabanMatchMediaSeed[] = ${JSON.stringify(rows, null, 2)} as const;
`;

fs.writeFileSync(
  "c:/Users/bioni/OneDrive/Desktop/DTP/dtp.africa/services/api/prisma/seed-jagaban-media-data.ts",
  out
);
console.log("wrote", rows.length, "match media rows");
