import { Body, Controller, Inject, Param, Post } from "@nestjs/common";
import { IngestMatchMetricsDto } from "./dto/ingest-match-metrics.dto";
import { MetricsService } from "./metrics.service";

@Controller("sip/players")
export class MetricsController {
  constructor(@Inject(MetricsService) private readonly metrics: MetricsService) {}

  @Post(":playerId/match-metrics")
  ingest(@Param("playerId") playerId: string, @Body() dto: IngestMatchMetricsDto) {
    return this.metrics.ingest(playerId, dto);
  }
}
