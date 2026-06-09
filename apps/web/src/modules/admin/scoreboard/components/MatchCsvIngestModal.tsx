import { useRef, useState } from "react";
import { adminScoreboardApi } from "../../../../api/admin-scoreboard";
import { useAdminToast } from "../../components/AdminToast";
import { formatAdminScoreboardError } from "../admin-scoreboard-utils";

const CSV_TEMPLATE = `event_type,minute,team_side,player_name,assist_name,detail,home_score,away_score,pen_home,pen_away,pen_winner
full_time,,,,,,2,1,,,
goal,25,home,Charles Obani,,penalty,,,,
yellow_card,40,away,Amos Akinsipe,,,,,,
substitution,60,home,Player Off,Player On,,,,,
penalty_shootout,,,,,,,,4,2,home`;

type Props = {
  matchId: string;
  matchLabel: string;
  isFinished: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

export function MatchCsvIngestModal({
  matchId,
  matchLabel,
  isFinished,
  onClose,
  onSuccess,
}: Props) {
  const toast = useAdminToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setFileName(file.name);
    setCsv(await file.text());
    setError(null);
  };

  const downloadTemplate = () => {
    const url = URL.createObjectURL(
      new Blob([CSV_TEMPLATE], { type: "text/csv;charset=utf-8" })
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "match-timeline-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const previewLines = csv.trim() ? csv.trim().split(/\r?\n/).length - 1 : 0;

  const submit = async () => {
    if (!csv.trim()) {
      setError("Select or paste a CSV file first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await adminScoreboardApi.ingestMatchCsv(matchId, csv, replace);
      toast.success(
        `Imported ${result.eventsCreated} events — final score ${result.homeScore}–${result.awayScore}`
      );
      onSuccess();
      onClose();
    } catch (e) {
      const msg = formatAdminScoreboardError(e);
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-sb-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="admin-sb-modal admin-sb-modal--wide"
        role="dialog"
        aria-labelledby="csv-ingest-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="admin-sb-modal__header">
          <h2 id="csv-ingest-title">CSV match timeline</h2>
          <button
            type="button"
            className="admin-sb-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="admin-sb-modal__body">
          <p className="muted admin-sb-modal__desc">
            Upload a historical timeline for <strong>{matchLabel}</strong>. Valid rows are
            batch-saved, the match is finalized, and group-stage standings refresh automatically.
          </p>

          <div
            className="admin-sb-dropzone admin-sb-panel admin-sb-csv-ingest-dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files[0];
              if (file) void handleFile(file);
            }}
          >
            <strong>{fileName ?? "Drop CSV here or browse"}</strong>
            <p className="muted">
              Required: one <code>full_time</code> row plus event rows (goals, cards, subs).
              Optional: <code>penalty_shootout</code> row.
            </p>
            <div className="admin-sb-dropzone-actions">
              <button type="button" className="admin-inline-button" onClick={downloadTemplate}>
                Download template
              </button>
              <button
                type="button"
                className="admin-inline-button"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
              >
                Choose file
              </button>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
                e.target.value = "";
              }}
            />
          </div>

          {previewLines > 0 && (
            <p className="muted admin-sb-csv-ingest-preview">
              {previewLines} data row{previewLines === 1 ? "" : "s"} detected (excluding header).
            </p>
          )}

          {isFinished && (
            <label className="admin-sb-check">
              <input
                type="checkbox"
                checked={replace}
                onChange={(e) => setReplace(e.target.checked)}
              />
              Replace existing timeline (match already finished)
            </label>
          )}

          {error && (
            <pre className="admin-sb-error admin-sb-csv-ingest-error" role="alert">
              {error}
            </pre>
          )}
        </div>

        <footer className="admin-sb-modal__footer">
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !csv.trim()}
            onClick={() => void submit()}
          >
            {busy ? "Importing…" : "Import & finalize"}
          </button>
        </footer>
      </div>
    </div>
  );
}
