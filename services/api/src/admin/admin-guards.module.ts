import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AdminAuthService } from "./auth/admin-auth.service";
import { adminJwtSecret } from "./auth/admin-auth.util";
import { AdminAuthGuard } from "./guards/admin-auth.guard";
import { PermissionsGuard } from "./guards/permissions.guard";

/**
 * What a module outside admin needs to put a route behind `AdminAuthGuard` and
 * `PermissionsGuard`: the auth service the guard calls, and the JWT setup it verifies with.
 *
 * Import it, then `@UseGuards(AdminAuthGuard, PermissionsGuard)` and `@RequirePermissions(...)`
 * on the handler, as the admin controllers do.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({ secret: adminJwtSecret(), signOptions: { expiresIn: "7d" } }),
    }),
  ],
  providers: [AdminAuthService, AdminAuthGuard, PermissionsGuard],
  exports: [AdminAuthService, AdminAuthGuard, PermissionsGuard],
})
export class AdminGuardsModule {}
