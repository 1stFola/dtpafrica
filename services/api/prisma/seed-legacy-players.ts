import type { Prisma, PrismaClient } from "@prisma/client";
import { normalizePlayerName, playerLookupKey } from "@dtp/engines";
import { slugifyPlayerName } from "../src/players/player-slug";
import { LEGACY_PLAYER_ROWS, type LegacyPlayerSeedRow } from "./seed-legacy-players-data";

const SLUG_OVERRIDES: Record<string, string> = {
  "yusuff o sikiru": "yusuff-o-sikiru",
  "alli sanni": "alli-o-sanni",
  "alli o sanni": "alli-o-sanni",
};

const FEATURED_NAMES = new Set([
  "alli sanni",
  "alli o sanni",
  "alli o. sanni",
]);

/** Fuzzy map legacy `current_club` labels to academy slugs from seed-legacy-academies. */
export function resolveAcademySlug(clubName: string | null | undefined): string | null {
  if (!clubName?.trim()) return null;
  const key = clubName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();

  const rules: Array<{ match: RegExp; slug: string }> = [
    { match: /AYICRIP\s*NELIS/, slug: "ayicrip-nelis-fa" },
    { match: /VIDO\s*99/, slug: "vido-99-fc" },
    { match: /EMILOJU/, slug: "emiloju-fc" },
    { match: /EVOLUTION\s*UNITED/, slug: "evolution-united-fc" },
    { match: /OJODU\s*CITY/, slug: "ojodu-city-fc" },
    { match: /SMART\s*CITY/, slug: "smart-city-fc" },
    { match: /FC\s*BETHEL|BETHEL\s*SPORTING/, slug: "fc-bethel-sporting" },
    { match: /OLUGBANI/, slug: "olugbani-fc" },
    { match: /ATHLETIC\s*CLUB/, slug: "athletic-club" },
    { match: /OLYMPIC\s*LAGOS/, slug: "olympic-lagos" },
    { match: /GOALGETTERS/, slug: "goalgetters-fa" },
    { match: /MAGIC\s*STARS/, slug: "magic-stars-fc" },
    { match: /IGANMU\s*TIGER/, slug: "iganmu-tiger-fc" },
  ];

  for (const { match, slug } of rules) {
    if (match.test(key)) return slug;
  }
  return null;
}

function splitDisplayName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function resolveSlug(row: LegacyPlayerSeedRow): string {
  const key = playerLookupKey(row.full_name);
  if (SLUG_OVERRIDES[key]) return SLUG_OVERRIDES[key];
  return slugifyPlayerName(row.full_name);
}

function isYoutubeUrl(url: string | null | undefined): boolean {
  if (!url?.trim()) return false;
  return /youtube\.com|youtu\.be/i.test(url);
}

function buildMediaItems(row: LegacyPlayerSeedRow): Prisma.InputJsonValue {
  const items: Array<Record<string, string>> = [];
  if (row.photo_url) {
    items.push({ type: "photo", title: "Profile photo", url: row.photo_url });
  }
  const videos = [row.video_url, row.video_url_2, row.video_url_3].filter(isYoutubeUrl) as string[];
  videos.forEach((url, i) => {
    items.push({
      type: "video",
      title: i === 0 ? "Highlight video" : `Highlight video ${i + 1}`,
      url,
    });
  });
  if (row.media_articles?.length) {
    for (const article of row.media_articles) {
      if (!article.url) continue;
      items.push({
        type: "article",
        title: article.title || "Press",
        url: article.url,
        ...(article.source ? { source: article.source } : {}),
        ...(article.date ? { date: article.date } : {}),
      });
    }
  }
  return items as Prisma.InputJsonValue;
}

function buildBenchmarkMetadata(row: LegacyPlayerSeedRow): Prisma.InputJsonValue | undefined {
  const b = row.benchmark;
  if (!b?.name) return undefined;
  const attrs = b.attributes && typeof b.attributes === "object" ? b.attributes : {};
  return {
    nearest: {
      full_name: b.name,
      archetype: b.archetype ?? null,
      region: b.region ?? null,
      age_band: b.age_band ?? null,
      overall_rating: b.overall_rating ?? null,
      __similarity: b.similarity ?? null,
      ...attrs,
    },
    alternatives: [],
    filterInfo: {},
  } as Prisma.InputJsonValue;
}

