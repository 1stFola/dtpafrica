import { useRef, useState } from "react";
import { useAdminToast } from "../../components/AdminToast";
import { formatAdminScoreboardError } from "../admin-scoreboard-utils";

type Props = {
  label: string;
  hint: string;
  /** Resolve with a message to show it instead of the generic success toast. */
  onImport: (csv: string) => Promise<string | void>;
  onExport: () => Promise<string>;
  disabled?: boolean;
  disabledReason?: string;
  templateCsv?: string;
  templateFileName?: string;
};

function downloadTextFile(fileName: string, text: string) {
  /*
   * The byte-order mark makes Excel read the file as UTF-8, so accented names
   * (e.g. "Musa Babà") survive a round trip. Every importer strips it again.
   */
  const url = URL.createObjectURL(
    new Blob(["\uFEFF", text], { type: "text/csv;charset=utf-8" })
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  /*
   * Attached to the document, and revoked on a later tick: Firefox ignores a
   * click on a detached anchor, and revoking synchronously can cancel the
   * download before it has started.
   */
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function CsvDropzone({
  label,
  hint,
  onImport,
  onExport,
  disabled,
  disabledReason,
  templateCsv,
  templateFileName,
}: Props) {
  const toast = useAdminToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (file: File) => {
    if (disabled) {
      toast.error(disabledReason ?? "Select the required context before importing.");
      return;
    }
    // A second drop mid-import would start a concurrent import of the same team.
    if (busy) return;
    setBusy(true);
    try {
      const csv = await file.text();
      const message = await onImport(csv);
      toast.success(message || `Imported ${file.name}`);
    } catch (e) {
      toast.error(formatAdminScoreboardError(e));
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    setBusy(true);
    try {
      const csv = await onExport();
      downloadTextFile(`${label.toLowerCase().replace(/\s+/g, "-")}.csv`, csv);
      toast.success("Export downloaded");
    } catch (e) {
      toast.error(formatAdminScoreboardError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="admin-sb-dropzone admin-sb-panel"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) void handleFile(file);
      }}
    >
      <strong>{label}</strong>
      <p className="muted">{hint}</p>
      {disabled && disabledReason ? (
        <p className="admin-sb-dropzone-msg">{disabledReason}</p>
      ) : null}
      <div className="admin-sb-dropzone-actions">
        <button type="button" className="admin-inline-button" disabled={busy} onClick={exportCsv}>
          Export CSV
        </button>
        {templateCsv ? (
          <button
            type="button"
            className="admin-inline-button"
            disabled={busy}
            onClick={() => {
              downloadTextFile(
                templateFileName ?? `${label.toLowerCase().replace(/\s+/g, "-")}-template.csv`,
                templateCsv
              );
              toast.success("Template downloaded");
            }}
          >
            Template
          </button>
        ) : null}
        <button
          type="button"
          className="admin-inline-button"
          disabled={busy || disabled}
          onClick={() => inputRef.current?.click()}
        >
          Import CSV
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
  );
}
