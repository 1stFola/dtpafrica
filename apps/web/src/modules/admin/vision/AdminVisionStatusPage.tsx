import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchVisionStatus, type VisionStatus } from "../../../api/vision";
import { AdminPageHeader } from "../components/AdminPageHeader";
import { usePageTitle } from "../../../hooks/usePageTitle";

/**
 * Vision Engine — Phase 0 status.
 *
 * Read-only. Phase 0 built the foundation (rights, storage, compute, RBAC) and
 * no operational surface yet; this page is how an operator confirms what the
 * server is actually configured with. The ingestion wizard, job dashboard and
 * review workstation arrive in Phase 1 — docs/vision/08-FRONTEND.md.
 */

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MiB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${bytes} B`;
}

function formatHours(hours: number): string {
  if (hours % 24 === 0) return `${hours / 24} day${hours === 24 ? "" : "s"}`;
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function Row({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <div className="vision-row">
      <div className="vision-row__label">{label}</div>
      <div className="vision-row__value">{value}</div>
      {note && <div className="vision-row__note muted">{note}</div>}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="vision-panel">
      <h2 className="vision-panel__title">{title}</h2>
      {children}
    </section>
  );
}

/** Text as well as colour, so state is never carried by colour alone. */
function State({ ok, on, off }: { ok: boolean; on: string; off: string }) {
  return (
    <span className={ok ? "vision-state vision-state--on" : "vision-state vision-state--off"}>
      {ok ? "✓ " : "• "}
      {ok ? on : off}
    </span>
  );
}

export function AdminVisionStatusPage() {
  usePageTitle("Vision Engine");
  const [status, setStatus] = useState<VisionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchVisionStatus()
      .then((data) => {
        if (!cancelled) setStatus(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load status");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="admin-sb-page vision-page">
      <AdminPageHeader
        title="Vision Engine"
        description="Football video intelligence. Phase 0 — foundation, rights and provider abstractions."
        crumbs={[{ label: "Vision" }]}
      />

      {error && (
        <div className="vision-panel vision-panel--error">
          <strong>Could not load Vision status.</strong>
          <p className="muted">{error}</p>
        </div>
      )}

      {!status && !error && <p className="muted">Loading…</p>}

      {status && (
        <>
          <Panel title="Operations">
            <p className="muted vision-footnote">
              <Link to="/admin/vision/sources">Partner sources →</Link> Catalogue matches, attach
              rights evidence, authorize acquisition and issue partner upload links.
            </p>
            <p className="muted vision-footnote">
              <Link to="/admin/vision/annotation">Annotation queue →</Link> Claim a window to
              label, review submitted work, and see what the corpus is actually made of.
            </p>
          </Panel>

          <Panel title="Subsystem">
            <Row
              label="Status"
              value={
                <State
                  ok={status.enabled}
                  on="Enabled"
                  off="Disabled — set VISION_ENABLED to turn it on"
                />
              }
              note="Off by default, so deploying the module changes nothing until someone enables it."
            />
            <Row label="Phase" value={`Phase ${status.phase}`} />
            <Row label="Contract version" value={status.contractVersion} />
          </Panel>

          <Panel title="Object storage">
            <Row label="Backend" value={status.storage.backend} />
            <Row
              label="Credentials"
              value={
                <State
                  ok={status.storage.credentialsConfigured}
                  on="Configured"
                  off="Not configured"
                />
              }
              note="The server never returns the credentials themselves."
            />
            <div className="vision-buckets">
              {Object.entries(status.storage.buckets).map(([id, name]) => (
                <div key={id} className="vision-bucket">
                  <span className="vision-bucket__id">{id}</span>
                  <span className={name ? "vision-bucket__name" : "vision-bucket__name muted"}>
                    {name ?? "not set"}
                  </span>
                </div>
              ))}
            </div>
            <p className="muted vision-footnote">
              Four buckets split by access and retention policy: <code>master</code> is write-once
              and versioned, <code>derived</code> is regenerable, <code>models</code> outlives
              everything, <code>clips</code> is what gets served outward.
            </p>
          </Panel>

          <Panel title="Upload">
            <Row
              label="Part size"
              value={formatBytes(status.upload.partBytes)}
              note="Small enough that a lost part is cheap to retry on an unstable connection."
            />
            <Row
              label="Session lifetime"
              value={formatHours(status.upload.sessionTtlHours)}
              note="A partner may resume an interrupted upload across several days."
            />
            <Row label="Part URL lifetime" value={`${status.upload.partUrlTtlSeconds}s`} />
            <Row
              label="Playback URL lifetime"
              value={`${status.playback.urlTtlSeconds}s`}
              note="An issued URL is not a standing grant."
            />
          </Panel>

          <Panel title="Jobs">
            <Row
              label="Heartbeat"
              value={`every ${status.jobs.heartbeatIntervalSeconds}s, reaped after ${status.jobs.missedHeartbeatsBeforeExpiry} missed`}
            />
            <Row label="Worker token lifetime" value={formatHours(status.jobs.workerTokenTtlHours)} />
            <Row
              label="Default job budget"
              value={`${status.jobs.defaultBudgetSeconds}s / ${formatUsd(status.jobs.defaultBudgetUsdCents)}`}
              note="Budgets are mandatory: an idle GPU pod nobody noticed is the commonest overspend."
            />
          </Panel>

          <Panel title="Compute">
            <Row label="Default provider" value={status.compute.defaultProvider} />
            <Row label="Worker image" value={<code>{status.compute.workerImage}</code>} />
            <Row
              label="Monthly budget"
              value={formatUsd(status.compute.monthlyBudgetUsdCents)}
              note="New capacity is refused past this; queued jobs wait and the dashboard alerts."
            />
            <table className="vision-table">
              <thead>
                <tr>
                  <th scope="col">Provider</th>
                  <th scope="col">Resource classes</th>
                  <th scope="col">Max workers</th>
                  <th scope="col">Production</th>
                </tr>
              </thead>
              <tbody>
                {status.compute.providers.map((p) => (
                  <tr key={p.providerId}>
                    <td>{p.providerId}</td>
                    <td className="muted">{p.resourceClasses.join(", ")}</td>
                    <td>{p.maxConcurrentWorkers}</td>
                    <td>
                      <State ok={p.productionApproved} on="Approved" off="Experiments only" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted vision-footnote">
              Phase 0 has no production-approved provider by design. Hosted capacity arrives in
              Phase 1, and work whose output could reach a dataset or a published fact is refused
              on experiment-only hardware.
            </p>
          </Panel>

          <Panel title="Policy defaults">
            <Row
              label="On withdrawal"
              value={
                status.policy.takedownUnpublishImmediate
                  ? `Unpublish immediately, delete derived media within ${status.policy.takedownDeleteWithinDays} days`
                  : `Delete derived media within ${status.policy.takedownDeleteWithinDays} days`
              }
            />
            <Row
              label="Data-subject request"
              value={`acknowledge in ${status.policy.dataSubjectAckWithinDays} days, complete in ${status.policy.dataSubjectCompleteWithinDays} days`}
            />
            <Row
              label="Derived media retention"
              value={`${status.policy.derivedMediaRetentionMonths} months from last use`}
            />
            <p className="muted vision-footnote">
              Working defaults pending counsel confirmation. These are configuration values, so
              changing them is a config change rather than a redesign.
            </p>
          </Panel>
        </>
      )}
    </div>
  );
}
