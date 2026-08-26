import {
  adminApi,
  type AdminPermission,
  type AdminRole,
  type AdminSession,
  type AdminUser,
} from "../../../api/admin";

export type { AdminPermission, AdminRole, AdminSession, AdminUser };

export const adminRbacApi = {
  listPermissions: () => adminApi.rbacPermissions(),
  listRoles: () => adminApi.rbacRoles(),
  getRole: (slug: string) => adminApi.rbacRole(slug),
  updateRolePermissions: (slug: string, permissions: string[]) =>
    adminApi.rbacUpdateRolePermissions(slug, permissions),
  listUsers: () => adminApi.rbacUsers(),
  createUser: (body: {
    email: string;
    name?: string;
    password?: string;
    roleSlug: string;
    competitionIds?: string[];
    allCompetitions?: boolean;
  }) => adminApi.rbacCreateUser(body),
  deleteUser: (id: string) => adminApi.rbacDeleteUser(id),
  resetPassword: (id: string, password?: string) => adminApi.rbacResetPassword(id, password),
  suggestPassword: () => adminApi.rbacSuggestPassword(),
  updateUser: (
    id: string,
    body: {
      email?: string;
      name?: string;
      password?: string;
      roleSlug?: string;
      isActive?: boolean;
      competitionIds?: string[];
      allCompetitions?: boolean;
    }
  ) => adminApi.rbacUpdateUser(id, body),
};
