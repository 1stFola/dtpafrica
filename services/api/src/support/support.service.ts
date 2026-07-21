import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateSupportReportDto } from "./dto/create-support-report.dto";
import { UpdateSupportReportDto } from "./dto/update-support-report.dto";
import {
  SUPPORT_PLAYBOOK,
  recommendPlaybookEntry,
  type SupportPlaybookEntry,
} from "./support-playbook";

function cleanString(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function statusRank(status: string) {
  return ["open", "triaged", "waiting_on_human", "resolved", "closed"].indexOf(status);
}

function isMissingSupportTableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /support_reports|support reports are not ready|relation .* does not exist|does not exist/i.test(
    error.message
  );
}

type SupportReportRow = {
  id: string;
  audience: string;
  reporter_name: string | null;
  reporter_email: string | null;
  category: string;
  severity: string;
  status: string;
  subject: string;
  description: string;
  page_url: string | null;
  recommendation_key: string | null;
  context: unknown;
  admin_notes: string | null;
  resolution_summary: string | null;
  playbook_outcome: string | null;
  playbook_proposal: string | null;
  created_at: Date;
  updated_at: Date;
  resolved_at: Date | null;
};

type PresentedSupportReport = {
  id: string;
  audience: string;
  reporterName: string | null;
  reporterEmail: string | null;
  category: string;
  severity: string;
  status: string;
  subject: string;
  description: string;
  pageUrl: string | null;
  recommendationKey: string | null;
  recommendation: SupportPlaybookEntry | null;
  adminNotes: string | null;
  resolutionSummary: string | null;
  playbookOutcome: string;
  playbookProposal: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};

type SupportTriagePacket = {
  report: PresentedSupportReport;
  generatedAt: string;
  mode: "recommend_only";
  recommendedTier: SupportPlaybookEntry["tier"];
  escalationRequired: boolean;
  likelyCause: string;
  evidence: Array<{ label: string; value: string | number; status: "ok" | "warning" | "critical" }>;
  diagnosticChecklist: string[];
  recommendedActions: string[];
  similarReports: PresentedSupportReport[];
  humanApprovalRequiredFor: string[];
  learningLoopPrompt: string;
};

type SupportPatternRow = {
  category: string;
  recommendation_key: string | null;
  total: bigint;
  open_count: bigint;
  critical_count: bigint;
  latest_at: Date;
};

type SupportReviewQueue = {
  generatedAt: string;
  mode: "recommend_only";
  learningQueue: PresentedSupportReport[];
  repeatedPatterns: Array<{
    category: string;
    recommendationKey: string | null;
    recommendation: SupportPlaybookEntry | null;
    total: number;
    openCount: number;
    criticalCount: number;
    latestAt: string;
    suggestedReview: string;
  }>;
  routingRules: Array<{
    category: string;
    owner: string;
    escalation: string;
    humanApprovalRequiredFor: string[];
  }>;
};

