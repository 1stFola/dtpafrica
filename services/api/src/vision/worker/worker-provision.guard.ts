import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { AdminAuthGuard } from "../../admin/guards/admin-auth.guard";
import { PermissionsGuard } from "../../admin/guards/permissions.guard";
import { refusal } from "../shared/refusals";
import { PROVISION_KEY_HEADER, isProvisionKey } from "./provision-key";

export type ProvisionRequest = {
  headers: Record<string, string | string[] | undefined>;
  /** Set when the caller presented the provision key, not an admin session. */
  provisionKey?: boolean;
};

/**
 * The door to provisioning and retiring a worker: an admin with
 * `vision.jobs.run`, or the provision key.
 *
 * A request that presents the provision key header is judged on that key alone.
 * A wrong one is refused there and never falls through to the admin check, so
 * the header cannot be used to probe for anything else. A request without the
 * header goes through the ordinary admin guards, unchanged.
 *
 * The key opens the door; what it may do past it is the controller's to limit.
 */
@Injectable()
export class WorkerProvisionGuard implements CanActivate {
  constructor(
    @Inject(AdminAuthGuard) private readonly admin: AdminAuthGuard,
    @Inject(PermissionsGuard) private readonly permissions: PermissionsGuard
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ProvisionRequest>();
    const header = req.headers[PROVISION_KEY_HEADER];
    if (header !== undefined) {
      if (typeof header !== "string" || !isProvisionKey(header, process.env.ADMIN_API_KEY)) {
        throw refusal(401, "ProvisionKeyInvalid", "Invalid provision key", "Send the provision key the deploy derived for this server, or sign in as an admin with vision.jobs.run.");
      }
      req.provisionKey = true;
      return true;
    }
    if (!(await this.admin.canActivate(context))) return false;
    return this.permissions.canActivate(context);
  }
}
