import { normalizePlayerName, playerLookupKey } from "@dtp/engines";

export type PlayerNameCandidate = {
  playerId: string;
  displayName: string;
  aliases?: Array<string | null | undefined>;
};

function tokens(value: string) {
  return playerLookupKey(normalizePlayerName(value))
    .split(" ")
    .filter(Boolean);
}

function sortedTokenKey(value: string) {
  return tokens(value).sort().join(" ");
}

function levenshtein(a: string, b: string) {
  const prev = Array.from({ length: b.length + 1 }, (_, index) => index);
  const curr = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }

  return prev[b.length] ?? Math.max(a.length, b.length);
}

function similarity(a: string, b: string) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const max = Math.max(a.length, b.length);
  return max ? 1 - levenshtein(a, b) / max : 0;
}

function candidateKeys(candidate: PlayerNameCandidate) {
  return [candidate.displayName, ...(candidate.aliases ?? [])]
    .map((value) => playerLookupKey(normalizePlayerName(value ?? "")))
    .filter(Boolean);
}

export function resolvePlayerNameCandidate(
  rawName: string | null | undefined,
  candidates: PlayerNameCandidate[],
  options?: { minimumSimilarity?: number }
) {
  const key = playerLookupKey(normalizePlayerName(rawName ?? ""));
  if (!key) return null;

  const exact = candidates.filter((candidate) => candidateKeys(candidate).includes(key));
  if (exact.length === 1) return exact[0];

  const sortedKey = sortedTokenKey(key);
  const reordered = candidates.filter((candidate) =>
    candidateKeys(candidate).some((candidateKey) => sortedTokenKey(candidateKey) === sortedKey)
  );
  if (reordered.length === 1) return reordered[0];

  const inputTokens = new Set(tokens(key));
  const scored = candidates
    .map((candidate) => {
      const best = Math.max(
        ...candidateKeys(candidate).map((candidateKey) => {
          const candidateTokens = new Set(tokens(candidateKey));
          const overlap = [...inputTokens].filter((token) => candidateTokens.has(token)).length;
          const tokenScore = overlap / Math.max(inputTokens.size, candidateTokens.size, 1);
          return Math.max(similarity(key, candidateKey), similarity(sortedKey, sortedTokenKey(candidateKey)), tokenScore);
        }),
        0
      );
      return { candidate, score: best };
    })
    .filter((entry) => entry.score >= (options?.minimumSimilarity ?? 0.88))
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;
  if (scored.length > 1 && scored[0].score - scored[1].score < 0.04) return null;
  return scored[0].candidate;
}
