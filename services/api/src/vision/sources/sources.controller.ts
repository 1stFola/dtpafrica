import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import { AdminAuth } from "../../admin/decorators/admin-auth.decorator";
import { RequirePermissions } from "../../admin/decorators/require-permissions.decorator";
import { AdminAuthGuard } from "../../admin/guards/admin-auth.guard";
import { PermissionsGuard } from "../../admin/guards/permissions.guard";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";
import { jsonSafe } from "../shared/json-safe";
import {
  AddSignatoryDto,
  AuthorizeAcquisitionDto,
  BeginEvidenceUploadDto,
  CreatePartnerDto,
  CreateSourceDto,
  GrantScopeDto,
  ImportSourcesDto,
  IssueUploadGrantDto,
  ReasonDto,
} from "./dto/sources.dto";
import { VisionSourcesService } from "./sources.service";

/**
 * The Partner Video Catalog.
 *
 * Permissions are split on purpose: `vision.sources.write` catalogues, and
 * `vision.rights.manage` grants, revokes and authorises. Someone entering a
 * spreadsheet of match URLs should not thereby be able to authorise an
 * acquisition.
 */
@Controller("vision")
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class VisionSourcesController {
  constructor(@Inject(VisionSourcesService) private readonly sources: VisionSourcesService) {}

  // ── Partners ─────────────────────────────────────────────────────────────

  @Get("partners")
  @RequirePermissions("vision.read")
  async listPartners() {
    return jsonSafe(await this.sources.listPartners());
  }

  @Post("partners")
  @RequirePermissions("vision.sources.write")
  createPartner(@Body() dto: CreatePartnerDto, @AdminAuth() auth: AdminAuthContext) {
    return this.sources.createPartner(dto, auth);
  }

  @Post("partners/:id/signatories")
  @RequirePermissions("vision.rights.manage")
  addSignatory(
    @Param("id") id: string,
    @Body() dto: AddSignatoryDto,
    @AdminAuth() auth: AdminAuthContext
  ) {
    return this.sources.addSignatory(id, dto, auth);
  }

  // ── Rights evidence ──────────────────────────────────────────────────────

  @Get("partners/:id/evidence")
  @RequirePermissions("vision.read")
  listEvidence(@Param("id") id: string) {
    return this.sources.listEvidence(id);
  }

  /** Returns a signed URL; the document goes straight to storage, not through here. */
  @Post("partners/:id/evidence")
  @RequirePermissions("vision.rights.manage")
  beginEvidenceUpload(
    @Param("id") id: string,
    @Body() dto: BeginEvidenceUploadDto,
    @AdminAuth() auth: AdminAuthContext
  ) {
    return this.sources.beginEvidenceUpload(id, dto, auth);
  }

  // ── Rights scopes ────────────────────────────────────────────────────────

  @Post("rights/scopes")
  @RequirePermissions("vision.rights.manage")
  grantScope(@Body() dto: GrantScopeDto, @AdminAuth() auth: AdminAuthContext) {
    return this.sources.grantScope(dto, auth);
  }

  /** Immediate: every future rights check fails from this moment. */
  @Post("rights/scopes/:id/revoke")
  @RequirePermissions("vision.rights.manage")
  revokeScope(
    @Param("id") id: string,
    @Body() dto: ReasonDto,
    @AdminAuth() auth: AdminAuthContext
  ) {
    return this.sources.revokeScope(id, dto.reason, auth);
  }

  // ── Sources ──────────────────────────────────────────────────────────────

  @Get("sources")
  @RequirePermissions("vision.read")
  async listSources(
    @Query("partnerId") partnerId?: string,
    @Query("acquisitionStatus") acquisitionStatus?: string,
    @Query("sbCompetitionId") sbCompetitionId?: string,
    @Query("q") q?: string
  ) {
    return jsonSafe(
      await this.sources.listSources({ partnerId, acquisitionStatus, sbCompetitionId, q })
    );
  }

  @Post("sources")
  @RequirePermissions("vision.sources.write")
  createSource(@Body() dto: CreateSourceDto, @AdminAuth() auth: AdminAuthContext) {
    return this.sources.createSource(dto, auth);
  }

  /** Metadata only. Fetches nothing: a URL is a reference, not a file. */
  @Post("sources/import")
  @RequirePermissions("vision.sources.write")
  importSources(@Body() dto: ImportSourcesDto, @AdminAuth() auth: AdminAuthContext) {
    return this.sources.importSources(dto.partnerId, dto.rows, auth);
  }

  @Get("sources/:id")
  @RequirePermissions("vision.read")
  async getSource(@Param("id") id: string) {
    return jsonSafe(await this.sources.getSource(id));
  }

  /** "What breaks if I revoke this?" — answered before acting, not after. */
  @Get("sources/:id/impact")
  @RequirePermissions("vision.read")
  async impact(@Param("id") id: string) {
    return jsonSafe(await this.sources.impact(id));
  }

  @Post("sources/:id/authorize-acquisition")
  @RequirePermissions("vision.rights.manage")
  authorizeAcquisition(
    @Param("id") id: string,
    @Body() dto: AuthorizeAcquisitionDto,
    @AdminAuth() auth: AdminAuthContext
  ) {
    return this.sources.authorizeAcquisition(id, dto, auth);
  }

  @Post("sources/:id/refuse-acquisition")
  @RequirePermissions("vision.rights.manage")
  refuseAcquisition(
    @Param("id") id: string,
    @Body() dto: ReasonDto,
    @AdminAuth() auth: AdminAuthContext
  ) {
    return this.sources.refuseAcquisition(id, dto.reason, auth);
  }

  // ── Partner upload grants ────────────────────────────────────────────────

  /** The token is returned exactly once. Only its hash is stored. */
  @Post("sources/:id/upload-grant")
  @RequirePermissions("vision.rights.manage")
  issueUploadGrant(
    @Param("id") id: string,
    @Body() dto: IssueUploadGrantDto,
    @AdminAuth() auth: AdminAuthContext
  ) {
    return this.sources.issueUploadGrant(id, dto, auth);
  }

  @Post("upload-grants/:id/revoke")
  @RequirePermissions("vision.rights.manage")
  revokeUploadGrant(@Param("id") id: string, @AdminAuth() auth: AdminAuthContext) {
    return this.sources.revokeUploadGrant(id, auth);
  }
}
