import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  adminApi,
  type AdminAcademy,
  type AdminAcademyInput,
} from "../../../api/admin";
import { usePageTitle } from "../../../hooks/usePageTitle";

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
  const [rows, setRows] = useState<AdminAcademy[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AdminAcademyInput>(emptyDraft);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    adminApi.academyList().then(setRows).catch((e) => setMessage(String(e)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const select = (academy: AdminAcademy) => {
    setSelectedId(academy.id);
    setDraft(toDraft(academy));
    setMessage(null);
  };

  const startNew = () => {
    setSelectedId(null);
    setDraft(emptyDraft);
    setMessage(null);
  };

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMessage(null);
    try {
      const saved = selectedId
        ? await adminApi.academyUpdate(selectedId, draft)
        : await adminApi.academyCreate(draft);
      setSelectedId(saved.id);
      setDraft(toDraft(saved));
      setMessage("Saved");
      load();
    } catch (err) {
      setMessage(String(err));
    }
  };

  const remove = async () => {
    if (!selectedId || !window.confirm("Delete this academy?")) return;
    try {
      await adminApi.academyDelete(selectedId);
      setSelectedId(null);
      setDraft(emptyDraft);
      setMessage("Deleted");
      load();
    } catch (err) {
      setMessage(String(err));
    }
  };

  return (
    <div className="admin-page">
      <header className="page-header admin-page-header">
        <div>
          <h1>Academies</h1>
          <p className="muted">Manage public partner academies shown on the marketing site.</p>
        </div>
        <button type="button" className="dtp-btn dtp-btn--primary" onClick={startNew}>
          New academy
        </button>
      </header>

      {message && <p className="muted">{message}</p>}

      <div className="admin-content-grid">
        <div className="admin-table-wrap">
          <table className="sip-table admin-table">
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
                  className={academy.id === selectedId ? "admin-row-active" : undefined}
                  onClick={() => select(academy)}
                >
                  <td>
                    <strong>{academy.name}</strong>
                    <br />
                    <span className="muted">/{academy.slug}</span>
                  </td>
                  <td>{[academy.city, academy.country].filter(Boolean).join(", ") || "—"}</td>
                  <td>
                    <span
                      className={
                        academy.isPublished ? "admin-pill admin-pill--live" : "admin-pill"
                      }
                    >
                      {academy.isPublished ? "published" : "draft"}
                    </span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    No academies yet. Create the first partner academy.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <form className="home-form admin-content-form" onSubmit={save}>
          <h2>{selectedId ? "Edit academy" : "New academy"}</h2>
          <label>
            Name
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              required
            />
          </label>
          <label>
            Slug
            <input
              value={draft.slug ?? ""}
              onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
              placeholder="auto-generated from name"
            />
          </label>
          <div className="admin-form-row">
            <label>
              City
              <input
                value={draft.city ?? ""}
                onChange={(e) => setDraft({ ...draft, city: e.target.value })}
              />
            </label>
            <label>
              Country
              <input
                value={draft.country ?? ""}
                onChange={(e) => setDraft({ ...draft, country: e.target.value })}
              />
            </label>
          </div>
          <label>
            Description
            <textarea
              rows={4}
              value={draft.description ?? ""}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </label>
          <label>
            Logo URL
            <input
              value={draft.logoUrl ?? ""}
              onChange={(e) => setDraft({ ...draft, logoUrl: e.target.value })}
            />
          </label>
          <label>
            Website URL
            <input
              value={draft.websiteUrl ?? ""}
              onChange={(e) => setDraft({ ...draft, websiteUrl: e.target.value })}
            />
          </label>
          <label className="admin-checkbox-label">
            <input
              type="checkbox"
              checked={draft.isPublished ?? true}
              onChange={(e) =>
                setDraft({ ...draft, isPublished: e.target.checked })
              }
            />
            Published
          </label>
          <div className="admin-table__actions">
            <button type="submit" className="dtp-btn dtp-btn--primary">
              Save academy
            </button>
            {selectedId && (
              <button type="button" className="admin-link-danger" onClick={remove}>
                Delete
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
