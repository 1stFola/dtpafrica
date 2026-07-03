import { useMemo, useState } from "react";
import {
  adminApi,
  AdminApiError,
  PLAYER_STATS_CSV_HEADERS,
  type PlayerStatsExtractionResult,
} from "../../../api/admin";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { AdminPageHeader } from "../components/AdminPageHeader";

const MAX_IMAGES = 10;
const MAX_IMAGE_SIZE = 15 * 1024 * 1024;

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function parseApiError(error: unknown) {
  if (error instanceof AdminApiError) {
    try {
      const parsed = JSON.parse(error.message) as {
        message?: string | string[];
        error?: string;
      };
      if (Array.isArray(parsed.message)) return parsed.message.join(" ");
      return parsed.message || parsed.error || error.message;
    } catch {
      return error.message;
    }
  }
  return error instanceof Error ? error.message : "Extraction failed.";
}

export function AdminPlayerStatsExtractorPage() {
  usePageTitle("Player Stats Image Extractor");
  const [duration, setDuration] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<PlayerStatsExtractionResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const fileWarning = useMemo(() => {
    if (files.length > MAX_IMAGES) return `Upload a maximum of ${MAX_IMAGES} images.`;
    const invalid = files.find((file) => !file.type.startsWith("image/"));
    if (invalid) return `${invalid.name} is not an image.`;
    const oversized = files.find((file) => file.size > MAX_IMAGE_SIZE);
    if (oversized) return `${oversized.name} is larger than 15MB.`;
    return "";
  }, [files]);

  const canSubmit =
    files.length > 0 &&
    !fileWarning &&
    Number(duration) > 0 &&
    Number(duration) <= 130 &&
    !loading;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const data = await adminApi.extractPlayerStatsFromImages(duration, files);
      setResult(data);
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setLoading(false);
    }
  }

  function downloadCsv() {
    if (!result?.csv) return;
    const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `player_stats_${duration || "match"}_minutes.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="admin-page admin-player-stats admin-sb-section">
      <AdminPageHeader
        title="Player Stats Image Extractor"
        description="Upload Playermaker screenshots, extract visible metrics, normalize workload fields to 90 minutes, and export one CSV row."
        crumbs={[{ label: "Dashboard", to: "/admin" }, { label: "Player stats extractor" }]}
      />

      <form onSubmit={handleSubmit} className="admin-sb-panel admin-player-stats__form">
        <label>
          <span>Duration played</span>
          <input
            type="number"
            min="1"
            max="130"
            step="1"
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
            placeholder="72"
            required
          />
        </label>

        <label>
          <span>Playermaker screenshots</span>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            required
          />
        </label>

        {files.length > 0 && (
          <div className="admin-player-stats__file-list">
            <strong>{files.length} image(s) selected</strong>
            {files.map((file) => (
              <span key={`${file.name}-${file.size}`}>
                {file.name} - {formatBytes(file.size)}
              </span>
            ))}
          </div>
        )}

        {(fileWarning || error) && (
          <div className="dtp-error-banner">{fileWarning || error}</div>
        )}

        <button type="submit" className="admin-sb-action" disabled={!canSubmit}>
          {loading ? "Extracting..." : "Extract stats"}
        </button>
      </form>

      {result && (
        <div className="admin-sb-panel admin-player-stats__result">
          <div className="admin-player-stats__result-head">
            <div>
              <h2>CSV review</h2>
              <p className="muted">One row, ordered for the calibration import format.</p>
            </div>
            <button type="button" className="admin-sb-action" onClick={downloadCsv}>
              Download CSV
            </button>
          </div>

          {result.warnings.length > 0 && (
            <div className="admin-player-stats__warnings">
              <strong>Warnings</strong>
              {result.warnings.map((warning) => (
                <span key={warning}>{warning}</span>
              ))}
            </div>
          )}

          <div className="admin-player-stats__review-note">
            <strong>Double-check these extracted fields before importing:</strong>
            <span>
              sprint_distance, kicking_power, quick_release_score,
              left_foot_kicking_power_mph, right_foot_kicking_power_mph
            </span>
          </div>

          <div className="admin-table-wrap">
            <table className="admin-table admin-player-stats__table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {PLAYER_STATS_CSV_HEADERS.map((header) => (
                  <tr key={header}>
                    <td>{header}</td>
                    <td>{result.row[header] ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <textarea readOnly value={result.csv} className="admin-player-stats__csv" />
        </div>
      )}
    </section>
  );
}
