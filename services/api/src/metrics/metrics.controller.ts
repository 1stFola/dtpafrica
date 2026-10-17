import { Body, Controller, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { RequirePermissions } from "../admin/decorators/require-permissions.decorator";
import { AdminAuthGuard } from "../admin/guards/admin-auth.guard";
import { PermissionsGuard } from "../admin/guards/permissions.guard";
import { IngestMatchMetricsDto } from "./dto/ingest-match-metrics.dto";
import { MetricsService } from "./metrics.service";

@Controller("sip/players")
export class MetricsController {
  constructor(@Inject(MetricsService) private readonly metrics: MetricsService) {}

  @Post(":playerId/match-metrics")
  @UseGuards(AdminAuthGuard, PermissionsGuard)
  @RequirePermissions("players.write")
  ingest(@Param("playerId") playerId: string, @Body() dto: IngestMatchMetricsDto) {
    return this.metrics.ingest(playerId, dto);
  }
}
