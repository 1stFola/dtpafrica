import { PrismaClient } from '@prisma/client';

export async function seedScoutToProInternationalTournament2026(
  prisma: PrismaClient,
  seedPlayerId?: string,
  options?: any
): Promise<void> {
  // Ensure the competition exists
  await prisma.sbCompetition.upsert({
    where: { slug: 'scout-to-pro-international-tournament-2026' },
    update: {},
    create: {
      slug: 'scout-to-pro-international-tournament-2026',
      name: 'Scout To Pro International Tournament 2026',
      season: '2026',
      type: 'tournament',
      status: 'upcoming',
      country: 'Nigeria',
      isPublished: true,
    },
  });
  console.log('Scout To Pro International Tournament 2026: competition ensured');
}
