const EA_FC_CDN_VERSIONS = [25, 24] as const;

const THESPORTSDB_API_KEY = "3";
const THESPORTSDB_SEARCH_URL = `https://www.thesportsdb.com/api/v1/json/${THESPORTSDB_API_KEY}/searchplayers.php`;

/**
 * Verified headshot URLs for high-traffic benchmark players.
 * Prefer cutout PNGs, then thumbs, then Wikimedia portraits.
 */
const KNOWN_BENCHMARK_HEADSHOTS: Record<string, readonly string[]> = {
  "bryan mbeumo": [
    "https://r2.thesportsdb.com/images/media/player/cutout/op28s81755176679.png",
    "https://r2.thesportsdb.com/images/media/player/thumb/ntsyk71608410198.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/a/af/Bryan_Mbeumo.jpg",
  ],
  "kevin de bruyne": [
    "https://r2.thesportsdb.com/images/media/player/cutout/o4flia1764089447.png",
    "https://www.thesportsdb.com/images/media/player/thumb/627wh81779038446.jpg",
  ],
  "virgil van dijk": [
    "https://r2.thesportsdb.com/images/media/player/cutout/9cxf2q1757087742.png",
    "https://r2.thesportsdb.com/images/media/player/thumb/9fe0tn1720452118.jpg",
  ],
};

/**
 * EA FC resource IDs for calibration benchmark players and seeded comps.
 * Keys are normalized via {@link normalizeBenchmarkPlayerName}.
 */
const BENCHMARK_EA_PLAYER_IDS: Record<string, number> = {
  "kylian mbappe": 231747,
  "erling haaland": 239085,
  "harry kane": 202126,
  "lautaro martinez": 231478,
  "alexander isak": 233731,
  "victor osimhen": 232293,
  "viktor gyokeres": 241651,
  "julian alvarez": 246191,
  "jonathan david": 243384,
  "cristiano ronaldo": 20801,
  "viktor boniface": 252042,
  "ollie watkins": 221697,
  "benjamin sesko": 256853,
  "darwin nunez": 243636,
  "santiago gimenez": 260908,
  "lois openda": 247245,
  "serhou guirassy": 215441,
  "evan ferguson": 263578,
  "ivan toney": 223696,
  "dusan vlahovic": 247635,

  "vinicius junior": 238794,
  "mohamed salah": 209331,
  "bukayo saka": 246669,
  "rafael leao": 241721,
  "lamine yamal": 272449,
  "nico williams": 260923,
  "khvicha kvaratskhelia": 247249,
  "ousmane dembele": 231443,
  rodrygo: 243812,
  "son heung-min": 200104,
  "son heung min": 200104,
  "ademola lookman": 229261,
  raphinha: 233419,
  "bradley barcola": 264731,
  "desire doue": 271421,
  "noni madueke": 254796,
  "johan bakayoko": 260779,
  savio: 267630,
  "takefusa kubo": 246104,
  "luis diaz": 237389,
  "bryan mbeumo": 243014,

  "kevin de bruyne": 192985,
  "florian wirtz": 256630,
  "jamal musiala": 256790,
  "cole palmer": 257534,
  "bruno fernandes": 212198,
  "martin odegaard": 222665,
  "paulo dybala": 211110,
  "mohammed kudus": 245630,
  "xavi simons": 260843,
  "dominik szoboszlai": 257192,
  "phil foden": 237692,
  "eberechi eze": 242075,
  "hakan calhanoglu": 208128,
  "james maddison": 220834,
  "dani olmo": 243630,
  isco: 197781,
  "kang-in lee": 247632,
  "rayan cherki": 260247,
  "morgan gibbs-white": 238616,
  "morgan gibbs white": 238616,
  "pedro goncalves": 246863,

  "jude bellingham": 252371,
  "federico valverde": 226753,
  "bernardo silva": 218667,
  "nicolo barella": 225193,
  "declan rice": 234378,
  "alexis mac allister": 243656,
  vitinha: 251517,
  "tijjani reijnders": 257195,
  "joao neves": 272739,
  "bruno guimaraes": 244261,
  "enzo fernandez": 247090,
  "ryan gravenberch": 252154,
  "sandro tonali": 226162,
  "frenkie de jong": 192448,
  "sergej milinkovic-savic": 223848,
  "pascal gross": 199434,
  "teun koopmeiners": 235842,
  "matteo guendouzi": 231352,
  "conor gallagher": 244621,
  "kobbie mainoo": 269136,

  rodri: 231866,
  "martin zubimendi": 268782,
  "moises caicedo": 251530,
  "joao palhinha": 229909,
  "manuel ugarte": 264240,
  "wilfred ndidi": 225661,
  "edson alvarez": 235237,
  casemiro: 200145,
  "youssouf fofana": 251500,
  "pierre-emile hojbjerg": 213345,
  "yves bissouma": 232363,
  "andre trindade": 252138,
  andre: 252138,
  "boubacar kamara": 247325,
  "amadou onana": 248695,
  "tyler adams": 235756,
  "ibrahim sangare": 238280,
  "hidemasa morita": 246923,
  "denis zakaria": 226449,
  "douglas luiz": 233049,
  "guido rodriguez": 231677,

  "achraf hakimi": 228702,
  "theo hernandez": 230888,
  "trent alexander-arnold": 231281,
  "jeremie frimpong": 251466,
  "alphonso davies": 234396,
  "jules kounde": 241486,
  "nuno mendes": 261605,
  "andrew robertson": 216267,
  "noussair mazraoui": 231223,
  "pervis estupinan": 253124,
  "reece james": 246430,
  "miguel gutierrez": 263576,
  "alex grimaldo": 189511,
  "oleksandr zinchenko": 228902,
  "destiny udogie": 271881,
  "pedro porro": 241456,
  "denzel dumfries": 233486,
  "diogo dalot": 237936,
  "ben white": 240289,
  "federico dimarco": 230877,

  "virgil van dijk": 203376,
  "william saliba": 243715,
  "ruben dias": 204936,
  "alessandro bastoni": 237383,
  "antonio rudiger": 205452,
  "gabriel magalhaes": 239231,
  marquinhos: 207865,
  "ronald araujo": 243633,
  "kim min-jae": 238074,
  "kim min jae": 238074,
  "cristian romero": 243571,
  "jonathan tah": 244665,
  "dayot upamecano": 235243,
  "micky van de ven": 269250,
  "piero hincapie": 260825,
  "willian pacho": 271421,
  "ibrahima konate": 243657,
  "jarrad branthwaite": 262749,
  "lisandro martinez": 240130,
  "levi colwill": 263578,
  murillo: 272673,
};

