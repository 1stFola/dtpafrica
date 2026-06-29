import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { AdminAuthService } from "../auth/admin-auth.service";

/**
 * Hybrid admin auth: legacy API key (= super_admin) OR Bearer admin JWT.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    @Inject(AdminAuthService) private readonly adminAuth: AdminAuthService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      adminAuth?: Awaited<ReturnType<AdminAuthService["contextFromJwt"]>>;
    }>();

    const apiKeyHeader = req.headers["x-admin-api-key"];
    const apiKey =
      typeof apiKeyHeader === "string" ? apiKeyHeader.trim() : null;
    const expected = process.env.ADMIN_API_KEY?.trim();

    if (apiKey && expected && apiKey === expected) {
      req.adminAuth = this.adminAuth.apiKeyContext();
      return true;
    }

    const authHeader = req.headers.authorization;
    const bearer =
      typeof authHeader === "string" && authHeader.startsWith("Bearer ")
        ? authHeader.slice(7).trim()
        : null;
    const adminToken =
      bearer ||
      (typeof req.headers["x-admin-token"] === "string"
        ? req.headers["x-admin-token"].trim()
        : null);

    if (adminToken) {
      try {
        req.adminAuth = await this.adminAuth.sessionFromToken(adminToken);
        return true;
      } catch {
        throw new UnauthorizedException("Invalid or expired admin session");
      }
    }

    if (apiKey && !expected) {
      throw new UnauthorizedException(
        "ADMIN_API_KEY is not configured on the server"
      );
    }

    throw new UnauthorizedException("Invalid admin credentials");
  }
}
