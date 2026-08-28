import { useEffect, useState } from "react";
import { adminScoreboardApi } from "../../../../api/admin-scoreboard";
import { ClubNameField } from "../../components/ClubNameField";
import { formatAdminScoreboardError } from "../admin-scoreboard-utils";
import type { AdminSbTeam, AdminSbTeamInput } from "../types";

type Props = {
  open: boolean;
  mode: "create" | "edit";
  team: AdminSbTeam | null;
  competitions: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSaved: () => void;
};

const emptyForm = (competitionId: string): AdminSbTeamInput => ({
  competitionId,
  name: "",
  slug: "",
  shortName: "",
  logoUrl: "",
  city: "",
  groupKey: "",
});

export function TeamFormModal({
  open,
  mode,
  team,
  competitions,
  onClose,
  onSaved,
}: Props) {
  const [form, setForm] = useState<AdminSbTeamInput>(
    emptyForm(competitions[0]?.id ?? "")
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const friendlyCompetitionId = competitions.find((competition) =>
    /friendly match/i.test(competition.name)
  )?.id;

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (mode === "edit" && team) {
      setForm({
        competitionId: team.competition.id,
        name: team.name,
        slug: team.slug,
        shortName: team.shortName ?? "",
        logoUrl: team.logoUrl ?? "",
        city: team.region ?? "",
        groupKey: team.groupKey ?? "",
      });
    } else {
      setForm(emptyForm(competitions[0]?.id ?? ""));
    }
  }, [open, mode, team, competitions]);

  if (!open) return null;

  const setField = <K extends keyof AdminSbTeamInput>(key: K, value: AdminSbTeamInput[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body: AdminSbTeamInput = {
        competitionId: form.competitionId,
        name: form.name.trim(),
        slug: form.slug?.trim() || undefined,
        shortName: form.shortName?.trim() || undefined,
        logoUrl: form.logoUrl?.trim() || undefined,
        city: form.city?.trim() || undefined,
        groupKey: form.groupKey?.trim() || undefined,
      };
      if (mode === "edit" && team) {
        await adminScoreboardApi.updateTeam(team.id, body);
      } else {
        await adminScoreboardApi.createTeam(body);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(formatAdminScoreboardError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-sb-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="admin-sb-modal"
        role="dialog"
        aria-labelledby="team-form-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="admin-sb-modal__header">
          <h2 id="team-form-title">{mode === "edit" ? "Edit team" : "Create team"}</h2>
          <button type="button" className="admin-sb-modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <form onSubmit={handleSubmit} className="admin-sb-modal__body">
          <label className="admin-sb-field">
            Competition
            <select
              required
              value={form.competitionId}
              onChange={(e) => setField("competitionId", e.target.value)}
            >
              <option value="">Select competition…</option>
              {competitions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id === friendlyCompetitionId ? "Friendly Match" : c.name}
                </option>
              ))}
            </select>
          </label>

          <ClubNameField
            label="Club name"
            value={form.name}
            onChange={(name) => setField("name", name)}
            required
          />

          <label className="admin-sb-field">
            Slug
            <input
              value={form.slug ?? ""}
              onChange={(e) => setField("slug", e.target.value)}
              placeholder="auto-generated from name if empty"
            />
          </label>

          <label className="admin-sb-field">
            Short name
            <input
              value={form.shortName ?? ""}
              onChange={(e) => setField("shortName", e.target.value)}
              placeholder="Optional crest label"
            />
          </label>

          <label className="admin-sb-field">
            Logo / crest URL
            <input
              type="url"
              value={form.logoUrl ?? ""}
              onChange={(e) => setField("logoUrl", e.target.value)}
              placeholder="https://…"
            />
          </label>

          <label className="admin-sb-field">
            Region / city
            <input
              value={form.city ?? ""}
              onChange={(e) => setField("city", e.target.value)}
              placeholder="Lagos"
            />
          </label>

          <label className="admin-sb-field">
            Group key
            <input
              value={form.groupKey ?? ""}
              onChange={(e) => setField("groupKey", e.target.value)}
              placeholder="A, B, group_a…"
            />
          </label>

          {error && (
            <p className="admin-sb-error" role="alert">
              {error}
            </p>
          )}

          <footer className="admin-sb-modal__footer">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || !form.name.trim() || !form.competitionId}
            >
              {busy ? "Saving…" : mode === "edit" ? "Save changes" : "Create team"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
