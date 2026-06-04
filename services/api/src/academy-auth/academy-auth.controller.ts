import { Body, Controller, Get, Inject, Post, Req, UseGuards } from "@nestjs/common";
import type { AcademyJwtPayload } from "./academy-auth.service";
import { AcademyLoginDto } from "./dto/academy-login.dto";
import { AcademyAuthGuard } from "./guards/academy-auth.guard";
import { AcademyAuthService } from "./academy-auth.service";

@Controller("academy")
export class AcademyAuthController {
  constructor(
    @Inject(AcademyAuthService) private readonly academyAuth: AcademyAuthService
  ) {}

  @Post("auth/login")
  login(@Body() dto: AcademyLoginDto) {
    return this.academyAuth.login(dto.username, dto.password);
  }

  @Get("auth/session")
  @UseGuards(AcademyAuthGuard)
  session(@Req() req: { academyAuth: AcademyJwtPayload }) {
    return this.academyAuth.sessionForPayload(req.academyAuth);
  }

  @Get("directory")
  @UseGuards(AcademyAuthGuard)
  directory() {
    return this.academyAuth.directory();
  }
}
