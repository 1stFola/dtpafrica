import { useMemo, useRef, useState } from "react";
import type { SbMatchStats, SbTeamRef } from "../../../../api/scoreboard";
import { adminScoreboardApi } from "../../../../api/admin-scoreboard";
import { useAdminToast } from "../../components/AdminToast";
import { formatAdminScoreboardError } from "../admin-scoreboard-utils";

type StatKey =
  | "goals"
  | "shots"
  | "shotsOnTarget"
  | "shotsOffTarget"
  | "blockedShots"
  | "corners"
  | "fouls"
  | "offsides"
  | "yellowCards"
  | "redCards"
  | "saves"
  | "penaltiesAwarded";

const STAT_FIELDS: Array<{ key: StatKey; label: string }> = [
  { key: "goals", label: "Goals" },
  { key: "shots", label: "Total shots" },
  { key: "shotsOnTarget", label: "Shots on target" },
  { key: "shotsOffTarget", label: "Shots off target" },
  { key: "blockedShots", label: "Blocked shots" },
  { key: "corners", label: "Corners" },
  { key: "fouls", label: "Fouls committed" },
  { key: "offsides", label: "Offsides" },
  { key: "yellowCards", label: "Yellow cards" },
  { key: "redCards", label: "Red cards" },
  { key: "saves", label: "Saves" },
  { key: "penaltiesAwarded", label: "Penalties awarded" },
];

const CSV_HEADER =
  "match,team,goals,total_shots,shots_on_target,shots_off_target,blocked_shots,corners,fouls_committed,offsides,yellow_cards,red_cards,saves,penalty_awarded";

const CSV_ALIASES: Record<string, StatKey> = {
  goals: "goals",
  totalshots: "shots",
  shots: "shots",
  shotsontarget: "shotsOnTarget",
  sot: "shotsOnTarget",
  shotsofftarget: "shotsOffTarget",
  blockedshots: "blockedShots",
  corners: "corners",
  fouls: "fouls",
  foulscommitted: "fouls",
  offsides: "offsides",
  yellowcards: "yellowCards",
  redcards: "redCards",
  saves: "saves",
  penaltyawarded: "penaltiesAwarded",
  penaltiesawarded: "penaltiesAwarded",
};

type Props = {
  matchId: string;
  matchLabel: string;
  homeTeam: SbTeamRef;
  awayTeam: SbTeamRef;
  stats: SbMatchStats | null;
  onClose: () => void;
  onSuccess: () => void;
};

type FormState = Record<StatKey, { home: string; away: string }>;

function emptyForm(): FormState {
  return Object.fromEntries(
    STAT_FIELDS.map((field) => [field.key, { home: "", away: "" }])
  ) as FormState;
}

function formatStatValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function normalized(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function teamKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function formToPayload(form: FormState) {
  const home: Record<string, number> = {};
  const away: Record<string, number> = {};
  for (const field of STAT_FIELDS) {
    const homeValue = form[field.key].home.trim();
    const awayValue = form[field.key].away.trim();
    if (homeValue) home[field.key] = Number(homeValue);
    if (awayValue) away[field.key] = Number(awayValue);
  }
  return { home, away };
}

export function MatchStatsUpdateModal({
  matchId,
  matchLabel,
  homeTeam,
  awayTeam,
  stats,
  onClose,
  onSuccess,
}: Props) {
  const toast = useAdminToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const initialForm = useMemo(() => {
    const form = emptyForm();
    for (const field of STAT_FIELDS) {
      const value = stats?.[field.key];
      form[field.key] = {
        home: formatStatValue(value?.home),
        away: formatStatValue(value?.away),
      };
    }
    return form;
  }, [stats]);
  const [form, setForm] = useState<FormState>(initialForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setValue = (key: StatKey, side: "home" | "away", value: string) => {
    setForm((current) => ({
      ...current,
      [key]: { ...current[key], [side]: value },
    }));
  };

  const downloadTemplate = () => {
    const rows = [
      CSV_HEADER,
      `"${matchLabel}","${homeTeam.name}",,,,,,,,,,,,`,
      `"${matchLabel}","${awayTeam.name}",,,,,,,,,,,,`,
    ];
    const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "match-stats-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const applySelectedMatchCsv = (csv: string) => {
    const table = parseCsv(csv);
    if (table.length < 2) throw new Error("CSV must include a header and data rows.");
    const header = table[0].map(normalized);
    const sideIdx = header.findIndex((h) => h === "side" || h === "teamside");
    const teamIdx = header.findIndex((h) => h === "team" || h === "teamname");
    const homeKey = teamKey(homeTeam.name);
    const awayKey = teamKey(awayTeam.name);
    const next = emptyForm();

    for (const row of table.slice(1)) {
      const sideRaw = sideIdx >= 0 ? row[sideIdx]?.toLowerCase() : "";
      const rowTeam = teamIdx >= 0 ? teamKey(row[teamIdx] ?? "") : "";
      const side =
        sideRaw === "home" || sideRaw === "away"
          ? sideRaw
          : rowTeam === homeKey
            ? "home"
            : rowTeam === awayKey
              ? "away"
              : null;
      if (!side) continue;
      for (const [alias, key] of Object.entries(CSV_ALIASES)) {
        const idx = header.indexOf(alias);
        if (idx >= 0 && row[idx] !== undefined && row[idx] !== "") {
          next[key][side] = row[idx];
        }
      }
    }

    setForm(next);
  };

  const handleFile = async (file: File) => {
    setError(null);
    const csv = await file.text();
    const hasMatchColumn = parseCsv(csv)[0]?.map(normalized).some((h) =>
      ["match", "matchid", "hometeam", "awayteam"].includes(h)
    );
    if (hasMatchColumn) {
      setBusy(true);
      try {
        const result = await adminScoreboardApi.importMatchStatsCsv(csv);
        toast.success(`Updated ${result.updated} match${result.updated === 1 ? "" : "es"}`);
        onSuccess();
        onClose();
      } catch (e) {
        const msg = formatAdminScoreboardError(e);
        setError(msg);
        toast.error(msg);
      } finally {
        setBusy(false);
      }
      return;
    }

    try {
      applySelectedMatchCsv(csv);
      toast.success("CSV loaded into the form");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not parse CSV.");
    }
  };

  const submit = async () => {
    const payload = formToPayload(form);
    setBusy(true);
    setError(null);
    try {
      await adminScoreboardApi.updateMatchStats(matchId, {
        ...payload,
        source: "manual",
      });
      toast.success("Match statistics updated");
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
        aria-labelledby="match-stats-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="admin-sb-modal__header">
          <h2 id="match-stats-title">Match statistics</h2>
          <button type="button" className="admin-sb-modal__close" onClick={onClose} aria-label="Close">
            x
          </button>
        </header>

        <div className="admin-sb-modal__body">
          <p className="muted admin-sb-modal__desc">
            Update team stats for <strong>{matchLabel}</strong>. CSV rows can target this match or
            multiple matches when they include a match column.
          </p>

          <div className="admin-sb-stats-editor">
            <div className="admin-sb-stats-editor__header">
              <span>Stat</span>
              <strong>{homeTeam.shortName ?? homeTeam.name}</strong>
              <strong>{awayTeam.shortName ?? awayTeam.name}</strong>
            </div>
            {STAT_FIELDS.map((field) => (
              <div key={field.key} className="admin-sb-stats-editor__row">
                <span>{field.label}</span>
                <input
                  type="number"
                  min="0"
                  value={form[field.key].home}
                  onChange={(e) => setValue(field.key, "home", e.target.value)}
                  disabled={busy}
                  aria-label={`${homeTeam.name} ${field.label}`}
                />
                <input
                  type="number"
                  min="0"
                  value={form[field.key].away}
                  onChange={(e) => setValue(field.key, "away", e.target.value)}
                  disabled={busy}
                  aria-label={`${awayTeam.name} ${field.label}`}
                />
              </div>
            ))}
          </div>

          <div className="admin-sb-dropzone admin-sb-panel admin-sb-match-stats-upload">
            <strong>CSV upload</strong>
            <p className="muted">
              Use columns like <code>match</code>, <code>team</code>, <code>goals</code>,{" "}
              <code>total_shots</code>, <code>shots_on_target</code>, <code>corners</code>,{" "}
              <code>fouls_committed</code>, <code>offsides</code>, <code>yellow_cards</code>,{" "}
              <code>red_cards</code>, <code>saves</code>.
            </p>
            <div className="admin-sb-dropzone-actions">
              <button type="button" className="admin-inline-button" onClick={downloadTemplate}>
                Download template
              </button>
              <button
                type="button"
                className="admin-inline-button"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                Choose CSV
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              hidden
              accept=".csv,text/csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
                e.target.value = "";
              }}
            />
          </div>

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
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            {busy ? "Saving..." : "Save statistics"}
          </button>
        </footer>
      </div>
    </div>
  );
}
