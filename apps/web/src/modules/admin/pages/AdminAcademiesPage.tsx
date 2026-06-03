import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  adminApi,
  type AdminAcademy,
  type AdminAcademyInput,
} from "../../../api/admin";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useAdminToast } from "../components/AdminToast";
import { AdminPageHeader } from "../components/AdminPageHeader";
import { AdminTableShell } from "../components/AdminTableShell";

const emptyDraft: AdminAcademyInput = {
  name: "",
  slug: "",
  city: "",
  country: "",
  description: "",
  logoUrl: "",
  websiteUrl: "",
  isPublished: true,
};

function toDraft(academy: AdminAcademy): AdminAcademyInput {
  return {
    name: academy.name,
    slug: academy.slug,
    city: academy.city ?? "",
    country: academy.country ?? "",
    description: academy.description ?? "",
    logoUrl: academy.logoUrl ?? "",
    websiteUrl: academy.websiteUrl ?? "",
    isPublished: academy.isPublished,
  };
}

export function AdminAcademiesPage() {
  usePageTitle("Admin — Academies");
  const toast = useAdminToast();
  const [rows, setRows] = useState<AdminAcademy[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AdminAcademyInput>(emptyDraft);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    adminApi
      .academyList()
      .then(setRows)
      .catch((e) => {
        toast.error(String(e));
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const select = (academy: AdminAcademy) => {
    setSelectedId(academy.id);
    setDraft(toDraft(academy));
  };

  const startNew = () => {
    setSelectedId(null);
    setDraft(emptyDraft);
  };

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    try {
      const saved = selectedId
        ? await adminApi.academyUpdate(selectedId, draft)
        : await adminApi.academyCreate(draft);
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

  return (
    <section className="admin-page admin-sb-section">
      <AdminPageHeader
        title="Academies"
        description="Manage public partner academies shown on the marketing site."
        crumbs={[{ label: "Academies" }]}
        actions={
          <button
            type="button"
            className="admin-inline-button admin-inline-button--primary"
            onClick={startNew}
          >
            New academy
          </button>
        }
      />

      <div className="admin-content-grid">
        <div className="admin-sb-content-panel">
          <AdminTableShell
            loading={loading}
            empty={!loading && rows.length === 0}
            emptyTitle="No academies yet"
            emptyHint="Create the first partner academy using the form."
            columns={3}
          >
            <table className="admin-table admin-sb-table admin-table--clickable">
              <thead>
                <tr>
                  <th>Academy</th>
                  <th>Location</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((academy) => (
                  <tr
                    key={academy.id}
                    className={
                      academy.id === selectedId ? "admin-sb-row--active" : undefined
                    }
                    onClick={() => select(academy)}
                  >
                    <td>
                      <strong>{academy.name}</strong>
                      <br />
                      <span className="muted">/{academy.slug}</span>
                    </td>
                    <td>
                      {[academy.city, academy.country].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td>
                      <span
                        className={
                          academy.isPublished
                            ? "admin-sb-status admin-sb-status--active"
                            : "admin-sb-status admin-sb-status--draft"
                        }
                      >
                        {academy.isPublished ? "published" : "draft"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminTableShell>
        </div>

        <form className="admin-content-form admin-sb-panel" onSubmit={save}>
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
          <label className="admin-sb-field admin-sb-field--wide">
            <span>Description</span>
            <textarea
              rows={4}
              value={draft.description ?? ""}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
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
