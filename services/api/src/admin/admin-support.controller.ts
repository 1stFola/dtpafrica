import { Body, Controller, Get, Inject, Param, Patch, Query, UseGuards } from "@nestjs/common";
import { RequirePermissions } from "./decorators/require-permissions.decorator";
import { AdminAuthGuard } from "./guards/admin-auth.guard";
import { PermissionsGuard } from "./guards/permissions.guard";
import { UpdateSupportReportDto } from "../support/dto/update-support-report.dto";
import { SupportService } from "../support/support.service";

@Controller("admin/support")
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminSupportController {
  constructor(@Inject(SupportService) private readonly support: SupportService) {}

  @Get("diagnostics")
  @RequirePermissions("ops.support.read")
  diagnostics() {
    return this.support.diagnostics();
  }

  @Get("summary")
  @RequirePermissions("ops.support.read")
  summary() {
    return this.support.summary();
  }

  @Get("playbook")
  @RequirePermissions("ops.support.read")
  playbook() {
    return this.support.playbook();
  }

  @Get("review")
  @RequirePermissions("ops.support.read")
  reviewQueue() {
    return this.support.reviewQueue();
  }

  @Get("reports")
  @RequirePermissions("ops.support.read")
  reports(
    @Query("status") status?: string,
    @Query("category") category?: string,
    @Query("q") q?: string,
    @Query("limit") limit?: string
  ) {
    return this.support.listReports({
      status,
      category,
      q,
      limit: limit != null ? Number(limit) : undefined,
    });
  }

  @Get("reports/:id/triage")
  @RequirePermissions("ops.support.read")
  triageReport(@Param("id") id: string) {
    return this.support.triageReport(id);
  }

  @Patch("reports/:id")
  @RequirePermissions("ops.support.write")
  updateReport(@Param("id") id: string, @Body() dto: UpdateSupportReportDto) {
    return this.support.updateReport(id, dto);
  }
}
