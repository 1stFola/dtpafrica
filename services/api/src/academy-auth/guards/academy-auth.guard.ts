import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { AcademyAuthService, type AcademyJwtPayload } from "../academy-auth.service";

@Injectable()
export class AcademyAuthGuard implements CanActivate {
  constructor(
    @Inject(AcademyAuthService) private readonly academyAuth: AcademyAuthService
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      academyAuth?: AcademyJwtPayload;
    }>();
    const header = req.headers.authorization;
    const token =
      (typeof header === "string" && header.startsWith("Bearer ")
        ? header.slice(7)
        : null) ||
      (typeof req.headers["x-academy-token"] === "string"
        ? req.headers["x-academy-token"]
        : null);

    if (!token?.trim()) {
      throw new UnauthorizedException("Academy authentication required");
    }

    try {
      req.academyAuth = this.academyAuth.verifyToken(token.trim());
      return true;
    } catch {
      throw new UnauthorizedException("Invalid or expired academy session");
    }
  }
}
