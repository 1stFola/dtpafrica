import { useEffect, useState } from "react";
import {
  adminApi,
  type AdminSeedResult,
  type AdminSeedStatus,
} from "../../../api/admin";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useAdminToast } from "../components/AdminToast";
import { AdminPageHeader } from "../components/AdminPageHeader";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function AdminDatabasePage() {
  usePageTitle("Database seed");
  const toast = useAdminToast();
  const [status, setStatus] = useState<AdminSeedStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<AdminSeedResult | null>(null);

  const loadStatus = () =>
    adminApi
      .databaseSeedStatus()
      .then(setStatus)
      .catch(() => setStatus(null));

  useEffect(() => {
    loadStatus().finally(() => setLoading(false));
  }, []);

  const handleRunSeed = async () => {
    setRunning(true);
    setConfirmOpen(false);
    try {
      const result = await adminApi.runDatabaseSeed();
      setLastResult(result);
      if (result.ok) {
        toast.success("Database seed completed");
      } else {
        toast.error("Seed finished with errors — see details below");
      }
      await loadStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Seed failed";
      toast.error(message);
      await loadStatus();
    } finally {
      setRunning(false);
    }
  };

  const displayResult = lastResult ?? status?.lastRun ?? null;

  return (
    <section className="admin-page admin-sb-section">
      <AdminPageHeader
        title="Database seed"
        description="Pull bundled seed data into the live database without SSH. Idempotent upserts — safe to re-run."
        crumbs={[{ label: "Database" }]}
      />

      <div className="admin-sb-panel sip-card">
        <h2 className="admin-sb-panel__title">Run seed on server</h2>
        <p className="muted admin-sb-panel__lead">
          Loads players, academies, scoreboard competitions, static homepage copy, blog posts,
          MVCE demo data, and legacy academy credentials from the deployed seed bundle.
        </p>

        <ul className="admin-db-warnings">
          <li>
            <strong>Ads reset:</strong> re-seeding overwrites <code>ads.config</code> — all ad
            slots return to disabled defaults.
          </li>
          <li>
            <strong>Academy passwords:</strong> legacy academy login passwords are reset to seed
            values on each run.
          </li>
          <li>
            <strong>Production only:</strong> use on live servers only when you intend to refresh
            demo and legacy content.
          </li>
        </ul>

        <div className="admin-db-actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={running || loading || status?.running}
            onClick={() => setConfirmOpen(true)}
          >
            {running || status?.running ? "Seeding…" : "Run database seed"}
          </button>
        </div>

        {loading ? (
          <p className="muted" aria-busy="true">
            Loading status…
          </p>
        ) : status?.running ? (
          <p className="admin-db-status admin-db-status--running" role="status">
            Seed in progress since {status.startedAt ? new Date(status.startedAt).toLocaleString() : "now"}…
          </p>
        ) : null}
      </div>

      {displayResult ? (
        <div className="admin-sb-panel sip-card" aria-live="polite">
          <h2 className="admin-sb-panel__title">
            {displayResult.ok ? "Last seed — success" : "Last seed — completed with errors"}
          </h2>
          <p className="muted">
            Finished {new Date(displayResult.completedAt).toLocaleString()} in{" "}
            {formatDuration(displayResult.durationMs)}
          </p>

          <div className="admin-sb-hub-stats admin-db-stats">
            <div className="admin-sb-hub-stat">
              <strong>{displayResult.counts.players}</strong>
              <span>Players (total)</span>
            </div>
            <div className="admin-sb-hub-stat">
              <strong>{displayResult.counts.academies}</strong>
              <span>Academies (total)</span>
            </div>
            <div className="admin-sb-hub-stat">
              <strong>{displayResult.counts.competitions}</strong>
              <span>Competitions</span>
            </div>
            <div className="admin-sb-hub-stat">
              <strong>{displayResult.counts.legacyPlayers}</strong>
              <span>Legacy players seeded</span>
            </div>
            <div className="admin-sb-hub-stat">
              <strong>{displayResult.counts.legacyAcademies}</strong>
              <span>Legacy academies</span>
            </div>
            <div className="admin-sb-hub-stat">
              <strong>{displayResult.counts.blogPosts}</strong>
              <span>Blog posts</span>
            </div>
          </div>

          {displayResult.legacySampleSlugs.length > 0 ? (
            <p className="muted">
              Sample profiles:{" "}
              {displayResult.legacySampleSlugs.map((slug) => `/players/${slug}`).join(", ")}
            </p>
          ) : null}

          {displayResult.errors.length > 0 ? (
            <div className="admin-db-errors" role="alert">
              <h3>Errors</h3>
              <ul>
                {displayResult.errors.map((e) => (
                  <li key={`${e.phase}-${e.message}`}>
                    <strong>{e.phase}:</strong> {e.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {confirmOpen ? (
        <div
          className="admin-sb-modal-backdrop"
          role="presentation"
          onClick={() => !running && setConfirmOpen(false)}
        >
          <div
            className="admin-sb-modal"
            role="dialog"
            aria-labelledby="seed-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="admin-sb-modal__header">
              <h2 id="seed-confirm-title">Confirm database seed</h2>
              <button
                type="button"
                className="admin-sb-modal__close"
                onClick={() => setConfirmOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </header>
            <div className="admin-sb-modal__body">
              <p>
                This will upsert all bundled seed data into the <strong>live database</strong>.
                Ad placements will reset to disabled defaults and legacy academy passwords will be
                re-applied from seed.
              </p>
              <p>Continue?</p>
            </div>
            <footer className="admin-sb-modal__footer">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setConfirmOpen(false)}
                disabled={running}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleRunSeed}
                disabled={running}
              >
                Run seed
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  );
}
