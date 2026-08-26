import { FormEvent, useEffect, useMemo, useState } from "react";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useAdminToast } from "../components/AdminToast";
import { AdminPageHeader } from "../components/AdminPageHeader";
import { adminRbacApi, type AdminRole, type AdminUser } from "./admin-rbac-api";
import { fetchCompetitions, type SbCompetition } from "../../../api/scoreboard";

/** Contracted roles are competition-scoped and grouped away from staff. */
const RECORDER_ROLES = new Set(["match_recorder"]);
const SCOPED_ROLE = "match_recorder";

type Tab = "staff" | "recorders";

/**
 * A password shown exactly once.
 *
 * Passwords are stored as bcrypt hashes and cannot be read back — that is the
 * point of hashing them. So the plaintext is surfaced only at the moment it is
 * issued, with a copy button, and never again. If it is lost, issue another.
 */
function PasswordReveal({
  email,
  password,
  onDismiss,
}: {
  email: string;
  password: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* Clipboard can be blocked; the value is on screen to copy by hand. */
    }
  };

  return (
    <div className="aup-reveal" role="alert">
      <div className="aup-reveal__head">
        <strong>Password for {email}</strong>
        <button type="button" className="aup-reveal__close" onClick={onDismiss} aria-label="Dismiss">
          ✕
        </button>
      </div>
      <code className="aup-reveal__value">{password}</code>
      <div className="aup-reveal__actions">
        <button type="button" className="btn" onClick={copy}>
          {copied ? "Copied" : "Copy password"}
        </button>
      </div>
      <p className="aup-reveal__warn">
        Shown once. It is stored only as a hash and cannot be retrieved later — copy it now, or
        issue a new one.
      </p>
    </div>
  );
}

