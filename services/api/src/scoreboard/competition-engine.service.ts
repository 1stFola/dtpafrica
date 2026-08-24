import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  buildProgressionPreview,
  cloneJagabanConfigForEdition,
  computeGroupStandings,
  generateFixtures,
  getCompetitionTemplate,
  listCompetitionTemplates,
  type CompetitionFormat,
  type CompetitionTemplate,
  type FixtureTeamInput,
  type JagabanCupConfig,
  normalizeClubName,
} from "@dtp/engines";
import { presentScoreboardPayload } from "./present-scoreboard";
import { resolveUniqueMatchSlug } from "./match-slug";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export type CreateCompetitionFromTemplateInput = {
  name: string;
  season: string;
  formatType: CompetitionFormat;
  country?: string;
  description?: string;
  isPublished?: boolean;
  formatConfig?: Record<string, unknown>;
  teams?: Array<{
    name: string;
    slug?: string;
    shortName?: string;
    city?: string;
    groupKey?: string;
  }>;
  generateFixtures?: boolean;
  cloneFromCompetitionId?: string;
};

@Injectable()
export class CompetitionEngineService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  listTemplates(): CompetitionTemplate[] {
    return listCompetitionTemplates();
  }

  previewTemplate(formatType: CompetitionFormat) {
    const template = getCompetitionTemplate(formatType);
    return {
      format: template.format,
      label: template.label,
      description: template.description,
      category: template.category,
      implementationStatus: template.implementationStatus,
      stages: template.stages,
      progressionRules: template.progressionRules,
      progressionPreview: buildProgressionPreview(formatType),
      defaultConfig: template.defaultConfig,
    };
  }

  async createFromTemplate(input: CreateCompetitionFromTemplateInput) {
    const template = getCompetitionTemplate(input.formatType);
    if (template.implementationStatus === "skeleton" && input.generateFixtures) {
      throw new BadRequestException(
        `${input.formatType} is a skeleton format — create stages manually or disable fixture generation`
      );
    }

    let formatConfig = input.formatConfig ?? template.defaultConfig ?? {};
    if (input.formatType === "JAGABAN_CUP_STANDARD") {
      const jagaban =
        (formatConfig.jagaban as JagabanCupConfig | undefined) ??
        cloneJagabanConfigForEdition(input.name);
      formatConfig = { ...formatConfig, jagaban: { ...jagaban, editionLabel: input.name } };
    }

    if (input.cloneFromCompetitionId) {
      const source = await this.prisma.sbCompetition.findUnique({
        where: { id: input.cloneFromCompetitionId },
        include: { stages: true, teams: true },
      });
      if (!source) throw new NotFoundException("Source competition not found");
      formatConfig =
        (source.formatConfig as Record<string, unknown> | null) ?? formatConfig;
    }

    const baseSlug = slugify(input.name);
    let slug = baseSlug;
    let n = 0;
    while (await this.prisma.sbCompetition.findUnique({ where: { slug } })) {
      n += 1;
      slug = `${baseSlug}-${n}`;
    }

    const comp = await this.prisma.sbCompetition.create({
      data: {
        slug,
        name: input.name,
        season: input.season,
        type:
          input.formatType === "SINGLE_FRIENDLY_MATCH"
            ? "friendly"
            : input.formatType === "STANDARD_LEAGUE"
              ? "league"
              : "tournament",
        formatType: input.formatType,
        formatConfig: formatConfig as Prisma.InputJsonValue,
        country: input.country ?? "Nigeria",
        description: input.description,
        isPublished: input.isPublished ?? false,
      },
    });

    const stageRows = template.stages.map((s) => ({
      competitionId: comp.id,
      key: s.key,
      name: s.name,
      stageType: s.type,
      sortOrder: s.sortOrder,
      config: s as unknown as Prisma.InputJsonValue,
    }));
    await this.prisma.sbCompetitionStage.createMany({ data: stageRows });
    const stages = await this.prisma.sbCompetitionStage.findMany({
      where: { competitionId: comp.id },
    });
    const stageByKey = new Map(stages.map((s) => [s.key, s]));

    const createdTeams: FixtureTeamInput[] = [];
    const teamSlugById = new Map<string, string>();
    if (input.teams?.length) {
      for (const t of input.teams) {
        const name = normalizeClubName(t.name);
        const teamSlug = t.slug ?? slugify(name);
        const row = await this.prisma.sbTeam.create({
          data: {
            competitionId: comp.id,
            slug: teamSlug,
            name,
            shortName: t.shortName,
            city: t.city,
            groupKey: t.groupKey,
          },
        });
        teamSlugById.set(row.id, teamSlug);
        createdTeams.push({
          id: row.id,
          name: row.name,
          groupKey: row.groupKey,
        });
      }
    }

    let fixturesCreated = 0;
    if (input.generateFixtures && createdTeams.length >= 2) {
      const fixtures = generateFixtures(comp.id, input.formatType, createdTeams);
      for (const f of fixtures) {
        const stage = stageByKey.get(f.stageKey);
        const homeSlug = teamSlugById.get(f.homeTeamId);
        const awaySlug = teamSlugById.get(f.awayTeamId);
        if (!homeSlug || !awaySlug) continue;
        const slug = await resolveUniqueMatchSlug(this.prisma, homeSlug, awaySlug);
        await this.prisma.sbMatch.create({
          data: {
            slug,
            competitionId: comp.id,
            stageId: stage?.id,
            stageKey: f.stageKey,
            homeTeamId: f.homeTeamId,
            awayTeamId: f.awayTeamId,
            roundLabel: f.roundLabel,
            matchday: f.matchday,
            status: "scheduled",
          },
        });
        fixturesCreated += 1;
      }
    }

    return {
      competition: comp,
      stages,
      teamsCount: createdTeams.length,
      fixturesCreated,
      progressionPreview: buildProgressionPreview(input.formatType),
    };
  }

  async groupStandings(competitionId: string) {
    const competition = await this.prisma.sbCompetition.findUnique({
      where: { id: competitionId },
      include: { teams: true },
    });
    if (!competition) throw new NotFoundException("Competition not found");

    const groupStageKeys = competition.formatType === "JAGABAN_CUP_STANDARD"
      ? ["group_a", "group_b"]
      : undefined;

    const finished = await this.prisma.sbMatch.findMany({
      where: {
        competitionId,
        status: "finished",
        ...(groupStageKeys ? { stageKey: { in: groupStageKeys } } : {}),
      },
      select: {
        homeTeamId: true,
        awayTeamId: true,
        homeScore: true,
        awayScore: true,
        kickoffAt: true,
        stageKey: true,
      },
    });

    const computed = computeGroupStandings(
      competition.teams.map((t) => ({
        id: t.id,
        name: normalizeClubName(t.name),
        shortName: t.shortName,
        groupKey: t.groupKey,
      })),
      finished
    );

    /* Attach crests after the table is computed, rather than widening the
       shared engine signature for a purely presentational field. */
    const crestByTeam = new Map(competition.teams.map((t) => [t.id, t.logoUrl]));
    const rows = computed.map((row) => ({
      ...row,
      logoUrl: crestByTeam.get(row.teamId) ?? null,
    }));

    return presentScoreboardPayload({
      competitionId,
      competitionName: competition.name,
      formatType: competition.formatType,
      groups: [...new Set(rows.map((r) => r.groupKey))].sort(),
      rows,
    });
  }
}
