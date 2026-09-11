import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  adminApi,
  type AdminAcademy,
  type AdminAcademyChangeRequest,
  type AdminAcademyInput,
} from "../../../api/admin";
import { useDebouncedValue } from "../../../hooks/useDebouncedValue";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useAdminToast } from "../components/AdminToast";
import { AdminPageHeader } from "../components/AdminPageHeader";
import { AdminTableShell } from "../components/AdminTableShell";

function generateRandomPassword(length = 12) {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

const emptyDraft: AdminAcademyInput = {
  name: "",
  slug: "",
  contactPerson: "",
  email: "",
  phone: "",
  city: "",
  country: "",
  description: "",
  foundedYear: "",
  logoUrl: "",
  websiteUrl: "",
  subscriptionTier: "",
  maxPlayers: "",
  loginUsername: "",
  password: "",
  isPublished: true,
};

function toDraft(academy: AdminAcademy): AdminAcademyInput {
  return {
    name: academy.name,
    slug: academy.slug,
    contactPerson: academy.contactPerson ?? "",
    email: academy.email ?? "",
    phone: academy.phone ?? "",
    city: academy.city ?? "",
    country: academy.country ?? "",
    description: academy.description ?? "",
    foundedYear: academy.foundedYear ?? "",
    logoUrl: academy.logoUrl ?? "",
    websiteUrl: academy.websiteUrl ?? "",
    subscriptionTier: academy.subscriptionTier ?? "",
    maxPlayers: academy.maxPlayers ?? "",
    loginUsername: academy.loginUsername ?? "",
    password: "",
    isPublished: academy.isPublished,
  };
}

type QuickFilter = "" | "ex-intl" | "has-login" | "no-login";

function academySearchHaystack(academy: AdminAcademy): string {
  return [
    academy.name,
    academy.city,
    academy.country,
    academy.loginUsername,
    academy.slug,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function matchesQuickFilter(academy: AdminAcademy, chip: QuickFilter): boolean {
  if (chip === "ex-intl") return academy.slug.startsWith("ex-intl-");
  if (chip === "has-login") return Boolean(academy.loginUsername?.trim());
  if (chip === "no-login") return !academy.loginUsername?.trim();
  return true;
}

function academyInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

export function AdminAcademiesPage() {
  usePageTitle("Admin — Academies");
  const toast = useAdminToast();
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<AdminAcademy[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AdminAcademyInput>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("");
  const [reviews, setReviews] = useState<AdminAcademyChangeRequest[]>([]);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const debouncedSearch = useDebouncedValue(searchQuery, 200);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([adminApi.academyList(), adminApi.academyChangeRequests("pending")])
      .then(([academyRows, reviewRows]) => {
        setRows(academyRows);
        setReviews(reviewRows);
      })
      .catch((e) => {
        toast.error(String(e));
        setRows([]);
        setReviews([]);
      })
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredRows = useMemo(() => {
    const needle = debouncedSearch.trim().toLowerCase();
    return rows.filter((academy) => {
      if (!matchesQuickFilter(academy, quickFilter)) return false;
      if (!needle) return true;
      return academySearchHaystack(academy).includes(needle);
    });
  }, [rows, debouncedSearch, quickFilter]);

  const listEmpty = !loading && filteredRows.length === 0;
  const hasFilters = Boolean(debouncedSearch.trim() || quickFilter);
  const listEmptyTitle = hasFilters
    ? "No academies match your filters"
    : "No academies yet";
  const listEmptyHint = hasFilters
    ? "Try a different search term or clear the quick filters."
    : "Create the first partner academy using the form.";

  const select = (academy: AdminAcademy) => {
    setSelectedId(academy.id);
    setDraft(toDraft(academy));
  };

  const startNew = () => {
    setSelectedId(null);
    setDraft(emptyDraft);
  };

  const copyPassword = async () => {
    const password = draft.password?.trim();
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
      toast.success("Password copied");
    } catch {
      const input = passwordInputRef.current;
      if (input) {
        input.type = "text";
        input.focus();
        input.select();
        try {
          document.execCommand("copy");
          toast.success("Password copied");
        } catch {
          toast.error("Could not copy — select the password manually");
        } finally {
          input.type = "password";
        }
      } else {
        toast.error("Could not copy — select the password manually");
      }
    }
  };

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body: AdminAcademyInput = {
        ...draft,
        subscriptionTier:
          draft.subscriptionTier === "" ? undefined : draft.subscriptionTier,
        maxPlayers: draft.maxPlayers === "" ? undefined : draft.maxPlayers,
        foundedYear: draft.foundedYear === "" ? undefined : draft.foundedYear,
      };
      const saved = selectedId
        ? await adminApi.academyUpdate(selectedId, body)
        : await adminApi.academyCreate(body);
      setSelectedId(saved.id);
      setDraft(toDraft(saved));
      toast.success("Academy saved");
      load();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!selectedId || !window.confirm("Delete this academy?")) return;
    try {
      await adminApi.academyDelete(selectedId);
      setSelectedId(null);
      setDraft(emptyDraft);
      toast.success("Academy deleted");
      load();
    } catch (err) {
      toast.error(String(err));
    }
  };

  const toggleQuickFilter = (chip: QuickFilter) => {
    setQuickFilter((prev) => (prev === chip ? "" : chip));
  };

  const reviewRequest = async (id: string, decision: "approve" | "reject") => {
    setReviewingId(id);
    try {
      if (decision === "approve") {
        await adminApi.approveAcademyChangeRequest(id);
        toast.success("Club change approved");
      } else {
        await adminApi.rejectAcademyChangeRequest(id);
        toast.success("Club change rejected");
      }
      load();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setReviewingId(null);
    }
  };

  const syncClubs = async () => {
    setSyncing(true);
    try {
      const result = await adminApi.syncClubsFromTeams();
      const parts = [
        `${result.teamsLinked} team${result.teamsLinked === 1 ? "" : "s"} linked`,
        `${result.clubsCreated} new club${result.clubsCreated === 1 ? "" : "s"}`,
        `${result.clubsMatched} matched to existing profiles`,
      ];
      toast.success(`Club sync: ${parts.join(", ")}`);
      if (result.ambiguous.length) {
        toast.info(
          `Left alone (teams already split across profiles): ${result.ambiguous.join(", ")}`
        );
      }
      load();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <section className="admin-page admin-sb-section admin-academies-page">
      <AdminPageHeader
        title="Academies"
        description="Manage partner academies, club portal logins, and the authenticated directory."
        crumbs={[{ label: "Academies" }]}
        actions={
          <>
            <button
              type="button"
              className="admin-inline-button"
              onClick={() => void syncClubs()}
              disabled={syncing}
              title="Link every ScoreBoard team to its club profile, creating any that are missing"
            >
              {syncing ? "Syncing clubs…" : "Sync clubs from ScoreBoard"}
            </button>
            <button
              type="button"
              className="admin-inline-button admin-inline-button--primary"
              onClick={startNew}
            >
              New academy
            </button>
          </>
        }
      />

      <section className="admin-sb-content-panel admin-academy-review-panel">
        <div className="admin-sb-panel-header">
          <div>
            <h2>Club review queue</h2>
            <p className="muted">
              Approve manager-submitted club profile, player name, photo, publication,
              and YouTube highlight updates.
            </p>
          </div>
          <span className="admin-academies-badge admin-academies-badge--login">
            {reviews.length} pending
          </span>
        </div>
        {reviews.length === 0 ? (
          <p className="admin-empty-state">No club updates are waiting for review.</p>
        ) : (
          <div className="admin-academy-review-grid">
            {reviews.map((request) => (
              <article key={request.id} className="admin-academy-review-card">
                <div>
                  <span className="admin-academy-review-card__kind">
                    {request.kind.replace(/_/g, " ")}
                  </span>
                  <h3>
                    {request.player?.displayName ?? request.academy.name}
                  </h3>
                  <p className="muted">
                    {request.academy.name} · {new Date(request.submittedAt).toLocaleDateString()}
                  </p>
                </div>
                <dl>
                  {Object.entries(request.payload).map(([key, value]) => (
                    <div key={key}>
                      <dt>{key.replace(/([A-Z])/g, " $1")}</dt>
                      <dd>
                        {Array.isArray(value)
                          ? value.join(", ")
                          : value == null
                            ? "Clear value"
                            : String(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
                <div className="admin-academy-review-card__actions">
                  <button
                    type="button"
                    className="admin-inline-button admin-inline-button--primary"
                    disabled={reviewingId === request.id}
                    onClick={() => void reviewRequest(request.id, "approve")}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="admin-inline-button"
                    disabled={reviewingId === request.id}
                    onClick={() => void reviewRequest(request.id, "reject")}
                  >
                    Reject
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="admin-content-grid admin-academies-grid">
        <div className="admin-sb-content-panel admin-academies-list-panel">
          <div className="admin-academies-toolbar">
            <div className="admin-academies-search-wrap">
              <input
                type="search"
                className="admin-academies-search"
                placeholder="Search name, city, username, slug…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Filter academies"
              />
              {!loading && rows.length > 0 && (
                <span className="admin-academies-count muted" aria-live="polite">
                  {filteredRows.length === rows.length
                    ? `${rows.length} academ${rows.length === 1 ? "y" : "ies"}`
                    : `${filteredRows.length} of ${rows.length}`}
                </span>
              )}
            </div>
            <div className="admin-academies-chips" role="group" aria-label="Quick filters">
              <button
                type="button"
                className={
                  quickFilter === "ex-intl"
                    ? "admin-academies-chip admin-academies-chip--active"
                    : "admin-academies-chip"
                }
                onClick={() => toggleQuickFilter("ex-intl")}
                aria-pressed={quickFilter === "ex-intl"}
              >
                Ex Internationals
              </button>
              <button
                type="button"
                className={
                  quickFilter === "has-login"
                    ? "admin-academies-chip admin-academies-chip--active"
                    : "admin-academies-chip"
                }
                onClick={() => toggleQuickFilter("has-login")}
                aria-pressed={quickFilter === "has-login"}
              >
                Has login
              </button>
              <button
                type="button"
                className={
                  quickFilter === "no-login"
                    ? "admin-academies-chip admin-academies-chip--active"
                    : "admin-academies-chip"
                }
                onClick={() => toggleQuickFilter("no-login")}
                aria-pressed={quickFilter === "no-login"}
              >
                No login
              </button>
            </div>
          </div>

          <AdminTableShell
            loading={loading}
            empty={listEmpty}
            emptyTitle={listEmptyTitle}
            emptyHint={listEmptyHint}
            columns={4}
          >
            <table className="admin-table admin-sb-table admin-table--clickable admin-academies-table">
              <thead>
                <tr>
                  <th>Academy</th>
                  <th>Location</th>
                  <th>Login</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((academy) => {
                  const location = [academy.city, academy.country]
                    .filter(Boolean)
                    .join(", ");
                  const hasLogin = Boolean(academy.loginUsername?.trim());
                  return (
                    <tr
                      key={academy.id}
                      className={
                        academy.id === selectedId
                          ? "admin-sb-row--active admin-academies-row--active"
                          : "admin-academies-row"
                      }
                      onClick={() => select(academy)}
                    >
                      <td>
                        <div className="admin-academies-row__academy">
                          <span className="admin-academies-row__logo" aria-hidden>
                            {academy.logoUrl ? (
                              <img src={academy.logoUrl} alt="" />
                            ) : (
                              <span className="admin-academies-row__initials">
                                {academyInitials(academy.name)}
                              </span>
                            )}
                          </span>
                          <span className="admin-academies-row__text">
                            <strong>{academy.name}</strong>
                            <span className="admin-academies-row__slug muted">
                              /{academy.slug}
                            </span>
                          </span>
                        </div>
                      </td>
                      <td>
                        {location ? (
                          <span className="admin-academies-row__location">{location}</span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        {hasLogin ? (
                          <span className="admin-academies-badge admin-academies-badge--login">
                            @{academy.loginUsername}
                          </span>
                        ) : (
                          <span className="admin-academies-badge admin-academies-badge--muted">
                            No login
                          </span>
                        )}
                      </td>
                      <td>
                        <span
                          className={
                            academy.isPublished
                              ? "admin-sb-status admin-sb-status--active"
                              : "admin-sb-status admin-sb-status--draft"
                          }
                        >
                          {academy.isPublished ? "Published" : "Draft"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </AdminTableShell>
        </div>

        <form className="admin-content-form admin-sb-panel admin-academies-form" onSubmit={save}>
          <h2 className="admin-sb-form-heading">
            {selectedId ? "Edit academy" : "New academy"}
          </h2>
          <label className="admin-sb-field">
            <span>Name</span>
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              required
            />
          </label>
          <label className="admin-sb-field">
            <span>Slug</span>
            <input
              value={draft.slug ?? ""}
              onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
              placeholder="auto-generated from name"
            />
          </label>
          <div className="admin-form-row">
            <label className="admin-sb-field">
              <span>City</span>
              <input
                value={draft.city ?? ""}
                onChange={(e) => setDraft({ ...draft, city: e.target.value })}
              />
            </label>
            <label className="admin-sb-field">
              <span>Country</span>
              <input
                value={draft.country ?? ""}
                onChange={(e) => setDraft({ ...draft, country: e.target.value })}
              />
            </label>
          </div>
          <div className="admin-form-row">
            <label className="admin-sb-field">
              <span>Contact person</span>
              <input
                value={draft.contactPerson ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, contactPerson: e.target.value })
                }
              />
            </label>
            <label className="admin-sb-field">
              <span>Email</span>
              <input
                type="email"
                value={draft.email ?? ""}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              />
            </label>
          </div>
          <div className="admin-form-row">
            <label className="admin-sb-field">
              <span>Phone</span>
              <input
                value={draft.phone ?? ""}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
              />
            </label>
            <label className="admin-sb-field">
              <span>Max players</span>
              <input
                type="number"
                min={1}
                value={draft.maxPlayers ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    maxPlayers: e.target.value === "" ? "" : Number(e.target.value),
                  })
                }
              />
            </label>
          </div>
          <label className="admin-sb-field">
            <span>Subscription tier</span>
            <select
              value={draft.subscriptionTier ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  subscriptionTier: e.target.value as AdminAcademyInput["subscriptionTier"],
                })
              }
            >
              <option value="">Not set</option>
              <option value="Basic">Basic</option>
              <option value="Premium">Premium</option>
            </select>
          </label>
          <label className="admin-sb-field admin-sb-field--wide">
            <span>Description</span>
            <textarea
              rows={4}
              value={draft.description ?? ""}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </label>
          <label className="admin-sb-field">
            <span>Year founded</span>
            <input
              type="number"
              min={1800}
              max={2100}
              value={draft.foundedYear ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  foundedYear: e.target.value === "" ? "" : Number(e.target.value),
                })
              }
            />
          </label>
          <label className="admin-sb-field">
            <span>Logo URL</span>
            <input
              value={draft.logoUrl ?? ""}
              onChange={(e) => setDraft({ ...draft, logoUrl: e.target.value })}
            />
          </label>
          <label className="admin-sb-field">
            <span>Website URL</span>
            <input
              value={draft.websiteUrl ?? ""}
              onChange={(e) => setDraft({ ...draft, websiteUrl: e.target.value })}
            />
          </label>
          <h3 className="admin-sb-form-subheading">Club portal login</h3>
          <p className="admin-sb-hint muted">
            Usernames must be unique. Leave password blank when editing to keep the
            current hash. Legacy academies without credentials cannot sign in at{" "}
            <code>/academy</code> until you set both fields.
          </p>
          <label className="admin-sb-field">
            <span>Login username</span>
            <input
              value={draft.loginUsername ?? ""}
              onChange={(e) =>
                setDraft({ ...draft, loginUsername: e.target.value })
              }
              placeholder="e.g. fc-ekpo"
              autoComplete="off"
            />
          </label>
          <label className="admin-sb-field">
            <span>Password</span>
            <div className="admin-academies-password-row">
              <input
                ref={passwordInputRef}
                type="password"
                value={draft.password ?? ""}
                onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                placeholder={selectedId ? "Leave blank to keep existing" : "Required for login"}
                autoComplete="new-password"
              />
              {draft.password ? (
                <button
                  type="button"
                  className="admin-academies-copy-btn admin-inline-button"
                  onClick={() => void copyPassword()}
                  title="Copy password"
                  aria-label="Copy password"
                >
                  Copy
                </button>
              ) : null}
            </div>
          </label>
          <div className="admin-academies-password-actions">
            <button
              type="button"
              className="admin-inline-button"
              onClick={() => {
                const next = generateRandomPassword();
                setDraft({ ...draft, password: next });
                toast.success("Random password generated");
              }}
            >
              Generate random password
            </button>
          </div>
          <label className="admin-sb-check">
            <input
              type="checkbox"
              checked={draft.isPublished ?? true}
              onChange={(e) => setDraft({ ...draft, isPublished: e.target.checked })}
            />
            Published
          </label>
          <div className="admin-sb-form-actions">
            <button
              type="submit"
              className="admin-inline-button admin-inline-button--primary"
              disabled={saving}
            >
              {saving ? "Saving…" : "Save academy"}
            </button>
            {selectedId && (
              <button type="button" className="admin-link-danger" onClick={remove}>
                Delete
              </button>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}
