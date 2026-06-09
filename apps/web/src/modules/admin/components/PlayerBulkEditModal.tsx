import { useEffect, useState } from "react";
import {
  adminApi,
  type AdminAcademy,
  type BulkPlayerUpdates,
} from "../../../api/admin";
import { positionAbbreviationOptions } from "../../../utils/positionLabels";

const POSITION_OPTIONS = positionAbbreviationOptions();

type Props = {
  open: boolean;
  selectedIds: string[];
  selectedSlugs: string[];
  onClose: () => void;
  onSaved: (updated: number) => void;
};

type BulkFormState = {
  applyAcademy: boolean;
  academyId: string;
  applyFeatured: boolean;
  featuredValue: "true" | "false";
  applyPosition: boolean;
  positionPrimary: string;
};

const initialForm: BulkFormState = {
  applyAcademy: false,
  academyId: "",
  applyFeatured: false,
  featuredValue: "true",
  applyPosition: false,
  positionPrimary: "",
};

export function PlayerBulkEditModal({
  open,
  selectedIds,
  selectedSlugs,
  onClose,
  onSaved,
}: Props) {
  const [form, setForm] = useState<BulkFormState>(initialForm);
  const [academies, setAcademies] = useState<AdminAcademy[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(initialForm);
    setError(null);
    adminApi
      .academyList()
      .then(setAcademies)
      .catch(() => setAcademies([]));
  }, [open]);

  if (!open) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const updates: BulkPlayerUpdates = {};

    if (form.applyAcademy) {
      updates.academyId = form.academyId || null;
    }
    if (form.applyFeatured) {
      updates.isFeatured = form.featuredValue === "true";
    }
    if (form.applyPosition) {
      if (!form.positionPrimary.trim()) {
        setError("Position is required when enabled");
        return;
      }
      updates.positionPrimary = form.positionPrimary.trim().toUpperCase();
    }

    if (Object.keys(updates).length === 0) {
      setError("Enable at least one bulk action");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const result = await adminApi.bulkUpdatePlayers(selectedIds, updates);
      onSaved(result.updated);
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const exportSlugs = () => {
    const lines = selectedSlugs.filter(Boolean);
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "dtp-player-slugs.txt";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="admin-sb-modal-backdrop"
      role="presentation"
      onClick={() => !saving && onClose()}
    >
      <div
        className="admin-sb-modal admin-sb-modal--wide"
        role="dialog"
        aria-labelledby="bulk-edit-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="admin-sb-modal__header">
          <h2 id="bulk-edit-title">Bulk edit {selectedIds.length} players</h2>
          <button
            type="button"
            className="admin-sb-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>
        <form className="admin-sb-modal__body" onSubmit={handleSubmit}>
          <p className="admin-sb-modal__desc muted">
            Changes apply to all selected rows. Leave a section unchecked to skip it.
          </p>

          <label className="admin-sb-field admin-sb-field--checkbox">
            <input
              type="checkbox"
              checked={form.applyAcademy}
              onChange={(e) =>
                setForm((f) => ({ ...f, applyAcademy: e.target.checked }))
              }
            />
            <span>Set academy</span>
          </label>
          {form.applyAcademy ? (
            <label className="admin-sb-field">
              <span>Academy</span>
              <select
                value={form.academyId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, academyId: e.target.value }))
                }
              >
                <option value="">— No academy —</option>
                {academies.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="admin-sb-field admin-sb-field--checkbox">
            <input
              type="checkbox"
              checked={form.applyFeatured}
              onChange={(e) =>
                setForm((f) => ({ ...f, applyFeatured: e.target.checked }))
              }
            />
            <span>Set featured</span>
          </label>
          {form.applyFeatured ? (
            <label className="admin-sb-field">
              <span>Featured on homepage</span>
              <select
                value={form.featuredValue}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    featuredValue: e.target.value as "true" | "false",
                  }))
                }
              >
                <option value="true">Featured on</option>
                <option value="false">Featured off</option>
              </select>
            </label>
          ) : null}

          <label className="admin-sb-field admin-sb-field--checkbox">
            <input
              type="checkbox"
              checked={form.applyPosition}
              onChange={(e) =>
                setForm((f) => ({ ...f, applyPosition: e.target.checked }))
              }
            />
            <span>Set position</span>
          </label>
          {form.applyPosition ? (
            <label className="admin-sb-field">
              <span>Position (abbrev.)</span>
              <select
                value={form.positionPrimary}
                onChange={(e) =>
                  setForm((f) => ({ ...f, positionPrimary: e.target.value }))
                }
              >
                <option value="">— Select —</option>
                {POSITION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {error ? (
            <p className="admin-sb-form-error" role="alert">
              {error}
            </p>
          ) : null}

          <footer className="admin-sb-modal__footer">
            <button
              type="button"
              className="admin-inline-button"
              onClick={exportSlugs}
              disabled={selectedSlugs.length === 0}
            >
              Export slugs
            </button>
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? "Saving…" : "Apply to selected"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