@Injectable()
export class SupportService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async summary() {
    try {
      const [open, critical, latestRows] = await Promise.all([
        this.countSupportReports(Prisma.sql`WHERE status IN ('open', 'triaged')`),
        this.countSupportReports(
          Prisma.sql`WHERE status IN ('open', 'triaged') AND severity = 'critical'`
        ),
        this.prisma.$queryRaw<Array<{ created_at: Date }>>(Prisma.sql`
          SELECT created_at FROM support_reports ORDER BY created_at DESC LIMIT 1
        `),
      ]);
      return {
        ready: true,
        open,
        critical,
        latestCreatedAt: latestRows[0]?.created_at?.toISOString() ?? null,
      };
    } catch (error) {
      if (isMissingSupportTableError(error)) {
        return {
          ready: false,
          open: 0,
          critical: 0,
          latestCreatedAt: null,
          setupRequired: "Run pnpm db:push to create support_reports.",
        };
      }
      throw error;
    }
  }

  async createReport(dto: CreateSupportReportDto, requestContext?: Record<string, unknown>) {
    const recommendation = recommendPlaybookEntry(dto);
    const rows = await this.prisma.$queryRaw<SupportReportRow[]>(Prisma.sql`
      INSERT INTO support_reports (
        audience,
        reporter_name,
        reporter_email,
        category,
        severity,
        subject,
        description,
        page_url,
        recommendation_key,
        context
      )
      VALUES (
        ${dto.audience ?? "internal_admin"},
        ${cleanString(dto.reporterName) ?? null},
        ${cleanString(dto.reporterEmail) ?? null},
        ${dto.category},
        ${dto.severity ?? recommendation.severity},
        ${dto.subject.trim()},
        ${dto.description.trim()},
        ${cleanString(dto.pageUrl) ?? null},
        ${recommendation.key},
        CAST(${JSON.stringify(requestContext ?? {})} AS jsonb)
      )
      RETURNING *
    `);
    const report = rows[0];

    return {
      ok: true,
      report: this.presentReport(report, recommendation),
      recommendation,
    };
  }

  async listReports(query: { status?: string; category?: string; q?: string; limit?: number }) {
    const clauses: Prisma.Sql[] = [];
    if (query.status?.trim()) clauses.push(Prisma.sql`status = ${query.status.trim()}`);
    if (query.category?.trim()) clauses.push(Prisma.sql`category = ${query.category.trim()}`);
    if (query.q?.trim()) {
      const like = `%${query.q.trim()}%`;
      clauses.push(Prisma.sql`(
        subject ILIKE ${like}
        OR description ILIKE ${like}
        OR reporter_name ILIKE ${like}
        OR reporter_email ILIKE ${like}
      )`);
    }
    const whereSql =
      clauses.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(clauses, " AND ")}`
        : Prisma.empty;
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    let rows: SupportReportRow[] = [];
    try {
      rows = await this.prisma.$queryRaw<SupportReportRow[]>(Prisma.sql`
        SELECT *
        FROM support_reports
        ${whereSql}
        ORDER BY status ASC, created_at DESC
        LIMIT ${limit}
      `);
    } catch (error) {
      if (isMissingSupportTableError(error)) return [];
      throw error;
    }

    return rows
      .sort((a, b) => statusRank(a.status) - statusRank(b.status))
      .map((row) => this.presentReport(row));
  }

  async updateReport(id: string, dto: UpdateSupportReportDto) {
    const existingRows = await this.prisma.$queryRaw<SupportReportRow[]>(Prisma.sql`
      SELECT * FROM support_reports WHERE id = ${id} LIMIT 1
    `);
    const existing = existingRows[0];
    if (!existing) throw new NotFoundException("Support report not found");
    if (
      !dto.status &&
      dto.adminNotes === undefined &&
      dto.resolutionSummary === undefined &&
      dto.playbookOutcome === undefined &&
      dto.playbookProposal === undefined
    ) {
      throw new BadRequestException("Provide status, adminNotes, or learning-loop fields");
    }
    const nextStatus = dto.status ?? existing.status;
    const resolvedAt =
      nextStatus === "resolved" || nextStatus === "closed"
        ? existing.resolved_at ?? new Date()
        : null;
    const nextResolutionSummary =
      dto.resolutionSummary === undefined
        ? existing.resolution_summary
        : cleanString(dto.resolutionSummary) ?? null;
    const nextAdminNotes =
      dto.adminNotes === undefined ? existing.admin_notes : cleanString(dto.adminNotes) ?? null;
    const nextPlaybookProposal =
      dto.playbookProposal === undefined
        ? existing.playbook_proposal
        : cleanString(dto.playbookProposal) ?? null;
    const rows = await this.prisma.$queryRaw<SupportReportRow[]>(Prisma.sql`
      UPDATE support_reports
      SET
        status = ${nextStatus},
        admin_notes = ${nextAdminNotes},
        resolution_summary = ${nextResolutionSummary},
        playbook_outcome = ${dto.playbookOutcome ?? existing.playbook_outcome ?? "not_reviewed"},
        playbook_proposal = ${nextPlaybookProposal},
        resolved_at = ${resolvedAt},
        updated_at = now()
      WHERE id = ${id}
      RETURNING *
    `);
    const row = rows[0];
    return this.presentReport(row);
  }

  async triageReport(id: string): Promise<SupportTriagePacket> {
    const rows = await this.querySupportRows(Prisma.sql`
      SELECT * FROM support_reports WHERE id = ${id} LIMIT 1
    `);
    const row = rows[0];
    if (!row) throw new NotFoundException("Support report not found");

    const recommendation =
      SUPPORT_PLAYBOOK.find((entry) => entry.key === row.recommendation_key) ??
      recommendPlaybookEntry({
        category: row.category,
        subject: row.subject,
        description: row.description,
      });
    const [similarReports, evidence] = await Promise.all([
      this.querySupportRows(Prisma.sql`
        SELECT *
        FROM support_reports
        WHERE id <> ${row.id}
          AND (
            category = ${row.category}
            OR recommendation_key = ${recommendation.key}
          )
        ORDER BY created_at DESC
        LIMIT 5
      `),
      this.buildEvidenceForReport(row),
    ]);
    const escalationRequired =
      row.severity === "critical" || recommendation.tier === "tier_3_human";

    return {
      report: this.presentReport(row, recommendation),
      generatedAt: new Date().toISOString(),
      mode: "recommend_only",
      recommendedTier: recommendation.tier,
      escalationRequired,
      likelyCause: this.inferLikelyCause(row, recommendation),
      evidence,
      diagnosticChecklist: recommendation.diagnostics,
      recommendedActions: this.recommendedActions(row, recommendation),
      similarReports: similarReports.map((similar) => this.presentReport(similar)),
      humanApprovalRequiredFor: [
        "database writes or data repair",
        "player profile merges",
        "deployment reruns or rollback",
        "permission/security changes",
        "public content corrections",
      ],
      learningLoopPrompt:
        "After the human resolves this, update the support playbook if the final fix differs from the recommendation.",
    };
  }

  async reviewQueue(): Promise<SupportReviewQueue> {
    let learningRows: SupportReportRow[] = [];
    let patternRows: SupportPatternRow[] = [];
    try {
      [learningRows, patternRows] = await Promise.all([
        this.querySupportRows(Prisma.sql`
          SELECT *
          FROM support_reports
          WHERE playbook_outcome IN ('updated', 'new_entry_needed')
          ORDER BY updated_at DESC
          LIMIT 50
        `),
        this.prisma.$queryRaw<SupportPatternRow[]>(Prisma.sql`
          SELECT
            category,
            recommendation_key,
            COUNT(*)::bigint AS total,
            COUNT(*) FILTER (WHERE status IN ('open', 'triaged', 'waiting_on_human'))::bigint AS open_count,
            COUNT(*) FILTER (WHERE severity = 'critical')::bigint AS critical_count,
            MAX(created_at) AS latest_at
          FROM support_reports
          WHERE created_at >= now() - interval '90 days'
          GROUP BY category, recommendation_key
          HAVING COUNT(*) >= 2
          ORDER BY critical_count DESC, total DESC, latest_at DESC
          LIMIT 12
        `),
      ]);
    } catch (error) {
      if (!isMissingSupportTableError(error)) throw error;
    }

    return {
      generatedAt: new Date().toISOString(),
      mode: "recommend_only",
      learningQueue: learningRows.map((row) => this.presentReport(row)),
      repeatedPatterns: patternRows.map((row) => {
        const recommendation =
          SUPPORT_PLAYBOOK.find((entry) => entry.key === row.recommendation_key) ?? null;
        const total = Number(row.total ?? 0);
        const openCount = Number(row.open_count ?? 0);
        const criticalCount = Number(row.critical_count ?? 0);
        return {
          category: row.category,
          recommendationKey: row.recommendation_key,
          recommendation,
          total,
          openCount,
          criticalCount,
          latestAt: row.latest_at.toISOString(),
          suggestedReview: this.patternSuggestion(row.category, total, openCount, criticalCount),
        };
      }),
      routingRules: this.routingRules(),
    };
  }

  async diagnostics() {
    const supportSummary = await this.summary();
    const [
      recentReports,
      liveMatches,
      scheduledMatches,
      missingPlayerLinks,
      duplicateSlugProfiles,
      nameQaSingleNames,
      pendingHighlights,
      learningQueue,
    ] = await Promise.all([
      supportSummary.ready
        ? this.prisma.$queryRaw<SupportReportRow[]>(Prisma.sql`
            SELECT * FROM support_reports ORDER BY created_at DESC LIMIT 8
          `)
        : Promise.resolve([]),
      this.prisma.sbMatch.count({ where: { status: "live" } }),
      this.prisma.sbMatch.count({ where: { status: "scheduled" } }),
      this.prisma.sbMatchEvent.count({
        where: {
          OR: [
            { playerId: null, playerLabel: { not: null } },
            { assistPlayerId: null, assistLabel: { not: null } },
            { playerLabel2: { not: null } },
          ],
        },
      }),
      this.prisma.player.count({
        where: { slug: { endsWith: "-1" } },
      }),
      this.prisma.player.count({
        where: { displayName: { not: { contains: " " } } },
      }),
      this.prisma.sbHighlight.count({ where: { isPublished: false } }),
      supportSummary.ready
        ? this.countSupportReports(
            Prisma.sql`WHERE playbook_outcome IN ('updated', 'new_entry_needed')`
          )
        : Promise.resolve(0),
    ]);

    const signals = [
      {
        key: "support-open-reports",
        label: "Open support reports",
        value: supportSummary.ready ? supportSummary.open : "setup required",
        status: !supportSummary.ready
          ? "critical"
          : supportSummary.critical > 0
            ? "critical"
            : supportSummary.open > 0
              ? "warning"
              : "ok",
        recommendation:
          !supportSummary.ready
            ? supportSummary.setupRequired ?? "Run database setup before using support reports."
            : supportSummary.critical > 0
            ? "Review critical reports immediately and escalate sensitive/security issues to a human owner."
            : "Review open reports and convert repeat resolutions into playbook updates.",
      },
      {
        key: "scoreboard-match-control",
        label: "ScoreBoard match-control readiness",
        value: liveMatches + scheduledMatches,
        status: liveMatches + scheduledMatches > 0 ? "ok" : "warning",
        recommendation:
          "If Match Center is blank, verify scheduled/live fixtures, ScoreBoard Ops permissions, and API deploy health.",
      },
      {
        key: "unlinked-scoreboard-mentions",
        label: "Unlinked ScoreBoard mentions",
        value: missingPlayerLinks,
        status: missingPlayerLinks > 0 ? "warning" : "ok",
        recommendation:
          "Use Name QA and player merge tools to link complete names to canonical player profiles.",
      },
      {
        key: "duplicate-player-slugs",
        label: "Possible -1 duplicate profiles",
        value: duplicateSlugProfiles,
        status: duplicateSlugProfiles > 0 ? "warning" : "ok",
        recommendation:
          "Search the Players/Name QA merge tool and move ScoreBoard history into the canonical profile.",
      },
      {
        key: "single-name-profiles",
        label: "Single-name player records",
        value: nameQaSingleNames,
        status: nameQaSingleNames > 0 ? "warning" : "ok",
        recommendation:
          "Complete first/last names before making timeline names clickable or treating them as verified profiles.",
      },
      {
        key: "pending-highlights",
        label: "Unpublished highlights",
        value: pendingHighlights,
        status: pendingHighlights > 0 ? "warning" : "ok",
        recommendation:
          "Review queued video clips in the supervisor/highlights approval workflow before public display.",
      },
      {
        key: "latest-seed",
        label: "Latest database seed",
        value: "GitHub Actions",
        status: "ok",
        recommendation:
          "Use GitHub Actions logs as the source of truth for production seed/deploy failures.",
      },
      {
        key: "playbook-learning-queue",
        label: "Playbook learning queue",
        value: learningQueue,
        status: learningQueue > 0 ? "warning" : "ok",
        recommendation:
          "Review resolved reports marked as playbook updates/new entries and fold them into docs/support-playbook.",
      },
    ];

    return {
      generatedAt: new Date().toISOString(),
      supportMode: "recommend_only",
      signals,
      recentReports: recentReports.map((row) => this.presentReport(row)),
      playbook: SUPPORT_PLAYBOOK,
    };
  }

  playbook(): SupportPlaybookEntry[] {
    return SUPPORT_PLAYBOOK;
  }

  private async countSupportReports(where: Prisma.Sql) {
    const rows = await this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count FROM support_reports ${where}
    `);
    return Number(rows[0]?.count ?? 0);
  }

  private async querySupportRows(sql: Prisma.Sql) {
    try {
      return await this.prisma.$queryRaw<SupportReportRow[]>(sql);
    } catch (error) {
      if (isMissingSupportTableError(error)) {
        throw new BadRequestException("Support reports are not ready. Run pnpm db:push first.");
      }
      throw error;
    }
  }

  private inferLikelyCause(row: SupportReportRow, recommendation: SupportPlaybookEntry) {
    const text = `${row.subject} ${row.description}`.toLowerCase();
    if (text.includes("-1") || text.includes("duplicate")) {
      return "A ScoreBoard-created player identity likely needs to be merged into the canonical master player profile.";
    }
    if (text.includes("supervisor") || text.includes("no matches")) {
      return "Match Center may be missing scheduled/live fixtures, permissions, or a healthy API/supervisor connection.";
    }
    if (text.includes("seed") || text.includes("github") || text.includes("deploy")) {
      return "Deployment or seed failure likely needs GitHub Actions log review before any production retry.";
    }
    if (text.includes("height") || text.includes("weight") || text.includes("benchmark")) {
      return "Calibration metadata may need input-format verification and a human re-save/check of the public profile.";
    }
    return `The issue most closely matches the '${recommendation.title}' playbook path.`;
  }

  private recommendedActions(row: SupportReportRow, recommendation: SupportPlaybookEntry) {
    const base = [
      recommendation.recommendation,
      "Collect the related URL, player/match/competition identifiers, and any GitHub Actions run URL if deployment is involved.",
      "Do not execute production-changing actions from the support agent; prepare the recommendation for human approval.",
    ];
    if (row.category === "player_data") {
      base.push("Use Name QA and merge tools to compare source and canonical player profiles before moving ScoreBoard history.");
    }
    if (row.category === "scoreboard_ops") {
      base.push("Check match status, fixture availability, event labels, and ScoreBoard Ops permissions before changing data.");
    }
    if (row.category === "deployment") {
      base.push("Attach the failing GitHub Actions log excerpt to the report before rerunning any seed/deploy step.");
    }
    return base;
  }

  private patternSuggestion(
    category: string,
    total: number,
    openCount: number,
    criticalCount: number
  ) {
    if (criticalCount > 0) {
      return "Repeated critical reports should be routed to the owner immediately before updating the playbook.";
    }
    if (openCount >= 2) {
      return "Multiple unresolved reports match this pattern. Review whether the current recommendation is too vague.";
    }
    if (category === "player_data") {
      return "Consider adding a sharper merge/name-normalization prevention note to the player data playbook.";
    }
    if (category === "scoreboard_ops") {
      return "Consider adding fixture/status/permission checks to the ScoreBoard operations runbook.";
    }
    return `This pattern appeared ${total} times in 90 days. Confirm whether it should become a Tier 1 playbook path.`;
  }

  private routingRules() {
    return [
      {
        category: "scoreboard_ops",
        owner: "ScoreBoard Ops lead",
        escalation: "Escalate live-match blockers, supervisor outages, and score/standings disputes.",
        humanApprovalRequiredFor: ["timeline edits", "final score changes", "standings recalculation"],
      },
      {
        category: "player_data",
        owner: "Player Data admin",
        escalation: "Escalate profile merges, duplicate identities, and disputed player history.",
        humanApprovalRequiredFor: ["profile merge", "history reassignment", "name normalization"],
      },
      {
        category: "calibration",
        owner: "Calibration reviewer",
        escalation: "Escalate rating formula concerns or benchmark/input-format issues.",
        humanApprovalRequiredFor: ["rating re-save", "benchmark changes", "formula changes"],
      },
      {
        category: "media_highlights",
        owner: "Media/highlights reviewer",
        escalation: "Escalate upload failures, approval blockers, or public publishing disputes.",
        humanApprovalRequiredFor: ["publish/unpublish", "clip deletion", "source URL correction"],
      },
      {
        category: "deployment",
        owner: "Engineering/deployment owner",
        escalation: "Escalate failed production deploys, seed failures, and database migration conflicts.",
        humanApprovalRequiredFor: ["deploy rerun", "rollback", "database repair"],
      },
      {
        category: "access_permissions",
        owner: "Admin security owner",
        escalation: "Escalate login, role, and permission problems that affect production access.",
        humanApprovalRequiredFor: ["role update", "account reset", "permission grant"],
      },
      {
        category: "content_admin",
        owner: "Content admin",
        escalation: "Escalate public page copy/media publishing issues.",
        humanApprovalRequiredFor: ["public content change", "SEO metadata update"],
      },
    ];
  }

  private async buildEvidenceForReport(row: SupportReportRow) {
    const evidence: Array<{ label: string; value: string | number; status: "ok" | "warning" | "critical" }> = [];
    if (row.category === "scoreboard_ops") {
      const [live, scheduled, unlinked] = await Promise.all([
        this.prisma.sbMatch.count({ where: { status: "live" } }),
        this.prisma.sbMatch.count({ where: { status: "scheduled" } }),
        this.prisma.sbMatchEvent.count({
          where: {
            OR: [
              { playerId: null, playerLabel: { not: null } },
              { assistPlayerId: null, assistLabel: { not: null } },
              { playerLabel2: { not: null } },
            ],
          },
        }),
      ]);
      evidence.push(
        { label: "Live matches", value: live, status: live > 0 ? "ok" : "warning" },
        { label: "Scheduled matches", value: scheduled, status: scheduled > 0 ? "ok" : "warning" },
        { label: "Unlinked timeline mentions", value: unlinked, status: unlinked > 0 ? "warning" : "ok" }
      );
    } else if (row.category === "player_data") {
      const [duplicates, singleNames, unlinked] = await Promise.all([
        this.prisma.player.count({ where: { slug: { endsWith: "-1" } } }),
        this.prisma.player.count({ where: { displayName: { not: { contains: " " } } } }),
        this.prisma.sbMatchEvent.count({
          where: {
            OR: [
              { playerId: null, playerLabel: { not: null } },
              { assistPlayerId: null, assistLabel: { not: null } },
              { playerLabel2: { not: null } },
            ],
          },
        }),
      ]);
      evidence.push(
        { label: "Possible -1 duplicates", value: duplicates, status: duplicates > 0 ? "warning" : "ok" },
        { label: "Single-name player records", value: singleNames, status: singleNames > 0 ? "warning" : "ok" },
        { label: "Unlinked ScoreBoard mentions", value: unlinked, status: unlinked > 0 ? "warning" : "ok" }
      );
    } else if (row.category === "media_highlights") {
      const pending = await this.prisma.sbHighlight.count({ where: { isPublished: false } });
      evidence.push({
        label: "Unpublished highlights",
        value: pending,
        status: pending > 0 ? "warning" : "ok",
      });
    } else if (row.category === "deployment") {
      evidence.push({
        label: "Production logs source",
        value: "GitHub Actions",
        status: "warning",
      });
    } else {
      evidence.push({
        label: "Report category",
        value: row.category,
        status: row.severity === "critical" ? "critical" : "ok",
      });
    }
    return evidence;
  }

  private presentReport(
    row: {
      id: string;
      audience: string;
      reporter_name: string | null;
      reporter_email: string | null;
      category: string;
      severity: string;
      status: string;
      subject: string;
      description: string;
      page_url: string | null;
      recommendation_key: string | null;
      admin_notes: string | null;
      resolution_summary?: string | null;
      playbook_outcome?: string | null;
      playbook_proposal?: string | null;
      created_at: Date;
      updated_at: Date;
      resolved_at: Date | null;
    },
    recommendation = SUPPORT_PLAYBOOK.find((entry) => entry.key === row.recommendation_key)
  ) {
    return {
      id: row.id,
      audience: row.audience,
      reporterName: row.reporter_name,
      reporterEmail: row.reporter_email,
      category: row.category,
      severity: row.severity,
      status: row.status,
      subject: row.subject,
      description: row.description,
      pageUrl: row.page_url,
      recommendationKey: row.recommendation_key,
      recommendation: recommendation ?? null,
      adminNotes: row.admin_notes,
      resolutionSummary: row.resolution_summary ?? null,
      playbookOutcome: row.playbook_outcome ?? "not_reviewed",
      playbookProposal: row.playbook_proposal ?? null,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      resolvedAt: row.resolved_at?.toISOString() ?? null,
    };
  }
}
