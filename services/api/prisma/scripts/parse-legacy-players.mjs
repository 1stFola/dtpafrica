import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pastePath = path.join(__dirname, "..", "legacy-players-paste.txt");
const outPath = path.join(__dirname, "..", "seed-legacy-players-data.ts");

const raw = fs.readFileSync(pastePath, "utf8");
const lines = raw.split(/\r?\n/).map((l) => l.replace(/\r$/, ""));
const headerLine = lines.find(
  (l) => l.includes("full_name") && l.includes("sponsor_name")
);
const hi = lines.indexOf(headerLine);
let i = hi + 1;
while (i < lines.length && !lines[i].trim()) i++;
const data = lines.slice(i);

const isGender = (s) => s === "Male" || s === "Female";
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const isFoot = (s) => /^(Left|Right|Both)$/i.test(s);
const isNum = (s) => s !== "" && !Number.isNaN(Number(s));
const isUrl = (s) => /^https?:\/\//i.test(s) || s.startsWith("data:");
const isJsonArray = (s) => s.trim().startsWith("[");

function looksLikeName(s) {
  if (!s || isUrl(s) || isGender(s) || isDate(s) || isFoot(s) || isNum(s))
    return false;
  if (s === "Simpler Africa" || s === "simplerafrica.com") return false;
  if (/^(Nigerian|Nigeria|NIGERIAN)$/i.test(s)) return false;
  if (s.length < 3) return false;
  return /[A-Za-z]/.test(s) && /[A-Z]/.test(s[0]);
}

function parseHeightCm(s) {
  if (!s) return null;
  if (isNum(s)) return Math.round(Number(s));
  const m = s.match(/(\d+)\s*['']?\s*(\d+)?/);
  if (m) {
    const ft = Number(m[1]);
    const inch = Number(m[2] || 0);
    return Math.round((ft * 12 + inch) * 2.54);
  }
  return null;
}

function skipEmpty(p) {
  while (p < data.length && !data[p].trim()) p++;
  return p;
}

function nextRecordStart(p) {
  while (p < data.length) {
    if (
      looksLikeName(data[p]) &&
      isGender(data[p + 1]) &&
      isDate(data[p + 2])
    ) {
      return p;
    }
    p++;
  }
  return -1;
}

