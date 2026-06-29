import { Body, Controller, Get, Inject, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { AdminRbacService } from "./admin-rbac.service";
import { RequirePermissions } from "./decorators/require-permissions.decorator";
import {
  CreateAdminUserDto,
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
}
