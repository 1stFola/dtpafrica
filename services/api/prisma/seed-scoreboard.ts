import type { PrismaClient } from "@prisma/client";

const COMP_SLUG = "jagaban-cup-2026";

type ScoreboardEventSeed = {
  matchId: string;
  teamId: string;
  type: string;
  minute: number;
  playerLabel: string;
  playerId?: string;
  assistLabel?: string;
  detail?: string;
};

export async function seedScoreboard(prisma: PrismaClient, seedPlayerId?: string) {
  const comp = await prisma.sbCompetition.upsert({
    where: { slug: COMP_SLUG },
    update: { type: "youth_tournament" },
    create: {
      slug: COMP_SLUG,
      name: "Jagaban Cup",
      season: "2026",
      type: "youth_tournament",
      country: "Nigeria",
      description:
        "Showcase youth tournament — live supervision, standings, and highlights on ScoreBoard.",
    },
  });

  const teamData = [
    { slug: "lagos-stars", name: "Lagos Stars", shortName: "LGS", city: "Lagos" },
    { slug: "abuja-united", name: "Abuja United", shortName: "ABU", city: "Abuja" },
    { slug: "ph-city", name: "Port Harcourt City", shortName: "PHC", city: "Port Harcourt" },
    { slug: "kano-falcons", name: "Kano Falcons", shortName: "KAN", city: "Kano" },
  ];

  const teams: Record<string, { id: string }> = {};
  for (const t of teamData) {
    const row = await prisma.sbTeam.upsert({
      where: {
        competitionId_slug: { competitionId: comp.id, slug: t.slug },
      },
      update: {},
      create: { competitionId: comp.id, ...t },
    });
    teams[t.slug] = row;
  }

  const rosterRows = [
    { team: "lagos-stars", shirtNumber: 7, displayName: "Adewale T.", position: "RW" },
    { team: "lagos-stars", shirtNumber: 9, displayName: "Okonkwo C.", position: "ST" },
    { team: "abuja-united", shirtNumber: 8, displayName: "Bello A.", position: "CM" },
    { team: "abuja-united", shirtNumber: 11, displayName: "Musa I.", position: "LW" },
    { team: "ph-city", shirtNumber: 4, displayName: "Ebiye P.", position: "CB" },
    { team: "ph-city", shirtNumber: 10, displayName: "Tamuno S.", position: "AM" },
    { team: "kano-falcons", shirtNumber: 9, displayName: "Yusuf M.", position: "ST" },
    { team: "kano-falcons", shirtNumber: 6, displayName: "Ibrahim K.", position: "DM" },
  ];

  for (const row of rosterRows) {
    const exists = await prisma.sbTeamSquad.findFirst({
      where: { teamId: teams[row.team].id, shirtNumber: row.shirtNumber },
    });
    if (!exists) {
      await prisma.sbTeamSquad.create({
        data: {
          teamId: teams[row.team].id,
          shirtNumber: row.shirtNumber,
          displayName: row.displayName,
          position: row.position,
        },
      });
    }
  }

  if (seedPlayerId) {
    const existingSquad = await prisma.sbTeamSquad.findFirst({
      where: { teamId: teams["lagos-stars"].id, playerId: seedPlayerId },
    });
    if (!existingSquad) {
      const player = await prisma.player.findUnique({
        where: { id: seedPlayerId },
      });
      if (player) {
        await prisma.sbTeamSquad.create({
          data: {
            teamId: teams["lagos-stars"].id,
            playerId: seedPlayerId,
            shirtNumber: 10,
            displayName: player.displayName,
            position: player.positionPrimary,
          },
        });
      }
    }
  }

  const finished1 = await prisma.sbMatch.upsert({
    where: { id: "00000000-0000-4000-8000-000000000010" },
    update: {
      stats: {
        possession: { home: 54, away: 46 },
        shots: { home: 11, away: 8 },
        shotsOnTarget: { home: 5, away: 3 },
        corners: { home: 6, away: 4 },
        fouls: { home: 10, away: 13 },
        xg: { home: 1.8, away: 1.1 },
      },
    },
    create: {
      id: "00000000-0000-4000-8000-000000000010",
      competitionId: comp.id,
      homeTeamId: teams["lagos-stars"].id,
      awayTeamId: teams["abuja-united"].id,
      status: "finished",
      homeScore: 2,
      awayScore: 1,
      kickoffAt: new Date("2026-05-10T15:00:00Z"),
      venue: "Onikan Stadium",
      roundLabel: "Group A · MD1",
      stats: {
        possession: { home: 54, away: 46 },
        shots: { home: 11, away: 8 },
        shotsOnTarget: { home: 5, away: 3 },
        corners: { home: 6, away: 4 },
        fouls: { home: 10, away: 13 },
        xg: { home: 1.8, away: 1.1 },
      },
    },
  });

  await prisma.sbMatch.upsert({
    where: { id: "00000000-0000-4000-8000-000000000011" },
    update: {},
    create: {
      id: "00000000-0000-4000-8000-000000000011",
      competitionId: comp.id,
      homeTeamId: teams["ph-city"].id,
      awayTeamId: teams["kano-falcons"].id,
      status: "finished",
      homeScore: 1,
      awayScore: 1,
      kickoffAt: new Date("2026-05-12T16:00:00Z"),
      venue: "Adokiye Amiesimaka",
      roundLabel: "Group A · MD2",
    },
  });

  const liveMatch = await prisma.sbMatch.upsert({
    where: { id: "00000000-0000-4000-8000-000000000012" },
    update: {
      status: "live",
      minute: 67,
      homeScore: 1,
      awayScore: 2,
      stats: {
        possession: { home: 49, away: 51 },
        shots: { home: 7, away: 10 },
        shotsOnTarget: { home: 3, away: 5 },
        corners: { home: 2, away: 5 },
        fouls: { home: 8, away: 7 },
        xg: { home: 0.9, away: 1.6 },
      },
    },
    create: {
      id: "00000000-0000-4000-8000-000000000012",
      competitionId: comp.id,
      homeTeamId: teams["lagos-stars"].id,
      awayTeamId: teams["kano-falcons"].id,
      status: "live",
      minute: 67,
      homeScore: 1,
      awayScore: 2,
      kickoffAt: new Date(),
      venue: "Mobolaji Johnson Arena",
      roundLabel: "Group A · MD3",
      stats: {
        possession: { home: 49, away: 51 },
        shots: { home: 7, away: 10 },
        shotsOnTarget: { home: 3, away: 5 },
        corners: { home: 2, away: 5 },
        fouls: { home: 8, away: 7 },
        xg: { home: 0.9, away: 1.6 },
      },
    },
  });

  await prisma.sbMatch.upsert({
    where: { id: "00000000-0000-4000-8000-000000000013" },
    update: {},
    create: {
      id: "00000000-0000-4000-8000-000000000013",
      competitionId: comp.id,
      homeTeamId: teams["abuja-united"].id,
      awayTeamId: teams["ph-city"].id,
      status: "scheduled",
      kickoffAt: new Date(Date.now() + 86400000 * 2),
      venue: "MKO Abiola Stadium",
      roundLabel: "Group A · MD4",
    },
  });

  const eventSeed: ScoreboardEventSeed[] = [
    {
      matchId: finished1.id,
      teamId: teams["lagos-stars"].id,
      type: "goal",
      minute: 23,
      playerLabel: "Okonkwo C.",
      assistLabel: "Adewale T.",
    },
    {
      matchId: finished1.id,
      teamId: teams["abuja-united"].id,
      type: "goal",
      minute: 41,
      playerLabel: "Bello A.",
    },
    {
      matchId: finished1.id,
      teamId: teams["lagos-stars"].id,
      type: "goal",
      minute: 78,
      playerLabel: "SANNI A.",
      playerId: seedPlayerId,
      assistLabel: "Okonkwo C.",
    },
    {
      matchId: liveMatch.id,
      teamId: teams["kano-falcons"].id,
      type: "goal",
      minute: 12,
      playerLabel: "Yusuf M.",
    },
    {
      matchId: liveMatch.id,
      teamId: teams["lagos-stars"].id,
      type: "goal",
      minute: 34,
      playerLabel: "SANNI A.",
      playerId: seedPlayerId,
      assistLabel: "Adewale T.",
    },
    {
      matchId: liveMatch.id,
      teamId: teams["kano-falcons"].id,
      type: "goal",
      minute: 55,
      playerLabel: "Ibrahim K.",
      assistLabel: "Yusuf M.",
    },
    {
      matchId: liveMatch.id,
      teamId: teams["kano-falcons"].id,
      type: "yellow_card",
      minute: 60,
      playerLabel: "Defender",
      detail: "Dissent",
    },
  ];

  let liveSeedGoalEventId: string | undefined;
  for (const ev of eventSeed) {
    const exists = await prisma.sbMatchEvent.findFirst({
      where: {
        matchId: ev.matchId,
        minute: ev.minute,
        type: ev.type,
        playerLabel: ev.playerLabel,
      },
    });
    let eventId = exists?.id;
    if (!exists) {
      const created = await prisma.sbMatchEvent.create({ data: ev });
      eventId = created.id;
    } else if (ev.playerId && exists.playerId !== ev.playerId) {
      const updated = await prisma.sbMatchEvent.update({
        where: { id: exists.id },
        data: { playerId: ev.playerId, assistLabel: ev.assistLabel },
      });
      eventId = updated.id;
    } else if (ev.assistLabel && exists.assistLabel !== ev.assistLabel) {
      const updated = await prisma.sbMatchEvent.update({
        where: { id: exists.id },
        data: { assistLabel: ev.assistLabel },
      });
      eventId = updated.id;
    }
    if (ev.matchId === liveMatch.id && ev.minute === 34 && ev.type === "goal") {
      liveSeedGoalEventId = eventId;
    }
  }

  await prisma.sbHighlight.upsert({
    where: { id: "00000000-0000-4000-8000-000000000020" },
    update: { eventId: liveSeedGoalEventId },
    create: {
      id: "00000000-0000-4000-8000-000000000020",
      competitionId: comp.id,
      matchId: liveMatch.id,
      eventId: liveSeedGoalEventId,
      title: "Jagaban Cup MD3 — Match highlights",
      youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    },
  });

  console.log("ScoreBoard seed:", comp.name, "→", COMP_SLUG);
  console.log("Live match:", liveMatch.id);
}
