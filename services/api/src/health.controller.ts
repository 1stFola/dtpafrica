import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "./prisma/prisma.service";

// Long enough for a busy t3.small, short enough that an uptime check with a 30s
// timeout sees a 503 rather than a hang when Postgres is wedged.
export const READY_DB_TIMEOUT_MS = 3000;

@Controller()
export class HealthController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  root() {
    return {
      service: "@dtp/api",
      status: "ok",
      health: "/api/v1/health",
      modules: ["home", "admin", "scouting", "scoreboard", "mvce", "benchmarks"],
    };
  }

  // Liveness: the process answers. No database, so the deploy's smoke test and a
  // restart loop are never decided by Postgres being slow.
  @Get("health")
  health() {
    return { status: "ok", service: "@dtp/api", phase: "sip-1" };
  }

  // Readiness: the process answers and can reach Postgres. This is what the external
  // uptime check watches (docs/support-playbook/database-backup-and-restore.md).
  @Get("health/ready")
  async ready() {
    const started = Date.now();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("timeout")), READY_DB_TIMEOUT_MS);
        }),
      ]);
    } catch {
      throw new ServiceUnavailableException({ status: "unavailable", service: "@dtp/api", db: "down" });
    } finally {
      clearTimeout(timer);
    }
    return { status: "ok", service: "@dtp/api", db: "ok", dbLatencyMs: Date.now() - started };
  }
}
