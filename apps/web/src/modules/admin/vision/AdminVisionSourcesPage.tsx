import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchVisionPartners,
  fetchVisionSources,
  type VisionPartner,
  type VisionSourceRow,
} from "../../../api/vision";
import { AdminPageHeader } from "../components/AdminPageHeader";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useDebouncedValue } from "../../../hooks/useDebouncedValue";
import { useAdminAuth } from "../AdminAuthContext";
import { VisionRegisterPanels } from "./VisionRegisterPanels";

/**
 * The Partner Video Catalog.
 *
 * Cataloguing and acquisition are separate workflows, and this screen is built to
 * make that obvious: a row here is a match that exists somewhere in the world, not
 * footage DTP holds or may use. The acquisition column is the one that matters.
 */

const STATUS_LABELS: Record<string, string> = {
  catalogued: "Catalogued only",
  authorized: "Acquisition authorized",
  acquiring: "Upload in progress",
  acquired: "Acquired",
  refused: "Refused",
};

/** Source preference order, from docs/vision/03-RIGHTS-AND-GOVERNANCE.md. */
const RANK_LABELS: Record<string, string> = {
  original_master: "Original master",
  authorized_export: "Authorized export",
  platform_copy: "Platform copy",
};

function StatusPill({ status }: { status: string }) {
  // Text carries the meaning; colour only reinforces it.
  const tone =
    status === "acquired"
      ? "is-acquired"
      : status === "refused"
        ? "is-refused"
        : status === "catalogued"
          ? "is-catalogued"
          : "is-progress";
  return <span className={`vision-pill ${tone}`}>{STATUS_LABELS[status] ?? status}</span>;
}

export function AdminVisionSourcesPage() {
  usePageTitle("Vision sources");

  const { hasPermission } = useAdminAuth();
  const [partners, setPartners] = useState<VisionPartner[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [sources, setSources] = useState<VisionSourceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [partnerId, setPartnerId] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);

  useEffect(() => {
    fetchVisionPartners()
      .then((data) => setPartners(data.partners))
      .catch(() => setPartners([]));
  }, [reloadKey]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetchVisionSources({
      partnerId: partnerId || undefined,
      acquisitionStatus: status || undefined,
      q: debouncedSearch || undefined,
    })
      .then((data) => {
        if (!cancelled) setSources(data.sources);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load sources");
      });
    return () => {
      cancelled = true;
    };
  }, [partnerId, status, debouncedSearch, reloadKey]);

  const counts = useMemo(() => {
    const rows = sources ?? [];
    return {
      total: rows.length,
      catalogued: rows.filter((s) => s.acquisitionStatus === "catalogued").length,
      acquired: rows.filter((s) => s.acquisitionStatus === "acquired").length,
    };
  }, [sources]);

  return (
    <div className="admin-sb-page vision-page">
      <AdminPageHeader
        title="Partner sources"
        description="Matches DTP knows about. Registering one grants nothing — acquisition is a separate, authorized decision."
        crumbs={[{ label: "Vision", to: "/admin/vision" }, { label: "Sources" }]}
      />

      {hasPermission("vision.sources.write") && <VisionRegisterPanels partners={partners} onChanged={() => setReloadKey((k) => k + 1)} />}

      <section className="vision-panel">
        <div className="vision-filters">
          <label>
            <span>Partner</span>
            <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
              <option value="">All partners</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p._count.videoRecords})
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Acquisition</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any status</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="vision-filters__grow">
            <span>Search</span>
            <input
              type="search"
              value={search}
              placeholder="Title or URL"
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
        {sources && (
          <p className="muted vision-footnote">
            {counts.total} shown · {counts.catalogued} catalogued only · {counts.acquired} acquired
          </p>
        )}
      </section>

      {error && (
        <div className="vision-panel vision-panel--error">
          <strong>Could not load sources.</strong>
          <p className="muted">{error}</p>
        </div>
      )}

      {!sources && !error && <p className="muted">Loading…</p>}

      {sources && sources.length === 0 && (
        <section className="vision-panel">
          <p className="muted">
            No sources match. Register one, or import a partner&rsquo;s catalogue as metadata — a URL
            is a reference, never a file DTP has fetched.
          </p>
        </section>
      )}

      {sources && sources.length > 0 && (
        <section className="vision-panel">
          <div className="admin-sb-table-wrap">
            <table className="vision-table">
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col">Partner</th>
                  <th scope="col">Source quality</th>
                  <th scope="col">Acquisition</th>
                  <th scope="col">Copies</th>
                  <th scope="col">Fixture</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((source) => (
                  <tr key={source.id}>
                    <td>
                      <Link to={`/admin/vision/sources/${source.id}`}>
                        {source.title ?? "Untitled source"}
                      </Link>
                      {source.rightsOwnerName && (
                        <div className="muted vision-sub">
                          Owner: {source.rightsOwnerName}
                        </div>
                      )}
                    </td>
                    <td>{source.partner.name}</td>
                    <td>
                      {RANK_LABELS[source.sourceQualityRank] ?? source.sourceQualityRank}
                      {source.originalAvailable && (
                        <div className="muted vision-sub">original still available</div>
                      )}
                    </td>
                    <td>
                      <StatusPill status={source.acquisitionStatus} />
                    </td>
                    <td>{source._count.videoAssets}</td>
                    <td className="muted">
                      {source.sbCompetition?.name ?? "—"}
                      {source.sbMatch?.slug ? ` · ${source.sbMatch.slug}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted vision-footnote">
            &ldquo;Copies&rdquo; counts immutable files under DTP control. A source with none is a
            reference only, and can never enter a dataset.
          </p>
        </section>
      )}
    </div>
  );
}
