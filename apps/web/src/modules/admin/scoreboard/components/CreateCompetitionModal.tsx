import { useCallback, useEffect, useState } from "react";
import { adminScoreboardApi } from "../../../../api/admin-scoreboard";
import { formatAdminScoreboardError } from "../admin-scoreboard-utils";
import type {
  CompetitionFormat,
  CompetitionTemplatePreview,
} from "../types";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
};

const FORMAT_ORDER: CompetitionFormat[] = [
  "JAGABAN_CUP_STANDARD",
  "STANDARD_LEAGUE",
  "KNOCKOUT_CUP",
  "HYBRID_CHAMPIONS_LEAGUE",
  "SINGLE_FRIENDLY_MATCH",
  "COMBINATION_TOURNAMENT",
  "CHALLENGE_LADDER",
];

export function CreateCompetitionModal({ open, onClose, onCreated }: Props) {
  const [templates, setTemplates] = useState<CompetitionTemplatePreview[]>([]);
  const [formatType, setFormatType] = useState<CompetitionFormat>("JAGABAN_CUP_STANDARD");
  const [preview, setPreview] = useState<CompetitionTemplatePreview | null>(null);
  const [name, setName] = useState("");
  const [season, setSeason] = useState(String(new Date().getFullYear()));
  const [teamNames, setTeamNames] = useState("");
  const [generateFixtures, setGenerateFixtures] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    adminScoreboardApi.listTemplates().then(setTemplates).catch(() => {});
  }, [open]);

  const loadPreview = useCallback((format: CompetitionFormat) => {
    adminScoreboardApi.previewTemplate(format).then(setPreview).catch(() => setPreview(null));
  }, []);

  useEffect(() => {
    if (!open) return;
    loadPreview(formatType);
  }, [open, formatType, loadPreview]);

  if (!open) return null;

  const selected = templates.find((t) => t.format === formatType) ?? preview;
  const isSkeleton = selected?.implementationStatus === "skeleton";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const teams = teamNames
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line, i) => {
          const [n, group] = line.split("|").map((s) => s.trim());
          const jagabanGroups = ["A", "B"];
          const groupKey =
            group ||
            (formatType === "JAGABAN_CUP_STANDARD"
              ? jagabanGroups[Math.floor(i / 4) % 2]
              : undefined);
          return { name: n, groupKey };
        });

      await adminScoreboardApi.createFromTemplate({
        name,
        season,
        formatType,
        teams: teams.length ? teams : undefined,
        generateFixtures: teams.length >= 2 ? generateFixtures && !isSkeleton : false,
        isPublished: false,
      });
      onCreated();
      onClose();
      setName("");
      setTeamNames("");
    } catch (err) {
      setError(formatAdminScoreboardError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-sb-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="admin-sb-modal admin-sb-modal--wide"
        role="dialog"
        aria-labelledby="create-comp-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="admin-sb-modal__header">
          <h2 id="create-comp-title">Create competition</h2>
          <button type="button" className="admin-sb-modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <form onSubmit={handleSubmit} className="admin-sb-modal__body">
          <fieldset className="admin-sb-template-picker">
            <legend className="admin-sb-template-picker__legend">Template</legend>
            <div className="admin-sb-template-grid">
              {FORMAT_ORDER.map((f) => {
                const t = templates.find((x) => x.format === f);
                const active = formatType === f;
                const skeleton = t?.implementationStatus === "skeleton";
                return (
                  <button
                    key={f}
                    type="button"
                    className={
                      active
                        ? "admin-sb-template-card active"
                        : "admin-sb-template-card"
                    }
                    onClick={() => setFormatType(f)}
                  >
                    <span className="admin-sb-template-card__label">{t?.label ?? f}</span>
                    {skeleton && (
                      <span className="admin-sb-template-card__badge">Skeleton</span>
                    )}
                    <span className="admin-sb-template-card__desc">
                      {t?.category ?? "Tournament"}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          {selected && (
            <p className="muted admin-sb-modal__desc">{selected.description}</p>
          )}

          <div className="admin-sb-progression-preview">
            <h3>Progression preview</h3>
            <ol>
              {(preview?.progressionPreview ??
                selected?.progressionRules.map((r) => r.description) ??
                []
              ).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
            {preview?.stages && preview.stages.length > 0 && (
              <div className="admin-sb-stage-chips">
                {preview.stages.map((s) => (
                  <span key={s.key} className="admin-sb-stage-chip">
                    {s.name}
                  </span>
                ))}
              </div>
            )}
          </div>

          <label className="admin-sb-field">
            Competition name
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jagaban Cup 2027"
            />
          </label>

          <label className="admin-sb-field">
            Season
            <input required value={season} onChange={(e) => setSeason(e.target.value)} />
          </label>

          <label className="admin-sb-field">
            Teams (one per line, optional <code>| A</code> group suffix)
            <textarea
              rows={6}
              value={teamNames}
              onChange={(e) => setTeamNames(e.target.value)}
              placeholder={"SGFC Athletics | A\n36 Lions FC | A\n…"}
            />
          </label>

          <label className="admin-sb-check">
            <input
              type="checkbox"
              checked={generateFixtures}
              disabled={isSkeleton}
              onChange={(e) => setGenerateFixtures(e.target.checked)}
            />
            Generate fixtures on save
          </label>

          {error && <p className="admin-sb-error" role="alert">{error}</p>}

          <footer className="admin-sb-modal__footer">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
              {busy ? "Creating…" : "Create competition"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
