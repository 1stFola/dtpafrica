import { useRef, useState } from "react";
import { useAdminToast } from "../../components/AdminToast";
import { formatAdminScoreboardError } from "../admin-scoreboard-utils";

type Props = {
  label: string;
  hint: string;
  onImport: (csv: string) => Promise<void>;
  onExport: () => Promise<string>;
};

export function CsvDropzone({ label, hint, onImport, onExport }: Props) {
  const toast = useAdminToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (file: File) => {
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
      const url = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8" })
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `${label.toLowerCase().replace(/\s+/g, "-")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
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
      <div className="admin-sb-dropzone-actions">
        <button type="button" className="admin-inline-button" disabled={busy} onClick={exportCsv}>
          Export CSV
        </button>
        <button
          type="button"
          className="admin-inline-button"
          disabled={busy}
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
