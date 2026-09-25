import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { WorkerTokenService, type WorkerIdentity } from "./worker-token.service";

export type WorkerRequest = {
  headers: Record<string, string | string[] | undefined>;
  workerAuth?: WorkerIdentity;
};

/**
 * Authenticates a worker, and nothing else.
 *
 * Deliberately unrelated to AdminAuthGuard. A worker token must never reach an
 * admin endpoint and an admin session must never complete a job: two guards, no
 * shared code path, and a test asserting cross-use is refused.
 *
 * Reads `x-vision-worker-token` rather than `Authorization`, so a proxy or client
 * that helpfully forwards an admin bearer token cannot accidentally satisfy this.
 */
@Injectable()
export class VisionWorkerGuard implements CanActivate {
  constructor(@Inject(WorkerTokenService) private readonly tokens: WorkerTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<WorkerRequest>();
    const header = req.headers["x-vision-worker-token"];
    const token = typeof header === "string" ? header.trim() : null;

    if (!token) throw new UnauthorizedException("Worker token required");

    req.workerAuth = await this.tokens.verify(token);
    return true;
  }
}

/**
 * Guards `register` only, where the caller holds a bootstrap token and does not
 * yet have a worker identity.
 */
@Injectable()
export class VisionWorkerBootstrapGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<WorkerRequest>();
    const header = req.headers["x-vision-bootstrap-token"];
    if (typeof header !== "string" || !header.trim()) {
      throw new UnauthorizedException("Bootstrap token required");
    }
    return true;
  }
}
