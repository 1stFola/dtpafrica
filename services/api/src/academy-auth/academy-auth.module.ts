import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AcademyAuthController } from "./academy-auth.controller";
import { AcademyAuthService } from "./academy-auth.service";
import { AcademyAuthGuard } from "./guards/academy-auth.guard";
import { academyJwtSecret } from "./academy-auth.util";

@Module({
  imports: [
    JwtModule.register({
      secret: academyJwtSecret(),
      signOptions: { expiresIn: "7d" },
    }),
  ],
  controllers: [AcademyAuthController],
  providers: [AcademyAuthService, AcademyAuthGuard],
  exports: [AcademyAuthService, AcademyAuthGuard, JwtModule],
})
export class AcademyAuthModule {}
