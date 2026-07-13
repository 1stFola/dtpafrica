import type { PrismaClient } from "@prisma/client";
import { normalizePlayerAgeCategory } from "../src/players/age-category";

export async function syncPlayerAgeCategories(prisma: PrismaClient) {
  const players = await prisma.player.findMany({
    select: {
      id: true,
      age: true,
      ageGroup: true,
      dateOfBirth: true,
    },
  });

  let updated = 0;
  for (const player of players) {
    const nextAgeGroup = normalizePlayerAgeCategory(player);
    if (!nextAgeGroup || nextAgeGroup === player.ageGroup) continue;
    await prisma.player.update({
      where: { id: player.id },
      data: { ageGroup: nextAgeGroup },
    });
    updated += 1;
  }

  return updated;
}
