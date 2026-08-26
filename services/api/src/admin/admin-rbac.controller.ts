import { Body, Delete, Req, Controller, Get, Inject, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { AdminRbacService } from "./admin-rbac.service";
import { RequirePermissions } from "./decorators/require-permissions.decorator";
import {
  CreateAdminUserDto,
  ResetPasswordDto,
  UpdateAdminUserDto,
  UpdateRolePermissionsDto,
} from "./dto/admin-rbac.dto";
import { AdminAuthGuard } from "./guards/admin-auth.guard";
import { PermissionsGuard } from "./guards/permissions.guard";

@Controller("admin/rbac")
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminRbacController {
  constructor(
    @Inject(AdminRbacService) private readonly rbac: AdminRbacService
  ) {}

  @Get("permissions")
  @RequirePermissions("admin.roles.manage")
  listPermissions() {
    return this.rbac.listPermissions();
  }

  @Get("roles")
  @RequirePermissions("admin.roles.manage")
  listRoles() {
    return this.rbac.listRoles();
  }

  @Get("roles/:slug")
  @RequirePermissions("admin.roles.manage")
  getRole(@Param("slug") slug: string) {
    return this.rbac.getRole(slug);
  }

  @Patch("roles/:slug/permissions")
  @RequirePermissions("admin.roles.manage")
  updateRolePermissions(
    @Param("slug") slug: string,
    @Body() dto: UpdateRolePermissionsDto
  ) {
    return this.rbac.updateRolePermissions(slug, dto.permissions);
  }

  @Get("users")
  @RequirePermissions("admin.users.manage")
  listUsers() {
    return this.rbac.listUsers();
  }

  @Post("users")
  @RequirePermissions("admin.users.manage")
  createUser(@Body() dto: CreateAdminUserDto) {
    return this.rbac.createUser(dto);
  }

  @Patch("users/:id")
  @RequirePermissions("admin.users.manage")
  updateUser(@Param("id") id: string, @Body() dto: UpdateAdminUserDto) {
    return this.rbac.updateUser(id, dto);
  }

  @Delete("users/:id")
  @RequirePermissions("admin.users.manage")
  deleteUser(@Param("id") id: string, @Req() req: { adminAuth?: { userId?: string } }) {
    return this.rbac.deleteUser(id, req.adminAuth?.userId);
  }

  /** Issues a new password and returns it once. */
  @Post("users/:id/password")
  @RequirePermissions("admin.users.manage")
  resetPassword(@Param("id") id: string, @Body() dto: ResetPasswordDto) {
    return this.rbac.resetPassword(id, dto.password);
  }

  /** A suggested password for the create form, before the account exists. */
  @Get("password-suggestion")
  @RequirePermissions("admin.users.manage")
  suggestPassword() {
    return this.rbac.suggestPassword();
  }
}
