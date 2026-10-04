import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
import { RequirePermissions } from "../../admin/decorators/require-permissions.decorator";
import { AdminAuthGuard } from "../../admin/guards/admin-auth.guard";
import { PermissionsGuard } from "../../admin/guards/permissions.guard";
import { PrismaService } from "../../prisma/prisma.service";
import { jsonSafe } from "../shared/json-safe";
import { AUDIT_METHODS, auditQuery, type AuditQueryInput } from "./audit-query";
import { VISION_AUDIT_ACTIONS } from "./vision-audit.service";

/**
 * Reading the audit trail.
 *
 * The trail says who read raw youth footage, who put a name to a player and who
 * promoted a model, with their email beside it. That is not something every
 * annotator should be able to browse, so it has its own permission,
 * `vision.audit.read`, and `vision.read` does not open it (docs/vision/69).
 *
 * It is read-only. Nothing here writes, edits or removes a row: the trail is
 * written by the services as things happen and by nobody afterwards.
 */
@Controller("vision/audit")
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class VisionAuditController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Newest first, a page at a time. `nextCursor` is the last row of this page;
   * sent back as `cursor` it continues from there, so rows written while
   * somebody is reading do not shift the pages under them.
   */
  @Get()
  @RequirePermissions("vision.audit.read")
  async list(@Query() raw: AuditQueryInput) {
    const { where, limit, cursor } = auditQuery(raw);

    const rows = await this.prisma.visionAuditLog.findMany({
      where,
      // The id breaks ties: rows written in one millisecond keep one order.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const items = rows.slice(0, limit);

    return jsonSafe({
      items,
      nextCursor: rows.length > limit ? items[items.length - 1].id : null,
      // The first page says how much there is and what can be asked for; a later
      // page is a continuation and does not count the table again.
      ...(cursor ? {} : { matching: await this.prisma.visionAuditLog.count({ where }), facets: await this.facets() }),
    });
  }

  /** What the filters may be set to: every action the code writes, and the kinds and methods on the trail. */
  private async facets() {
    const kinds = await this.prisma.visionAuditLog.findMany({ distinct: ["targetKind"], select: { targetKind: true }, orderBy: { targetKind: "asc" } });
    return {
      actions: [...VISION_AUDIT_ACTIONS],
      targetKinds: kinds.map((k) => k.targetKind),
      methods: [...AUDIT_METHODS],
    };
  }
}
