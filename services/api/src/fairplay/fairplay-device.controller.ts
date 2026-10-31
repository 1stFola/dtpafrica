import { Body, Controller, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { jsonSafe } from "../vision/shared/json-safe";
import { FairPlayBootstrapGuard, FairPlayDeviceGuard, type DeviceRequest } from "./device.guard";
import { FairPlayDevicesService, type DeviceIdentity } from "./devices.service";
import { FairPlayEvidenceService } from "./evidence.service";
import { FairPlayRequestsService } from "./requests.service";
import { FairPlaySessionsService } from "./sessions.service";
import { FairPlaySyncService } from "./sync.service";

/**
 * FairPlay for Edge devices: `/api/v1/fairplay/device/...` and the sync batch. Device-token
 * guarded, never admin-guarded (device.guard.ts). A device acts only on the sessions the
 * cloud assigned to it; the services check that on every item and object.
 */
@Controller("fairplay")
export class FairPlayDeviceController {
  constructor(
    @Inject(FairPlayDevicesService) private readonly devices: FairPlayDevicesService,
    @Inject(FairPlaySessionsService) private readonly sessions: FairPlaySessionsService,
    @Inject(FairPlaySyncService) private readonly sync: FairPlaySyncService,
    @Inject(FairPlayEvidenceService) private readonly evidence: FairPlayEvidenceService,
    @Inject(FairPlayRequestsService) private readonly requests: FairPlayRequestsService
  ) {}

  @Post("device/register")
  @HttpCode(200)
  @UseGuards(FairPlayBootstrapGuard)
  register(@Headers("x-fairplay-bootstrap-token") token: string, @Body() body: { edgeDeviceId?: string }) {
    return this.devices.register(token, String(body?.edgeDeviceId ?? ""));
  }

  @Get("device/bundle")
  @UseGuards(FairPlayDeviceGuard)
  bundle(@Req() req: DeviceRequest, @Query("have") have?: string, @Query("expires") expires?: string) {
    return this.sessions.bundleFor(device(req), { contentHash: have, expiresAt: expires });
  }

  @Post("sync/batch")
  @HttpCode(200)
  @UseGuards(FairPlayDeviceGuard)
  batch(@Req() req: DeviceRequest, @Body() body: { deviceId?: unknown; items?: unknown }) {
    return this.sync.receive(device(req), body ?? {});
  }

  @Post("device/evidence/:id/uploads")
  @HttpCode(200)
  @UseGuards(FairPlayDeviceGuard)
  async presign(@Req() req: DeviceRequest, @Param("id", ParseUUIDPipe) id: string, @Body() body: { kind?: unknown; bytes?: unknown; sha256?: unknown }) {
    return jsonSafe(await this.evidence.presign(device(req), id, body ?? {}));
  }

  /** Clips withdrawn on request that this Edge still holds: it removes each, then syncs the withdrawal back. */
  @Get("device/withdrawals")
  @UseGuards(FairPlayDeviceGuard)
  withdrawals(@Req() req: DeviceRequest) {
    return this.requests.pendingFor(device(req));
  }

  @Post("device/evidence/:id/uploads/:kind/confirm")
  @HttpCode(200)
  @UseGuards(FairPlayDeviceGuard)
  async confirm(@Req() req: DeviceRequest, @Param("id", ParseUUIDPipe) id: string, @Param("kind") kind: string) {
    return jsonSafe(await this.evidence.confirm(device(req), id, kind));
  }
}

function device(req: DeviceRequest): DeviceIdentity {
  // The guard ran, so this is set; a route without the guard would fail here, loudly.
  if (!req.fairplayDevice) throw new Error("FairPlayDeviceGuard did not run");
  return req.fairplayDevice;
}