function parseRecord(startNameIdx) {
  const full_name = data[startNameIdx].trim();
  let p = startNameIdx + 1;
  if (!isGender(data[p])) return null;
  const gender = data[p++];
  if (!isDate(data[p])) return null;
  const date_of_birth = data[p++];
  const age = Number(data[p++]) || null;
  const nationality = data[p++];
  const position = data[p++];

  let height_cm = null;
  let height_ft_in = null;
  const h = data[p];
  if (isNum(h)) {
    height_cm = Math.round(Number(h));
    p++;
  } else if (h) {
    height_ft_in = h;
    height_cm = parseHeightCm(h);
    p++;
  }

  const weight_kg = isNum(data[p]) ? Number(data[p++]) : null;
  const current_club = data[p++];
  let league_name = null;
  let dominant_foot = null;
  if (isFoot(data[p])) {
    dominant_foot = data[p++];
  } else {
    league_name = data[p++];
    dominant_foot = data[p++];
  }

  const overall_rating = isNum(data[p]) ? Number(data[p++]) : null;
  const offensive_score = isNum(data[p]) ? Number(data[p++]) : null;
  const defensive_score = isNum(data[p]) ? Number(data[p++]) : null;

  p = skipEmpty(p);
  let featured = false;
  if (data[p] === "true" || data[p] === "1") {
    featured = true;
    p++;
  } else if (data[p] === "false" || data[p] === "0") {
    p++;
  }
  p = skipEmpty(p);
  let active = true;
  if (data[p] === "true" || data[p] === "false") {
    active = data[p] !== "false";
    p++;
  }
  p = skipEmpty(p);

  let scouting_summary = "";
  while (p < data.length) {
    const v = data[p];
    if (looksLikeName(v) && isGender(data[p + 1]) && isDate(data[p + 2])) break;
    if (isNum(v) && scouting_summary) break;
    if (isUrl(v) && scouting_summary) break;
    if (isJsonArray(v) && scouting_summary) break;
    scouting_summary += (scouting_summary ? " " : "") + v;
    p++;
  }

  const ratingAttributes = {};
  const takeNum = () => {
    if (p < data.length && isNum(data[p])) {
      const n = Number(data[p++]);
      return n;
    }
    return null;
  };
  const skipLine = () => {
    if (p < data.length) p++;
  };

  ratingAttributes.strength = takeNum();
  ratingAttributes.composure = takeNum();
  ratingAttributes.stamina = takeNum();
  skipLine(); // displayOrder
  ratingAttributes.technique = takeNum();
  skipLine(); // league_tier
  ratingAttributes.finishing = takeNum();
  ratingAttributes.acceleration = takeNum();
  ratingAttributes.team_play = takeNum();
  skipLine(); // player_id
  ratingAttributes.dribbling = takeNum();

  let video_url = isUrl(data[p]) ? data[p++] : null;
  if (data[p] && !isUrl(data[p]) && (data[p].includes("'") || isNum(data[p]))) {
    height_ft_in = height_ft_in || data[p];
    if (!height_cm) height_cm = parseHeightCm(data[p]);
    p++;
  }
  ratingAttributes.first_touch = takeNum();
  ratingAttributes.positioning = takeNum();
  ratingAttributes.ball_control = takeNum();

  let photo_url = isUrl(data[p]) ? data[p++] : null;
  skipLine(); // weight_lbs
  ratingAttributes.pace = takeNum();
  let video_url_2 = isUrl(data[p]) ? data[p++] : null;
  let video_url_3 = isUrl(data[p]) ? data[p++] : null;
  ratingAttributes.decision_making = takeNum();
  ratingAttributes.vision = takeNum();
  ratingAttributes.work_rate = takeNum();

  let media_articles = null;
  if (isJsonArray(data[p])) {
    try {
      media_articles = JSON.parse(data[p]);
    } catch {
      /* ignore */
    }
    p++;
  }

  ratingAttributes.sprint_speed = takeNum();
  ratingAttributes.passing = takeNum();
  ratingAttributes.agility = takeNum();
  skipLine(); // photo_description

  let benchmark_name = null;
  let benchmark_archetype = null;
  let benchmark_region = null;
  let benchmark_age_band = null;
  let benchmark_similarity = null;
  let benchmark_overall_rating = null;
  let benchmark_attributes = null;

  while (p < data.length) {
    const v = data[p];
    if (looksLikeName(v) && isGender(data[p + 1]) && isDate(data[p + 2])) break;

    if (v.trim().startsWith("{")) {
      try {
        benchmark_attributes = JSON.parse(v);
      } catch {
        /* ignore */
      }
      p++;
      continue;
    }

    if (isUrl(v)) {
      p++;
      continue;
    }

    if (
      !benchmark_name &&
      v &&
      !isNum(v) &&
      !isUrl(v) &&
      v.length > 2 &&
      !/^(Europe|Africa|Senior|U\d+)/i.test(v)
    ) {
      const arch = data[p + 1];
      const region = data[p + 2];
      if (
        arch &&
        !isUrl(arch) &&
        region &&
        /^(Europe|Africa|South America|Asia|Senior|U\d+|Youth)/i.test(region)
      ) {
        benchmark_name = v;
        benchmark_archetype = arch;
        benchmark_region = region;
        benchmark_age_band = data[p + 3];
        benchmark_similarity = isNum(data[p + 4]) ? Number(data[p + 4]) : null;
        benchmark_overall_rating = isNum(data[p + 5])
          ? Number(data[p + 5])
          : null;
        p += 6;
        continue;
      }
    }

    p++;
    if (p - startNameIdx > 130) break;
  }

  for (const k of Object.keys(ratingAttributes)) {
    if (ratingAttributes[k] === null || Number.isNaN(ratingAttributes[k])) {
      delete ratingAttributes[k];
    }
  }

  return {
    full_name,
    gender,
    date_of_birth,
    age,
    nationality,
    position,
    height_cm,
    height_ft_in,
    weight_kg,
    current_club,
    league_name,
    dominant_foot,
    overall_rating,
    offensive_score,
    defensive_score,
    featured,
    active,
    scouting_summary: scouting_summary.trim() || null,
    ratingAttributes,
    video_url,
    video_url_2,
    video_url_3,
    photo_url,
    media_articles,
    benchmark_name,
    benchmark_archetype,
    benchmark_region,
    benchmark_age_band,
    benchmark_similarity,
    benchmark_overall_rating,
    benchmark_attributes,
    end: p,
  };
}

const records = [];
let pos = 0;
while (pos < data.length) {
  const start = nextRecordStart(pos);
  if (start < 0) break;
  const rec = parseRecord(start);
  if (rec) {
    records.push(rec);
    pos = rec.end;
  } else {
    pos = start + 1;
  }
}

