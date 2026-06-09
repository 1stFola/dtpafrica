import { useEffect, useState } from "react";
import {
  adminApi,
  type PlayerQuickEditContext,
  type PlayerQuickEditInput,
} from "../../../api/admin";
import { positionAbbreviationOptions } from "../../../utils/positionLabels";

const POSITION_OPTIONS = positionAbbreviationOptions();
const FOOT_OPTIONS = ["Left", "Right", "Both"];

type Props = {
  playerId: string | null;
  playerName: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
};

const emptyForm: PlayerQuickEditInput = {
  heightCm: "",
  preferredFoot: "",
  positionPrimary: "",
  estimatedPlayerValue: "",
  videoUrl: "",
  photosUrl: "",
  publicationsUrl: "",
};

function contextToForm(context: PlayerQuickEditContext): PlayerQuickEditInput {
  return {
    heightCm: context.heightCm != null ? String(context.heightCm) : "",
    preferredFoot: context.preferredFoot ?? "",
    positionPrimary: context.positionPrimary ?? "",
    estimatedPlayerValue: context.estimatedPlayerValue ?? "",
    videoUrl: context.videoUrl ?? "",
    photosUrl: context.photosUrl ?? "",
    publicationsUrl: context.publicationsUrl ?? "",
  };
}

export function PlayerQuickEditModal({
  playerId,
  playerName,
  open,
  onClose,
  onSaved,
}: Props) {
  const [form, setForm] = useState<PlayerQuickEditInput>(emptyForm);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !playerId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    adminApi
      .getPlayerQuickEdit(playerId)
      .then((context) => {
        if (!cancelled) setForm(contextToForm(context));
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, playerId]);

  if (!open || !playerId) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const heightRaw = form.heightCm.trim();
      const heightCm = heightRaw ? Number(heightRaw) : undefined;
      if (heightRaw && (!Number.isFinite(heightCm) || heightCm! < 100 || heightCm! > 230)) {
        throw new Error("Height must be between 100 and 230 cm");
      }

      await adminApi.quickEditPlayer(playerId, {
        heightCm,
        preferredFoot: form.preferredFoot.trim() || "",
        positionPrimary: form.positionPrimary.trim() || undefined,
        estimatedPlayerValue: form.estimatedPlayerValue.trim(),
        videoUrl: form.videoUrl.trim(),
        photosUrl: form.photosUrl.trim(),
        publicationsUrl: form.publicationsUrl.trim(),
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-sb-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="admin-sb-modal admin-sb-modal--wide"
        role="dialog"
        aria-labelledby="player-quick-edit-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="admin-sb-modal__header">
          <h2 id="player-quick-edit-title">Quick edit basic info</h2>
          <button
            type="button"
            className="admin-sb-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <form onSubmit={handleSubmit} className="admin-sb-modal__body">
          <p className="admin-sb-modal__desc">
            Update core profile fields for <strong>{playerName}</strong>. Changes apply directly
            without calibration or SIP recalculation.
          </p>

          {loading ? (
            <p className="muted">Loading player fields…</p>
          ) : (
            <div className="admin-player-profile-panel__grid">
              <label className="admin-sb-field">
                <span>Height (cm)</span>
                <input
                  type="number"
                  min={100}
                  max={230}
                  value={form.heightCm}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, heightCm: event.target.value }))
                  }
                  placeholder="178"
                />
              </label>

              <label className="admin-sb-field">
                <span>Preferred foot</span>
                <select
                  value={form.preferredFoot}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, preferredFoot: event.target.value }))
                  }
                >
                  <option value="">— Not set —</option>
                  {FOOT_OPTIONS.map((foot) => (
                    <option key={foot} value={foot}>
                      {foot}
                    </option>
                  ))}
                </select>
              </label>

              <label className="admin-sb-field">
                <span>Position</span>
                <select
                  value={form.positionPrimary}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      positionPrimary: event.target.value,
                    }))
                  }
                >
                  {POSITION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="admin-sb-field">
                <span>Estimated player value</span>
                <input
                  value={form.estimatedPlayerValue}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      estimatedPlayerValue: event.target.value,
                    }))
                  }
                  placeholder="€250K – €400K"
                />
              </label>

              <label className="admin-sb-field admin-sb-field--wide">
                <span>Video URL</span>
                <input
                  value={form.videoUrl}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, videoUrl: event.target.value }))
                  }
                  placeholder="https://youtube.com/…"
                />
              </label>

              <label className="admin-sb-field admin-sb-field--wide">
                <span>Photo URLs</span>
                <textarea
                  rows={3}
                  value={form.photosUrl}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, photosUrl: event.target.value }))
                  }
                  placeholder="One URL per line or comma-separated"
                />
              </label>

              <label className="admin-sb-field admin-sb-field--wide">
                <span>Publication URLs</span>
                <textarea
                  rows={3}
                  value={form.publicationsUrl}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      publicationsUrl: event.target.value,
                    }))
                  }
                  placeholder="Press links, one per line"
                />
              </label>
            </div>
          )}

          {error && (
            <p className="dtp-error-banner" role="alert">
              {error}
            </p>
          )}

          <footer className="admin-sb-modal__footer">
            <button type="button" className="admin-link" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="admin-inline-button admin-inline-button--primary"
              disabled={loading || saving}
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
