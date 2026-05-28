import { useRef, useState } from "react";

type Props = {
  label: string;
  hint: string;
  onImport: (csv: string) => Promise<void>;
  onExport: () => Promise<string>;
};

export function CsvDropzone({ label, hint, onImport, onExport }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (file: File) => {
    setBusy(true);
    setMessage(null);
    try {
      const csv = await file.text();
      await onImport(csv);
      setMessage(`Imported ${file.name}`);
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    setBusy(true);
    setMessage(null);
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
      setMessage("Export downloaded");
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="admin-sb-dropzone"
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
      {message && <p className="admin-sb-dropzone-msg">{message}</p>}
    </div>
  );
}
