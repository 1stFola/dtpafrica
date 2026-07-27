import type { PrismaClient } from "@prisma/client";
import { normalizeClubName } from "@dtp/engines";

type AcademyLookupRow = {
  id: string;
  name: string;
  slug: string;
};

function compactAcademyLabel(value: string | null | undefined): string {
  return (value ?? "")
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\b(FOOTBALL|CLUB|ACADEMY|SPORTING)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function academyLabelVariants(value: string | null | undefined) {
  const normalized = compactAcademyLabel(value);
  const compact = normalized.replace(/\s+/g, "");
  return [normalized, compact].filter(Boolean);
}

export function matchAcademyByClubName(
  clubName: string | null | undefined,
  academies: AcademyLookupRow[]
): AcademyLookupRow | null {
  if (!clubName?.trim()) return null;
  const inputVariants = academyLabelVariants(normalizeClubName(clubName));
  if (inputVariants.length === 0) return null;

  const matches = academies.filter((academy) => {
    const academyVariants = [
      ...academyLabelVariants(academy.name),
      ...academyLabelVariants(academy.slug.replace(/-/g, " ")),
    ];
    return inputVariants.some((input) =>
      academyVariants.some(
        (academyLabel) =>
          academyLabel === input ||
          (input.length >= 5 && academyLabel.includes(input)) ||
          (academyLabel.length >= 5 && input.includes(academyLabel))
      )
    );
  });

  return matches.length === 1 ? matches[0] : null;
}

export async function resolveAcademyIdByClubName(
  prisma: Pick<PrismaClient, "academy">,
  clubName: string | null | undefined
): Promise<string | null> {
  if (!clubName?.trim()) return null;
  const academies = await prisma.academy.findMany({
    select: { id: true, name: true, slug: true },
  });
  return matchAcademyByClubName(clubName, academies)?.id ?? null;
}
