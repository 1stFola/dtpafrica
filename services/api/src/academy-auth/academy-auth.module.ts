import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AcademyAuthController } from "./academy-auth.controller";
import { AcademyAuthService } from "./academy-auth.service";
import { AcademyAuthGuard } from "./guards/academy-auth.guard";
import { AcademyScopeGuard } from "./guards/academy-scope.guard";
import { academyJwtSecret } from "./academy-auth.util";

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({ secret: academyJwtSecret(), signOptions: { expiresIn: "7d" } }),
    }),
  ],
  controllers: [AcademyAuthController],
  providers: [AcademyAuthService, AcademyAuthGuard, AcademyScopeGuard],
  exports: [AcademyAuthService, AcademyAuthGuard, AcademyScopeGuard, JwtModule],
})
export class AcademyAuthModule {}
