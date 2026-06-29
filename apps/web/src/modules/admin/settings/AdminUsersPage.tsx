import { FormEvent, useEffect, useState } from "react";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useAdminToast } from "../components/AdminToast";
import { AdminPageHeader } from "../components/AdminPageHeader";
import { adminRbacApi, type AdminRole, type AdminUser } from "./admin-rbac-api";

export function AdminUsersPage() {
  usePageTitle("Admin users");
  const toast = useAdminToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    email: "",
    name: "",
    password: "",
    roleSlug: "read_only",
  });

  const load = () =>
    Promise.all([adminRbacApi.listUsers(), adminRbacApi.listRoles()])
      .then(([userRows, roleRows]) => {
        setUsers(userRows);
        setRoles(roleRows);
      })
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : "Failed to load users");
      });

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const created = await adminRbacApi.createUser({
        email: form.email,
        name: form.name || undefined,
        password: form.password,
        roleSlug: form.roleSlug,
      });
      setUsers((prev) => [...prev, created]);
      setForm({ email: "", name: "", password: "", roleSlug: form.roleSlug });
      toast.success(`Created ${created.email}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (user: AdminUser) => {
    try {
      const updated = await adminRbacApi.updateUser(user.id, {
        isActive: !user.isActive,
      });
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      toast.success(updated.isActive ? "User activated" : "User deactivated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    }
  };

  const changeRole = async (user: AdminUser, roleSlug: string) => {
    try {
      const updated = await adminRbacApi.updateUser(user.id, { roleSlug });
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      toast.success("Role updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    }
  };

  if (loading) {
    return <p className="muted admin-loading">Loading users…</p>;
  }

  return (
    <section className="admin-page admin-sb-section">
      <AdminPageHeader
        title="Admin users"
        description="Email/password accounts with role-based permissions. Legacy API key login remains available for full access."
        crumbs={[{ label: "Settings" }, { label: "Users" }]}
      />

      <div className="admin-rbac-users-grid">
        <div className="admin-sb-panel">
          <h2 className="admin-sb-panel__title">Create user</h2>
          <form className="admin-rbac-user-form" onSubmit={(e) => void handleCreate(e)}>
            <label className="admin-sb-field">
              <span>Email</span>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </label>
            <label className="admin-sb-field">
              <span>Name</span>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </label>
            <label className="admin-sb-field">
              <span>Password</span>
              <input
                type="password"
                required
                minLength={8}
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              />
            </label>
            <label className="admin-sb-field">
              <span>Role</span>
              <select
                value={form.roleSlug}
                onChange={(e) => setForm((f) => ({ ...f, roleSlug: e.target.value }))}
              >
                {roles.map((role) => (
                  <option key={role.slug} value={role.slug}>
                    {role.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn btn-primary" disabled={creating}>
              {creating ? "Creating…" : "Create user"}
            </button>
          </form>
        </div>

        <div className="admin-sb-panel admin-rbac-users-table-wrap">
          <h2 className="admin-sb-panel__title">Users ({users.length})</h2>
          {users.length === 0 ? (
            <p className="muted">
              No admin users yet. API key login still works. Create a user to use
              email/password with limited roles.
            </p>
          ) : (
            <table className="admin-rbac-users-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.email}</td>
                    <td>{user.name || "—"}</td>
                    <td>
                      <select
                        value={user.roleSlug ?? ""}
                        onChange={(e) => void changeRole(user, e.target.value)}
                      >
                        {roles.map((role) => (
                          <option key={role.slug} value={role.slug}>
                            {role.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <span
                        className={
                          user.isActive ? "admin-rbac-status active" : "admin-rbac-status"
                        }
                      >
                        {user.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => void toggleActive(user)}
                      >
                        {user.isActive ? "Deactivate" : "Activate"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}