function computeAgeGroup(dateOfBirth: string, age: number | null): string | null {
  if (age != null && age > 0) {
    if (age <= 15) return "U15";
    if (age <= 17) return "U17";
    if (age <= 18) return "U18";
    if (age <= 21) return "U21";
    return "Senior";
  }
  const year = Number(dateOfBirth.slice(0, 4));
  if (!year) return null;
  const currentYear = new Date().getFullYear();
  const computed = currentYear - year;
  if (computed <= 15) return "U15";
  if (computed <= 17) return "U17";
  if (computed <= 18) return "U18";
  if (computed <= 21) return "U21";
  return "Senior";
}

function rowToPlayerData(
  row: LegacyPlayerSeedRow,
  academyId: string | null
): Prisma.PlayerUncheckedCreateInput {
  const { firstName, lastName } = splitDisplayName(row.full_name);
  const slug = resolveSlug(row);
  const lookupKey = playerLookupKey(row.full_name);
  const isFeatured =
    row.featured || FEATURED_NAMES.has(lookupKey) || FEATURED_NAMES.has(row.full_name.toLowerCase());
  const academySlug = resolveAcademySlug(row.current_club);
  const clubLabel = row.current_club?.trim() || null;

  const ratingAttributes = Object.keys(row.rating_attributes ?? {}).length
    ? (row.rating_attributes as Prisma.InputJsonValue)
    : undefined;

  const primaryVideo = [row.video_url, row.video_url_2, row.video_url_3].find(isYoutubeUrl) ?? null;

  return {
    firstName,
    lastName,
    displayName: row.full_name.trim(),
    normalizedName: normalizePlayerName(row.full_name),
    slug,
    dateOfBirth: new Date(row.date_of_birth),
    age: row.age ?? null,
    ageGroup: computeAgeGroup(row.date_of_birth, row.age),
    nationality: row.nationality?.trim() || null,
    heightCm: row.height_cm ?? null,
    weightKg: row.weight_kg ?? null,
    dominantFoot: row.dominant_foot?.trim() || null,
    positionPrimary: row.position,
    positionFull: row.position_full?.trim() || null,
    playerPhotoUrl: row.photo_url,
    videoUrl: primaryVideo,
    overallRating: row.overall_rating ?? null,
    offensiveRating: row.offensive_score ?? null,
    defensiveRating: row.defensive_score ?? null,
    scoutingSummary: row.scouting_summary,
    ratingAttributes,
    benchmarkMetadata: buildBenchmarkMetadata(row),
    mediaItems: buildMediaItems(row),
    academyId,
    city: academySlug ? null : clubLabel,
    state: row.league_name?.trim() || null,
    isFeatured,
    isPublic: true,
    registrationStatus: row.active === false ? "inactive" : "approved",
    biography: row.scouting_summary,
  };
}

export type LegacyPlayerSeedResult = {
  playerCount: number;
  academyLinkCount: number;
  sampleSlugs: string[];
};

export async function seedLegacyPlayers(
  prisma: PrismaClient
): Promise<LegacyPlayerSeedResult> {
  const academies = await prisma.academy.findMany({
    select: { id: true, slug: true },
  });
  const academyBySlug = new Map(academies.map((a) => [a.slug, a.id]));

  let academyLinkCount = 0;
  const sampleSlugs: string[] = [];

  for (const row of LEGACY_PLAYER_ROWS) {
    const slug = resolveSlug(row);
    const academySlug = resolveAcademySlug(row.current_club);
    const academyId = academySlug ? academyBySlug.get(academySlug) ?? null : null;
    if (academyId) academyLinkCount += 1;

    const data = rowToPlayerData(row, academyId);

    await prisma.player.upsert({
      where: { slug },
      create: data,
      update: data,
    });

    if (ratingAttributesPresent(row)) {
      const player = await prisma.player.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (player) {
        await prisma.playerAggregatedMetrics.upsert({
          where: {
            playerId_season: { playerId: player.id, season: "rolling" },
          },
          create: {
            playerId: player.id,
            season: "rolling",
            rawAverages: row.rating_attributes as Prisma.InputJsonValue,
            derivedMetrics: row.rating_attributes as Prisma.InputJsonValue,
          },
          update: {
            rawAverages: row.rating_attributes as Prisma.InputJsonValue,
            derivedMetrics: row.rating_attributes as Prisma.InputJsonValue,
          },
        });
      }
    }

    if (sampleSlugs.length < 8) sampleSlugs.push(slug);
    console.log(
      `  legacy player: ${slug}${academyId ? ` → ${academySlug}` : row.current_club ? ` (club: ${row.current_club})` : ""}`
    );
  }

  return {
    playerCount: LEGACY_PLAYER_ROWS.length,
    academyLinkCount,
    sampleSlugs,
  };
}

function ratingAttributesPresent(row: LegacyPlayerSeedRow): boolean {
  return Object.keys(row.rating_attributes ?? {}).length > 0;
}
