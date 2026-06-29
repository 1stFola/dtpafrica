import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { AdminAuthContext } from "../auth/admin-auth.types";

export const AdminAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AdminAuthContext => {
    const req = ctx.switchToHttp().getRequest<{ adminAuth: AdminAuthContext }>();
    return req.adminAuth;
  }
);
