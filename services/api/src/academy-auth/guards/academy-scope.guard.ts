import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { AcademyJwtPayload } from "../academy-auth.service";

/**
 * Ensures :slug route param matches the authenticated academy JWT.
 * Apply after AcademyAuthGuard.
 */
@Injectable()
export class AcademyScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      params: { slug?: string };
      academyAuth?: AcademyJwtPayload;
    }>();
    const slug = req.params.slug?.trim();
    if (!slug) return true;

    const payload = req.academyAuth;
    if (!payload?.slug) {
      throw new UnauthorizedException("Academy authentication required");
    }
    if (payload.slug !== slug) {
      throw new ForbiddenException("You can only access your own academy portal");
    }
    return true;
  }
}
