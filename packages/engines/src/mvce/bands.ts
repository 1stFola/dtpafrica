export function confidenceLabel(score: number): string {
  if (score >= 85) return "Elite Prospect";
  if (score >= 70) return "Very Strong";
  if (score >= 55) return "Strong";
  if (score >= 40) return "Moderate";
  if (score >= 25) return "Low";
  return "Very Low";
}

export function marketValueBand(score: number): {
  label: string;
  minEur: number | null;
  maxEur: number | null;
} {
  if (score >= 85) return { label: "€350k–€750k+", minEur: 350_000, maxEur: 750_000 };
  if (score >= 70) return { label: "€150k–€350k", minEur: 150_000, maxEur: 350_000 };
  if (score >= 55) return { label: "€75k–€150k", minEur: 75_000, maxEur: 150_000 };
  if (score >= 40) return { label: "€25k–€75k", minEur: 25_000, maxEur: 75_000 };
  if (score >= 25) return { label: "€10k–€25k", minEur: 10_000, maxEur: 25_000 };
  return { label: "No reliable value", minEur: null, maxEur: null };
}
