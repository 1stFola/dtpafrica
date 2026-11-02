import { FormEvent, useEffect, useMemo, useState } from "react";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useAdminToast } from "../components/AdminToast";
import { AdminPageHeader } from "../components/AdminPageHeader";
import { adminRbacApi, type AdminRole, type AdminUser } from "./admin-rbac-api";
import { fetchCompetitions, type SbCompetition } from "../../../api/scoreboard";

/**
 * Roles whose accounts are limited to competitions, mirroring the rule the API
 * enforces (admin-rbac.service.ts). Everywhere else in admin "no competitions"
 * means every competition, which is right for staff and wrong for an outsider.
 *
 *   - A Match Recorder may hold named competitions or all of them, and sees
 *     only those fixtures in the recorder console.
 *   - A FairPlay Organiser may hold named competitions only: FairPlay refuses an
 *     organiser with no scope, and "all competitions" signs in with none.
 */
type ScopedRole = { allowAll: boolean; sees: string };
const SCOPED_ROLES: Record<string, ScopedRole> = {
  match_recorder: { allowAll: true, sees: "fixtures" },
  fairplay_organiser_viewer: { allowAll: false, sees: "FairPlay reports and released evidence" },
};
const scopedRole = (slug: string | null | undefined): ScopedRole | undefined =>
  slug ? SCOPED_ROLES[slug] : undefined;

/** Accounts from outside DTP are grouped away from staff, one tab per kind. */
type Tab = "staff" | "recorders" | "organisers";
const TABS: {
  id: Tab;
  label: string;
  roles: string[] | null;
  defaultRole: string;
  singular: string;
  empty: string;
}[] = [
  {
    id: "staff",
    label: "Internal staff",
    roles: null,
    defaultRole: "read_only",
    singular: "staff account",
    empty: "No staff accounts yet.",
  },
  {
    id: "recorders",
    label: "Match recorders",
    roles: ["match_recorder"],
    defaultRole: "match_recorder",
    singular: "match recorder",
    empty: "No match recorders yet. Create one on the left.",
  },
  {
    id: "organisers",
    label: "FairPlay organisers",
    roles: ["fairplay_organiser_viewer"],
    defaultRole: "fairplay_organiser_viewer",
    singular: "FairPlay organiser",
    empty: "No FairPlay organisers yet. Create one on the left.",
  },
];
const EXTERNAL_ROLES = new Set(TABS.flatMap((t) => t.roles ?? []));
const tabOf = (roleSlug: string | null | undefined): Tab =>
  TABS.find((t) => t.roles?.includes(roleSlug ?? ""))?.id ?? "staff";

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

  const current = TABS.find((t) => t.id === tab) ?? TABS[0];
  const roleOptions = useMemo(
    () =>
      roles.filter((r) =>
        current.roles ? current.roles.includes(r.slug) : !EXTERNAL_ROLES.has(r.slug)
      ),
    [roles, current]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const inTab = users.filter((u) => tabOf(u.roleSlug) === tab);
    if (!q) return inTab;
    return inTab.filter((u) =>
      [u.email, u.name, u.roleName, ...(u.competitionNames ?? [])]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [users, tab, search]);

  const counts = useMemo(() => {
    const out: Record<Tab, number> = { staff: 0, recorders: 0, organisers: 0 };
    for (const u of users) out[tabOf(u.roleSlug)] += 1;
    return out;
  }, [users]);

  const selectTab = (next: Tab) => {
    const def = TABS.find((t) => t.id === next) ?? TABS[0];
    setTab(next);
    setForm((f) => ({ ...f, roleSlug: def.defaultRole, competitionIds: [], allCompetitions: false }));
  };

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
        ...(scopedRole(form.roleSlug)
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

  const formScope = scopedRole(form.roleSlug);

  return (
    <div className="admin-rbac-page">
      <AdminPageHeader
        title="Admin users"
        description="Internal staff, contracted match recorders and FairPlay organisers. Recorders and organisers are limited to the competitions assigned to them: recorders see only their own match sheets, organisers only the FairPlay reports of their competitions."
      />

      {revealed && (
        <PasswordReveal
          email={revealed.email}
          password={revealed.password}
          onDismiss={() => setRevealed(null)}
        />
      )}

      <div className="aup-tabs" role="tablist" aria-label="Account groups">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "aup-tab is-active" : "aup-tab"}
            onClick={() => selectTab(t.id)}
          >
            {t.label} <span className="aup-tab__count">{counts[t.id]}</span>
          </button>
        ))}
      </div>

      <div className="admin-rbac-layout">
        <div className="admin-sb-panel">
          <h2 className="admin-sb-panel__title">New {current.singular}</h2>
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

            {formScope && (
              <fieldset className="admin-sb-field admin-scopeset">
                <legend>Competitions</legend>

                {/* An organiser is never offered everything: FairPlay refuses an
                    account with no scope, and that is what "all" signs in with. */}
                {formScope.allowAll && (
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
                )}

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
                      ? formScope.allowAll
                        ? "Pick at least one competition, or grant them all."
                        : "Pick at least one competition. An organiser with none is refused."
                      : `Sees ${formScope.sees} from ${form.competitionIds.length} competition${form.competitionIds.length === 1 ? "" : "s"}.`}
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
              {current.label} ({visible.length})
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
              {search ? "No accounts match that filter." : current.empty}
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

                    {scopedRole(user.roleSlug) && (
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

                        {scopedRole(user.roleSlug)?.allowAll && (
                          <label className="admin-scoperow__all">
                            <input
                              type="checkbox"
                              checked={user.allCompetitions ?? false}
                              onChange={(e) => patch(user, { allCompetitions: e.target.checked })}
                            />
                            <span>All competitions</span>
                          </label>
                        )}

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