function richness(r) {
  let s = 0;
  if (r.scouting_summary) s += 3;
  if (r.photo_url) s += 2;
  if (r.video_url) s += 2;
  if (r.overall_rating) s += 1;
  s += Object.keys(r.ratingAttributes).length;
  if (r.benchmark_name) s += 2;
  if (r.media_articles?.length) s += 2;
  return s;
}

const byName = new Map();
for (const r of records) {
  const key = r.full_name.trim().toUpperCase();
  const prev = byName.get(key);
  if (!prev || richness(r) > richness(prev)) byName.set(key, r);
}

const unique = [...byName.values()];
console.log("parsed", records.length, "unique", unique.length);

function normalizePosition(pos) {
  const u = (pos || "").toUpperCase();
  const m = u.match(/\b(GK|CB|FB|LB|RB|LWB|RWB|CDM|CM|CAM|AM|LW|RW|ST|CF|MF|DF)\b/);
  if (m) return m[1] === "FB" ? "RB" : m[1];
  if (u.includes("MIDFIELD")) return "CM";
  if (u.includes("DEFENS")) return "CB";
  if (u.includes("FORWARD") || u.includes("STRIKER")) return "ST";
  if (/\bLEFT\b.*\bWING|\bWING\b.*\bLEFT\b/.test(u)) return "LW";
  if (/\bRIGHT\b.*\bWING|\bWING\b.*\bRIGHT\b/.test(u)) return "RW";
  if (/\bLEFT\b.*\bBACK|\bBACK\b.*\bLEFT\b/.test(u)) return "LB";
  if (/\bRIGHT\b.*\bBACK|\bBACK\b.*\bRIGHT\b/.test(u)) return "RB";
  if (u.includes("FULL BACK") || u.includes("FULLBACK")) return "RB";
  if (u.includes("WING")) return "RW";
  if (u.includes("GOAL")) return "GK";
  return u.slice(0, 6) || "CM";
}

const exportRows = unique.map((r) => ({
  full_name: r.full_name,
  gender: r.gender,
  date_of_birth: r.date_of_birth,
  nationality: r.nationality,
  position: normalizePosition(r.position),
  position_full: r.position,
  height_cm: r.height_cm,
  weight_kg: r.weight_kg,
  current_club: r.current_club,
  league_name: r.league_name,
  dominant_foot: r.dominant_foot,
  overall_rating: r.overall_rating,
  offensive_score: r.offensive_score,
  defensive_score: r.defensive_score,
  featured: r.featured,
  active: r.active,
  scouting_summary: r.scouting_summary,
  rating_attributes: r.ratingAttributes,
  photo_url: r.photo_url?.startsWith("data:") ? null : r.photo_url,
  video_url: r.video_url,
  video_url_2: r.video_url_2,
  video_url_3: r.video_url_3,
  media_articles: r.media_articles,
  benchmark:
    r.benchmark_name
      ? {
          name: r.benchmark_name,
          archetype: r.benchmark_archetype,
          region: r.benchmark_region,
          age_band: r.benchmark_age_band,
          similarity: r.benchmark_similarity,
          overall_rating: r.benchmark_overall_rating,
          attributes: r.benchmark_attributes,
        }
      : null,
}));

const ts = `/** Auto-generated from legacy-players-paste.txt — do not edit by hand. */
export type LegacyPlayerSeedRow = {
  full_name: string;
  gender: string;
  date_of_birth: string;
  age: number | null;
  nationality: string;
  position: string;
  position_full: string;
  height_cm: number | null;
  weight_kg: number | null;
  current_club: string;
  league_name: string | null;
  dominant_foot: string;
  overall_rating: number | null;
  offensive_score: number | null;
  defensive_score: number | null;
  featured: boolean;
  active: boolean;
  scouting_summary: string | null;
  rating_attributes: Record<string, number>;
  photo_url: string | null;
  video_url: string | null;
  video_url_2: string | null;
  video_url_3: string | null;
  media_articles: Array<{
    title?: string;
    url?: string;
    source?: string;
    date?: string;
    excerpt?: string;
    exerpt?: string;
  }>;
  benchmark: {
    name: string;
    archetype?: string | null;
    region?: string | null;
    age_band?: string | null;
    similarity?: number | null;
    overall_rating?: number | null;
    attributes?: Record<string, number> | null;
  } | null;
};

export const LEGACY_PLAYER_ROWS: LegacyPlayerSeedRow[] = ${JSON.stringify(exportRows, null, 2)};
`;

fs.writeFileSync(outPath, ts);
console.log("wrote", outPath, exportRows.length, "rows");
