import { Body, Controller, Get, Inject, Post, UseGuards } from "@nestjs/common";
import { LoginThrottle } from "../shared/throttle";
import { AdminAuthService } from "./auth/admin-auth.service";
import type { AdminAuthContext } from "./auth/admin-auth.types";
import { AdminAuth } from "./decorators/admin-auth.decorator";
import { AdminLoginDto } from "./dto/admin-rbac.dto";
import { AdminAuthGuard } from "./guards/admin-auth.guard";

@Controller("admin/auth")
export class AdminAuthController {
  constructor(
    @Inject(AdminAuthService) private readonly adminAuth: AdminAuthService
  ) {}

  @Post("login")
  @LoginThrottle()
  login(@Body() body: AdminLoginDto) {
    return this.adminAuth.login(body.email, body.password);
  }

  @Get("session")
  @UseGuards(AdminAuthGuard)
  session(@AdminAuth() auth: AdminAuthContext) {
    return { ok: true, ...auth };
  }
}