export function AdminUsersPage() {
  usePageTitle("Admin users");
  const toast = useAdminToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [competitions, setCompetitions] = useState<SbCompetition[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<Tab>("staff");
  const [search, setSearch] = useState("");
  const [revealed, setRevealed] = useState<{ email: string; password: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ name: string; email: string }>({
    name: "",
    email: "",
  });

  const [form, setForm] = useState({
    email: "",
    name: "",
    password: "",
    roleSlug: "read_only",
    competitionIds: [] as string[],
    allCompetitions: false,
  });

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

  const staffRoles = useMemo(() => roles.filter((r) => !RECORDER_ROLES.has(r.slug)), [roles]);
  const recorderRoles = useMemo(() => roles.filter((r) => RECORDER_ROLES.has(r.slug)), [roles]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const inTab = users.filter((u) =>
      tab === "recorders"
        ? RECORDER_ROLES.has(u.roleSlug ?? "")
        : !RECORDER_ROLES.has(u.roleSlug ?? "")
    );
    if (!q) return inTab;
    return inTab.filter((u) =>
      [u.email, u.name, u.roleName, ...(u.competitionNames ?? [])]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [users, tab, search]);

  const counts = useMemo(
    () => ({
      staff: users.filter((u) => !RECORDER_ROLES.has(u.roleSlug ?? "")).length,
      recorders: users.filter((u) => RECORDER_ROLES.has(u.roleSlug ?? "")).length,
    }),
    [users]
  );

  const generate = async () => {
    try {
      const { password } = await adminRbacApi.suggestPassword();
      setForm((f) => ({ ...f, password }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not generate a password");
    }
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const created = await adminRbacApi.createUser({
        email: form.email,
        name: form.name || undefined,
        // Omitted entirely when blank, so the server generates one.
        password: form.password.trim() || undefined,
        roleSlug: form.roleSlug,
        ...(form.roleSlug === SCOPED_ROLE
          ? { competitionIds: form.competitionIds, allCompetitions: form.allCompetitions }
          : {}),
      });
      setUsers((prev) => [...prev, created]);
      if (created.generatedPassword) {
        setRevealed({ email: created.email, password: created.generatedPassword });
      } else if (form.password.trim()) {
        setRevealed({ email: created.email, password: form.password.trim() });
      }
      setForm({
        email: "",
        name: "",
        password: "",
        roleSlug: form.roleSlug,
        competitionIds: [],
        allCompetitions: false,
      });
      toast.success(`Created ${created.email}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreating(false);
    }
  };

  const patch = async (user: AdminUser, body: Parameters<typeof adminRbacApi.updateUser>[1]) => {
    try {
      const updated = await adminRbacApi.updateUser(user.id, body);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      return updated;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
      return null;
    }
  };

  const resetPassword = async (user: AdminUser) => {
    try {
      const { password } = await adminRbacApi.resetPassword(user.id);
      setRevealed({ email: user.email, password });
      toast.success(`New password issued for ${user.email}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reset the password");
    }
  };

  const remove = async (user: AdminUser) => {
    /* Deleting an account is irreversible, so it asks first. */
    if (!window.confirm(`Delete ${user.email}? This cannot be undone.`)) return;
    try {
      await adminRbacApi.deleteUser(user.id);
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
      toast.success(`Deleted ${user.email}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const startEdit = (user: AdminUser) => {
    setEditing(user.id);
    setEditDraft({ name: user.name ?? "", email: user.email });
  };

  const saveEdit = async (user: AdminUser) => {
    const updated = await patch(user, {
      name: editDraft.name,
      email: editDraft.email !== user.email ? editDraft.email : undefined,
    });
    if (updated) {
      setEditing(null);
      toast.success("Saved");
    }
  };

  const roleOptions = tab === "recorders" ? recorderRoles : staffRoles;

  return (
    <div className="admin-rbac-page">
      <AdminPageHeader
        title="Admin users"
        description="Internal staff and contracted match recorders. Recorders are scoped to a single competition and see only their own match sheets."
      />

      {revealed && (
        <PasswordReveal
          email={revealed.email}
          password={revealed.password}
          onDismiss={() => setRevealed(null)}
        />
      )}

      <div className="aup-tabs" role="tablist" aria-label="Account groups">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "staff"}
          className={tab === "staff" ? "aup-tab is-active" : "aup-tab"}
          onClick={() => {
            setTab("staff");
            setForm((f) => ({ ...f, roleSlug: "read_only", competitionIds: [], allCompetitions: false }));
          }}
        >
          Internal staff <span className="aup-tab__count">{counts.staff}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "recorders"}
          className={tab === "recorders" ? "aup-tab is-active" : "aup-tab"}
          onClick={() => {
            setTab("recorders");
            setForm((f) => ({ ...f, roleSlug: SCOPED_ROLE }));
          }}
        >
          Match recorders <span className="aup-tab__count">{counts.recorders}</span>
        </button>
      </div>

      <div className="admin-rbac-layout">
        <div className="admin-sb-panel">
          <h2 className="admin-sb-panel__title">
            New {tab === "recorders" ? "match recorder" : "staff account"}
          </h2>
          <form className="admin-sb-form" onSubmit={handleCreate}>
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
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </label>

            <label className="admin-sb-field">
              <span>Password</span>
              <div className="aup-passrow">
                <input
                  type="text"
                  minLength={8}
                  placeholder="Leave blank to generate one"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                />
                <button type="button" className="btn" onClick={generate}>
                  Generate
                </button>
              </div>
              <small className="muted">
                Shown once after creating. It is stored as a hash and cannot be read back.
              </small>
            </label>

            <label className="admin-sb-field">
              <span>Role</span>
              <select
                value={form.roleSlug}
                onChange={(e) => setForm((f) => ({ ...f, roleSlug: e.target.value }))}
              >
                {roleOptions.map((role) => (
                  <option key={role.slug} value={role.slug}>
                    {role.name}
                  </option>
                ))}
              </select>
            </label>

            {form.roleSlug === SCOPED_ROLE && (
              <fieldset className="admin-sb-field admin-scopeset">
                <legend>Competitions</legend>

                <label className="admin-scopeset__all">
                  <input
                    type="checkbox"
                    checked={form.allCompetitions}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, allCompetitions: e.target.checked }))
                    }
                  />
                  <span>
                    <strong>All competitions</strong>
                    <small className="muted">
                      Includes any competition added later, friendlies among them.
                    </small>
                  </span>
                </label>

                {/* Named picks are pointless once everything is granted, so they
                    are disabled rather than left to contradict the toggle. */}
                <div
                  className={`admin-scopeset__list${form.allCompetitions ? " is-disabled" : ""}`}
                >
                  {competitions.map((competition) => (
                    <label key={competition.id}>
                      <input
                        type="checkbox"
                        disabled={form.allCompetitions}
                        checked={form.competitionIds.includes(competition.id)}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            competitionIds: e.target.checked
                              ? [...f.competitionIds, competition.id]
                              : f.competitionIds.filter((id) => id !== competition.id),
                          }))
                        }
                      />
                      <span>{competition.name}</span>
                    </label>
                  ))}
                </div>

                <small className="muted">
                  {form.allCompetitions
                    ? "This recorder will see every fixture."
                    : form.competitionIds.length === 0
                      ? "Pick at least one competition, or grant them all."
                      : `Sees fixtures from ${form.competitionIds.length} competition${form.competitionIds.length === 1 ? "" : "s"}.`}
                </small>
              </fieldset>
            )}

            <button type="submit" className="btn btn-primary" disabled={creating}>
              {creating ? "Creating…" : "Create user"}
            </button>
          </form>
        </div>

        <div className="admin-sb-panel admin-rbac-users-table-wrap">
          <div className="aup-listhead">
            <h2 className="admin-sb-panel__title">
              {tab === "recorders" ? "Match recorders" : "Internal staff"} ({visible.length})
            </h2>
            <input
              type="search"
              className="aup-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by name, email or role"
              aria-label="Filter accounts"
            />
          </div>

          {loading ? (
            <p className="muted">Loading accounts…</p>
          ) : visible.length === 0 ? (
            <p className="muted">
              {search
                ? "No accounts match that filter."
                : tab === "recorders"
                  ? "No match recorders yet. Create one on the left."
                  : "No staff accounts yet."}
            </p>
          ) : (
            <ul className="aup-list">
              {visible.map((user) => (
                <li key={user.id} className={user.isActive ? "aup-row" : "aup-row is-inactive"}>
                  <div className="aup-row__main">
                    {editing === user.id ? (
                      <div className="aup-edit">
                        <input
                          value={editDraft.name}
                          onChange={(e) =>
                            setEditDraft((d) => ({ ...d, name: e.target.value }))
                          }
                          placeholder="Name"
                          aria-label="Name"
                        />
                        <input
                          type="email"
                          value={editDraft.email}
                          onChange={(e) =>
                            setEditDraft((d) => ({ ...d, email: e.target.value }))
                          }
                          placeholder="Email"
                          aria-label="Email"
                        />
                        <button type="button" className="btn btn-primary" onClick={() => saveEdit(user)}>
                          Save
                        </button>
                        <button type="button" className="btn" onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className="aup-row__name">{user.name || "—"}</span>
                        <span className="aup-row__email">{user.email}</span>
                      </>
                    )}
                  </div>

                  <div className="aup-row__controls">
                    <select
                      value={user.roleSlug ?? ""}
                      onChange={(e) => patch(user, { roleSlug: e.target.value })}
                      aria-label={`Role for ${user.email}`}
                    >
                      {roles.map((role) => (
                        <option key={role.slug} value={role.slug}>
                          {role.name}
                        </option>
                      ))}
                    </select>

                    {user.roleSlug === SCOPED_ROLE && (
                      <details className="admin-scoperow">
                        <summary>
                          {user.allCompetitions
                            ? "All competitions"
                            : (user.competitionNames ?? []).length === 0
                              ? "No competitions"
                              : (user.competitionNames ?? []).length <= 2
                                ? (user.competitionNames ?? []).join(", ")
                                : `${(user.competitionNames ?? []).length} competitions`}
                        </summary>

                        <label className="admin-scoperow__all">
                          <input
                            type="checkbox"
                            checked={user.allCompetitions ?? false}
                            onChange={(e) => patch(user, { allCompetitions: e.target.checked })}
                          />
                          <span>All competitions</span>
                        </label>

                        <div className={user.allCompetitions ? "is-disabled" : undefined}>
                          {competitions.map((competition) => {
                            const on = (user.competitionIds ?? []).includes(competition.id);
                            return (
                              <label key={competition.id}>
                                <input
                                  type="checkbox"
                                  disabled={user.allCompetitions ?? false}
                                  checked={on}
                                  onChange={() =>
                                    patch(user, {
                                      /* Sent whole rather than as a delta — the
                                         server replaces the set outright, so a
                                         dropped request cannot half-apply. */
                                      competitionIds: on
                                        ? (user.competitionIds ?? []).filter(
                                            (id) => id !== competition.id
                                          )
                                        : [...(user.competitionIds ?? []), competition.id],
                                    })
                                  }
                                />
                                <span>{competition.name}</span>
                              </label>
                            );
                          })}
                        </div>
                      </details>
                    )}
                  </div>

                  <div className="aup-row__actions">
                    <button
                      type="button"
                      className="aup-link"
                      onClick={() => startEdit(user)}
                      disabled={editing === user.id}
                    >
                      Edit
                    </button>
                    <button type="button" className="aup-link" onClick={() => resetPassword(user)}>
                      New password
                    </button>
                    <button
                      type="button"
                      className="aup-link"
                      onClick={() => patch(user, { isActive: !user.isActive })}
                    >
                      {user.isActive ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      type="button"
                      className="aup-link aup-link--danger"
                      onClick={() => remove(user)}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
