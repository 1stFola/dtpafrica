import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { refusal } from "../vision/shared/refusals";
import { FairPlayDevicesService, type DeviceIdentity } from "./devices.service";

export type DeviceRequest = {
  headers: Record<string, string | string[] | undefined>;
  fairplayDevice?: DeviceIdentity;
};

/**
 * Authenticates an Edge device, and nothing else. Unrelated to AdminAuthGuard: a device
 * token never reaches an admin route, and an admin session never syncs. Reads its own
 * header, so a proxy that forwards an admin bearer cannot satisfy it by accident.
 */
@Injectable()
export class FairPlayDeviceGuard implements CanActivate {
  constructor(@Inject(FairPlayDevicesService) private readonly devices: FairPlayDevicesService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<DeviceRequest>();
    const header = req.headers["x-fairplay-device-token"];
    const token = typeof header === "string" ? header.trim() : "";
    if (!token) throw refusal(401, "DeviceTokenRequired", "Device token required", "Send it in the x-fairplay-device-token header.");
    req.fairplayDevice = await this.devices.verify(token);
    return true;
  }
}

/** `register` only: the caller holds a bootstrap token and has no device identity yet. */
@Injectable()
export class FairPlayBootstrapGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const header = context.switchToHttp().getRequest<DeviceRequest>().headers["x-fairplay-bootstrap-token"];
    if (typeof header !== "string" || !header.trim()) {
      throw refusal(401, "BootstrapTokenRequired", "Bootstrap token required", "Send the bootstrap token shown when the device was added.");
    }
    return true;
  }
}
