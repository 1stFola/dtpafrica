import { Controller, Get } from "@nestjs/common";

@Controller()
export class HealthController {
  @Get()
  root() {
    return {
      service: "@dtp/api",
      status: "ok",
      health: "/api/v1/health",
      modules: ["home", "admin", "scouting", "scoreboard", "mvce", "benchmarks"],
    };
  }

  @Get("health")
  health() {
    return { status: "ok", service: "@dtp/api", phase: "sip-1" };
  }
}
