import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";

@Injectable()
export class AdminApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    const header = req.headers["x-admin-api-key"];
    const expected = process.env.ADMIN_API_KEY;
    if (!expected) {
      throw new UnauthorizedException(
        "ADMIN_API_KEY is not configured on the server"
      );
    }
    if (!header || header !== expected) {
      throw new UnauthorizedException("Invalid admin API key");
    }
    return true;
  }
}
