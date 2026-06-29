import { useEffect, useMemo, useState } from "react";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useAdminToast } from "../components/AdminToast";
import { AdminPageHeader } from "../components/AdminPageHeader";
import { useAdminAuth } from "../AdminAuthContext";
import { adminRbacApi, type AdminPermission, type AdminRole } from "./admin-rbac-api";

function groupByResource(permissions: AdminPermission[]) {
  const map = new Map<string, AdminPermission[]>();
  for (const perm of permissions) {
    const list = map.get(perm.resource) ?? [];
    list.push(perm);
    map.set(perm.resource, list);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function AdminRolesPage() {
  usePageTitle("Roles & permissions");
  const toast = useAdminToast();
  const { session } = useAdminAuth();
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [permissions, setPermissions] = useState<AdminPermission[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const selectedRole = roles.find((r) => r.slug === selectedSlug) ?? null;
  const grouped = useMemo(() => groupByResource(permissions), [permissions]);
  const isSuperAdmin = selectedSlug === "super_admin";

  useEffect(() => {
    Promise.all([adminRbacApi.listRoles(), adminRbacApi.listPermissions()])
      .then(([roleRows, permRows]) => {
        setRoles(roleRows);
        setPermissions(permRows);
        if (roleRows.length > 0) {
          setSelectedSlug(roleRows[0].slug);
          setDraft(new Set(roleRows[0].permissions));
        }
      })
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : "Failed to load roles");
      })
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => {
    if (!selectedRole) return;
    setDraft(new Set(selectedRole.permissions));
  }, [selectedRole?.slug, selectedRole?.permissions]);

  const togglePermission = (slug: string) => {
    if (isSuperAdmin) return;
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const handleSave = async () => {
    if (!selectedSlug || isSuperAdmin) return;
    setSaving(true);
    try {
      const updated = await adminRbacApi.updateRolePermissions(
        selectedSlug,
        [...draft].sort()
      );
      setRoles((prev) => prev.map((r) => (r.slug === updated.slug ? updated : r)));
      toast.success(`Saved permissions for ${updated.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="muted admin-loading">Loading roles…</p>;
  }

  return (
    <section className="admin-page admin-sb-section">
      <AdminPageHeader
        title="Roles & permissions"
        description="Assign capability bundles to admin users. API key login retains full super-admin access."
        crumbs={[{ label: "Settings" }, { label: "Roles" }]}
        actions={
          session?.roleName ? (
            <span className="admin-rbac-session-badge muted">
              Signed in as {session.roleName}
            </span>
          ) : null
        }
      />

      <div className="admin-rbac-layout">
        <aside className="admin-rbac-roles admin-sb-panel">
          <h2 className="admin-sb-panel__title">Roles</h2>
          <ul className="admin-rbac-role-list">
            {roles.map((role) => (
              <li key={role.slug}>
                <button
                  type="button"
                  className={
                    selectedSlug === role.slug
                      ? "admin-rbac-role-btn active"
                      : "admin-rbac-role-btn"
                  }
                  onClick={() => setSelectedSlug(role.slug)}
                >
                  <span className="admin-rbac-role-btn__name">{role.name}</span>
                  <span className="admin-rbac-role-btn__meta muted">
                    {role.permissions.length} permissions · {role.userCount} users
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div className="admin-rbac-editor admin-sb-panel">
          {selectedRole ? (
            <>
              <div className="admin-rbac-editor__header">
                <div>
                  <h2 className="admin-sb-panel__title">{selectedRole.name}</h2>
                  <p className="muted admin-sb-panel__lead">
                    {selectedRole.description || `Slug: ${selectedRole.slug}`}
                  </p>
                </div>
                {!isSuperAdmin && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={saving}
                    onClick={() => void handleSave()}
                  >
                    {saving ? "Saving…" : "Save permissions"}
                  </button>
                )}
              </div>

              {isSuperAdmin && (
                <p className="admin-rbac-note muted">
                  Super Admin always has all permissions. Use API key login or assign
                  other roles to limit access.
                </p>
              )}

              <div className="admin-rbac-perm-groups">
                {grouped.map(([resource, perms]) => (
                  <fieldset key={resource} className="admin-rbac-perm-group" disabled={isSuperAdmin}>
                    <legend>{resource}</legend>
                    <ul className="admin-rbac-perm-list">
                      {perms.map((perm) => (
                        <li key={perm.slug}>
                          <label className="admin-sb-field admin-sb-field--checkbox">
                            <input
                              type="checkbox"
                              checked={isSuperAdmin || draft.has(perm.slug)}
                              onChange={() => togglePermission(perm.slug)}
                            />
                            <span>
                              <code>{perm.slug}</code>
                              <span className="muted"> — {perm.description}</span>
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </fieldset>
                ))}
              </div>
            </>
          ) : (
            <p className="muted">Select a role to edit permissions.</p>
          )}
        </div>
      </div>
    </section>
  );
}