type SportsDbPlayer = {
  strCutout?: string | null;
  strThumb?: string | null;
};

type SportsDbSearchResponse = {
  player?: SportsDbPlayer[] | null;
};

const sportsDbHeadshotCache = new Map<string, string[]>();
const sportsDbInflightRequests = new Map<string, Promise<string[]>>();

export function normalizeBenchmarkPlayerName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeUrls(urls: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const url of urls) {
    const trimmed = url.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }

  return result;
}

export function getBenchmarkPlayerEaId(playerName: string): number | null {
  const key = normalizeBenchmarkPlayerName(playerName);
  if (!key) return null;
  return BENCHMARK_EA_PLAYER_IDS[key] ?? null;
}

export function buildEaFcHeadshotUrl(eaId: number, version: (typeof EA_FC_CDN_VERSIONS)[number] = 25) {
  return `https://fifastatic.b-cdn.net/players/${version}/p${eaId}.png`;
}

export function getKnownBenchmarkHeadshotUrls(playerName: string): string[] {
  const key = normalizeBenchmarkPlayerName(playerName);
  if (!key) return [];
  return [...(KNOWN_BENCHMARK_HEADSHOTS[key] ?? [])];
}

function buildEaFcHeadshotUrls(playerName: string): string[] {
  const eaId = getBenchmarkPlayerEaId(playerName);
  if (eaId == null) return [];
  return EA_FC_CDN_VERSIONS.map((version) => buildEaFcHeadshotUrl(eaId, version));
}

function extractSportsDbHeadshotUrls(player: SportsDbPlayer | undefined): string[] {
  if (!player) return [];
  return dedupeUrls([player.strCutout ?? "", player.strThumb ?? ""]);
}

export async function fetchBenchmarkHeadshotUrlsFromSportsDb(playerName: string): Promise<string[]> {
  const key = normalizeBenchmarkPlayerName(playerName);
  if (!key) return [];

  const cached = sportsDbHeadshotCache.get(key);
  if (cached) return cached;

  const inflight = sportsDbInflightRequests.get(key);
  if (inflight) return inflight;

  const request = (async () => {
    try {
      const response = await fetch(
        `${THESPORTSDB_SEARCH_URL}?p=${encodeURIComponent(playerName.trim())}`,
      );
      if (!response.ok) return [];

      const data = (await response.json()) as SportsDbSearchResponse;
      const urls = extractSportsDbHeadshotUrls(data.player?.[0]);
      sportsDbHeadshotCache.set(key, urls);
      return urls;
    } catch {
      return [];
    } finally {
      sportsDbInflightRequests.delete(key);
    }
  })();

  sportsDbInflightRequests.set(key, request);
  return request;
}

/** Synchronous URLs available before any network fetch (known + EA CDN). */
export function resolveBenchmarkHeadshotUrls(playerName: string): string[] {
  return dedupeUrls([
    ...getKnownBenchmarkHeadshotUrls(playerName),
    ...buildEaFcHeadshotUrls(playerName),
  ]);
}

/** Full resolution order: known static, TheSportsDB, then EA CDN. */
export async function resolveBenchmarkHeadshotUrlsAsync(playerName: string): Promise<string[]> {
  const known = getKnownBenchmarkHeadshotUrls(playerName);
  const sportsDb = await fetchBenchmarkHeadshotUrlsFromSportsDb(playerName);
  const ea = buildEaFcHeadshotUrls(playerName);
  return dedupeUrls([...known, ...sportsDb, ...ea]);
}

export function benchmarkNameFromRecord(benchmark: Record<string, unknown>): string {
  return String(
    benchmark.full_name ?? benchmark.playerName ?? benchmark.name ?? "Benchmark profile",
  );
}
