import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { hasAnyPermission } from "../auth/admin-auth.types";
import { REQUIRE_PERMISSIONS_KEY } from "../decorators/require-permissions.decorator";

@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly reflector = new Reflector();

  canActivate(context: ExecutionContext): boolean {
    const raw = this.reflector.getAllAndOverride<string | string[]>(
      REQUIRE_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()]
    );
    const required = Array.isArray(raw) ? raw : raw ? [raw] : [];
    if (!required.length) return true;

    const req = context.switchToHttp().getRequest<{
      adminAuth?: Parameters<typeof hasAnyPermission>[0];
    }>();
    const auth = req.adminAuth;
    if (!auth) {
      throw new UnauthorizedException("Admin authentication required");
    }
    if (!hasAnyPermission(auth, required)) {
      throw new ForbiddenException(
        `Missing required permission: ${required.join(" or ")}`
      );
    }
    return true;
  }
}
