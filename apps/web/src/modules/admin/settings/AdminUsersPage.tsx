import { FormEvent, useEffect, useState } from "react";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useAdminToast } from "../components/AdminToast";
import { AdminPageHeader } from "../components/AdminPageHeader";
import { adminRbacApi, type AdminRole, type AdminUser } from "./admin-rbac-api";
import { fetchCompetitions, type SbCompetition } from "../../../api/scoreboard";

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
    competitionId: "",
  });
  const [competitions, setCompetitions] = useState<SbCompetition[]>([]);

  /* Only contracted recorders are competition-scoped; every internal role sees
     all competitions, so the selector stays hidden for them. */
  const SCOPED_ROLE = "match_recorder";

  const load = () =>
    Promise.all([adminRbacApi.listUsers(), adminRbacApi.listRoles(), fetchCompetitions()])
      .then(([userRows, roleRows, competitionRows]) => {
        setUsers(userRows);
        setRoles(roleRows);
        setCompetitions(competitionRows);
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
        competitionId: form.roleSlug === SCOPED_ROLE ? form.competitionId || null : null,
      });
      setUsers((prev) => [...prev, created]);
      setForm({ email: "", name: "", password: "", roleSlug: form.roleSlug, competitionId: "" });
      toast.success(`Created ${created.email}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreating(false);
    }
  };

  const changeCompetition = async (user: AdminUser, competitionId: string) => {
    try {
      const updated = await adminRbacApi.updateUser(user.id, { competitionId });
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      toast.success(
        updated.competitionName
          ? `${updated.email} now records ${updated.competitionName}`
          : `${updated.email} is no longer competition-scoped`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
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
            {form.roleSlug === SCOPED_ROLE && (
              <label className="admin-sb-field">
                <span>Competition</span>
                <select
                  required
                  value={form.competitionId}
                  onChange={(e) => setForm((f) => ({ ...f, competitionId: e.target.value }))}
                >
                  <option value="">Select a competition…</option>
                  {competitions.map((competition) => (
                    <option key={competition.id} value={competition.id}>
                      {competition.name}
                    </option>
                  ))}
                </select>
                <small className="muted">
                  This recorder will only see fixtures from this competition.
                </small>
              </label>
            )}
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
                  <th>Competition</th>
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
                      {user.roleSlug === SCOPED_ROLE ? (
                        <select
                          value={user.competitionId ?? ""}
                          onChange={(e) => void changeCompetition(user, e.target.value)}
                        >
                          <option value="" disabled>Select a competition…</option>
                          {competitions.map((competition) => (
                            <option key={competition.id} value={competition.id}>
                              {competition.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="muted">—</span>
                      )}
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
