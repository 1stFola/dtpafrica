import { useRef, useState } from "react";
import { adminScoreboardApi } from "../../../../api/admin-scoreboard";
import { useAdminToast } from "../../components/AdminToast";
import { formatAdminScoreboardError } from "../admin-scoreboard-utils";

const CSV_TEMPLATE = `event_type,minute,team_side,player_name2,player_name,assist_name,detail,home_score,away_score,narrative,pen_home,pen_away,pen_winner
full_time,,,,,,,0,1,FC OMORUYI 1-0 FC OGUNTUASE — Destiny Nosa 84',,,
kick_off,0,,,,,First half begins,,,,,
half_time,45,,,,,Half-time,,,,,
second_half_kickoff,46,,,,,Second half begins,,,,,
added_time,90,,,,,+3 minutes,,,,,
water_break,30,,,,,Drinks break,,,,,
midfield_battle,38,,,,,Midfield battle,,,,,
pressure,22,away,,,,Heavy pressure,,,,,
goal,84,away,,Destiny Nosa,,,,,,,
own_goal,50,home,,Defender,,,,,,,
goal_penalty,82,home,,No. 5,,,,,,,
chance,40,away,,David Adesanya,,Header wide,,,,,
missed_chance,58,home,,Tunde Oladejo,,,,,,,
shot_off_target,55,home,,Tunde Oladejo,Goalkeeper,,,,,,
woodwork,63,away,,David Adesanya,,,,,,,
blocked_shot,68,home,,Baare Adeyemi,Defender,,,,,,
close_chance,72,away,Goalkeeper,Destiny Nosa,,Saved,,,,,
save,72,home,Striker,Goalkeeper,,,,,,,
double_save,74,home,,Goalkeeper,,,,,,,
penalty_awarded,80,away,,,,,,,,
penalty_saved,81,home,,Goalkeeper,,,,,,,
clearance,35,home,,Jide Oluseye,Goalkeeper,,,,,,
interception,36,home,,Jide Oluseye,,,,,,,
late_defense,70,away,,Defender,,,,,,,
counter_attack,44,away,,,,,,,,
corner_kick,33,away,,,,,,,,
long_throw,29,home,,,,,,,,
offside,31,away,,,,,,,,
foul,18,home,,Shodakin Sodiq,,,,,,,
freekick,19,away,,,,Dangerous free kick,,,,,
possession,20,home,,,,Sustained spell,,,,,
substitution,46,home,,Anuoluwapo Oluwow,Korede Elejoba,#12 off #17 on,,,,,
substitution,53,away,,Ololade Yusuf,Destiny,#11 off #12 on,,,,,
yellow_card,40,away,,Ololade Yusuf,,,,,,,
red_card,77,away,,Goalkeeper,,straight red,,,,,
injury,62,home,,Player,,,,,,,
disallowed_goal,85,away,,Striker,,Offside,,,,,
score_update,84,away,,,,OMORUYI lead 1-0,,,,,
match_control,55,home,,,,Home controlling tempo,,,,,
goal_scorers_update,84,,,,,Scorers updated,,,,,
match_flow,60,,,,,Key phase,,,,,`;

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
  const [matchComment, setMatchComment] = useState("");
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
      const result = await adminScoreboardApi.ingestMatchCsv(
        matchId,
        csv,
        replace,
        matchComment.trim() || undefined
      );
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
            batch-saved, team stats are derived from events, the match is finalized, and group-stage
            standings refresh automatically.
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
              Required: one <code>full_time</code> row with <code>home_score</code> /{" "}
              <code>away_score</code>. Event types include goals, cards, subs, shots, saves,
              clearances, penalties, flow rows (<code>kick_off</code>, <code>half_time</code>,{" "}
              <code>water_break</code>, <code>midfield_battle</code>, <code>score_update</code>,
              etc.). Optional: <code>narrative</code> on the full_time row,{" "}
              <code>penalty_shootout</code> for knockouts.
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

          {csv.trim() && (
            <label className="admin-sb-field admin-sb-field--wide admin-sb-csv-ingest-comment">
              <span>Match comment</span>
              <textarea
                value={matchComment}
                onChange={(e) => setMatchComment(e.target.value)}
                rows={3}
                placeholder="Optional note about this match (e.g. context, corrections, admin remarks)"
                disabled={busy}
              />
            </label>
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
