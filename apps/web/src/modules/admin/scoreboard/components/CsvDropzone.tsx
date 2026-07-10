import { useRef, useState } from "react";
import { useAdminToast } from "../../components/AdminToast";
import { formatAdminScoreboardError } from "../admin-scoreboard-utils";

type Props = {
  label: string;
  hint: string;
  onImport: (csv: string) => Promise<void>;
  onExport: () => Promise<string>;
  disabled?: boolean;
  disabledReason?: string;
  templateCsv?: string;
  templateFileName?: string;
};

function downloadTextFile(fileName: string, text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/csv;charset=utf-8" })
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
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
    setBusy(true);
    try {
      const csv = await file.text();
      await onImport(csv);
      toast.success(`Imported ${file.name}`);
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
