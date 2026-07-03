import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AdminAuthService } from "../admin/auth/admin-auth.service";
import { adminJwtSecret } from "../admin/auth/admin-auth.util";
import { AdminAuthGuard } from "../admin/guards/admin-auth.guard";
import { PermissionsGuard } from "../admin/guards/permissions.guard";
import { PlayerStatsController } from "./player-stats.controller";

@Module({
  imports: [
    JwtModule.register({
      secret: adminJwtSecret(),
      signOptions: { expiresIn: "7d" },
    }),
  ],
  controllers: [PlayerStatsController],
  providers: [AdminAuthService, AdminAuthGuard, PermissionsGuard],
})
export class PlayerStatsModule {}
