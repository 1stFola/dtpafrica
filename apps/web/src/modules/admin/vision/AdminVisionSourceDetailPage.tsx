import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  authorizeVisionAcquisition,
  fetchVisionJobs,
  fetchVisionSource,
  fetchVisionSourceImpact,
  grantVisionScope,
  issueVisionUploadGrant,
  queueVisionJob,
  revokeVisionScope,
  type VisionJobRow,
  type VisionScopeKey,
  type VisionSourceDetail,
} from "../../../api/vision";
import { STAGES, canQueue, describeRun, latestByType, missingFor, nextStage, succeededTypes } from "./pipeline";
import { AdminPageHeader } from "../components/AdminPageHeader";
import { useAdminAuth } from "../AdminAuthContext";
import { usePageTitle } from "../../../hooks/usePageTitle";

/**
 * One source, and everything the rights engine thinks about it.
 *
 * The four scopes are shown as what the engine actually *decides*, not as the rows
 * that exist — a live grant that is expired, restricted or overridden by a
 * player-level withdrawal would otherwise look like permission.
 */

const SCOPES: { key: VisionScopeKey; label: string; what: string }[] = [
  { key: "canAnalyze", label: "Analyze", what: "Run models over this footage internally" },
  { key: "canTrain", label: "Train", what: "Use it to train models" },
  { key: "canPublishHighlight", label: "Publish", what: "Show derived clips publicly" },
  { key: "canShareWithScout", label: "Share with scouts", what: "Disclose evidence to third parties" },
];

const ACQUISITION_METHODS = [
  { value: "partner_direct_upload", label: "Partner uploads it themselves" },
  { value: "partner_authorized_export", label: "Owner supplied an export" },
  { value: "platform_copy_authorized", label: "Platform copy, authorized in writing" },
];

function formatDuration(ms: number | null): string {
  if (!ms) return "—";
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

export function AdminVisionSourceDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { hasPermission } = useAdminAuth();
  const canManageRights = hasPermission("vision.rights.manage");

  const [detail, setDetail] = useState<VisionSourceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [issuedToken, setIssuedToken] = useState<{ token: string; expiresAt: string } | null>(null);
  const [impact, setImpact] = useState<Awaited<ReturnType<typeof fetchVisionSourceImpact>> | null>(null);
  /* The pipeline per asset: its jobs, and the stage picked to queue next. */
  const [jobsByAsset, setJobsByAsset] = useState<Record<string, VisionJobRow[]>>({});
  const [stagePick, setStagePick] = useState<Record<string, string>>({});

  const [method, setMethod] = useState(ACQUISITION_METHODS[0]!.value);
  const [signatoryId, setSignatoryId] = useState("");
  const [pending, setPending] = useState<Record<VisionScopeKey, boolean>>({
    canAnalyze: false,
    canTrain: false,
    canPublishHighlight: false,
    canShareWithScout: false,
  });

  usePageTitle(detail?.source.title ?? "Vision source");

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await fetchVisionSource(id);
      setDetail(data);
      setSignatoryId((current) => current || data.source.partner.signatories[0]?.id || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load source");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  /* Jobs are fetched per asset after the source loads, and again after every
     action, so a queued job shows up where it was queued. */
  const loadJobs = useCallback(async (assetIds: string[]) => {
    const entries = await Promise.all(
      assetIds.map(async (assetId) => {
        try {
          return [assetId, (await fetchVisionJobs(assetId)).jobs] as const;
        } catch {
          return [assetId, []] as const;
        }
      })
    );
    setJobsByAsset(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    if (!detail) return;
    void loadJobs(detail.source.videoAssets.map((a) => a.id));
  }, [detail, loadJobs]);

  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      await action();
      setNotice(label);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  if (error && !detail) {
    return (
      <div className="admin-sb-page vision-page">
        <AdminPageHeader title="Vision source" crumbs={[{ label: "Vision", to: "/admin/vision" }]} />
        <div className="vision-panel vision-panel--error">
          <strong>Could not load this source.</strong>
          <p className="muted">{error}</p>
        </div>
      </div>
    );
  }

  if (!detail) return <p className="muted">Loading…</p>;

  const { source, decisions } = detail;
  const evidenceCount = source.partner.evidence.length;
  const liveScopes = [...source.partner.rightsScopes, ...source.rightsScopes].filter(
    (s) => !s.revokedAt
  );

  return (
    <div className="admin-sb-page vision-page">
      <AdminPageHeader
        title={source.title ?? "Untitled source"}
        description={`${source.partner.name} · ${source.sourceQualityRank.replace(/_/g, " ")}`}
        crumbs={[
          { label: "Vision", to: "/admin/vision" },
          { label: "Sources", to: "/admin/vision/sources" },
          { label: source.title ?? "Source" },
        ]}
      />

      {notice && (
        <div className="vision-panel vision-panel--ok">
          <strong>{notice}</strong>
        </div>
      )}
      {error && (
        <div className="vision-panel vision-panel--error">
          <p className="muted">{error}</p>
        </div>
      )}

      {/* The rights position, as the engine decides it. */}
      <section className="vision-panel">
        <h2 className="vision-panel__title">Rights</h2>
        {evidenceCount === 0 && (
          <p className="vision-warn">
            No rights evidence is attached for {source.partner.name}. Nothing can be acquired or
            analysed until the signed agreement is on file.
          </p>
        )}
        <table className="vision-table">
          <thead>
            <tr>
              <th scope="col">Scope</th>
              <th scope="col">Decision</th>
              <th scope="col">Why</th>
            </tr>
          </thead>
          <tbody>
            {SCOPES.map(({ key, label, what }) => {
              const decision = decisions[key];
              return (
                <tr key={key}>
                  <td>
                    {label}
                    <div className="muted vision-sub">{what}</div>
                  </td>
                  <td>
                    <span
                      className={
                        decision.allowed ? "vision-state vision-state--on" : "vision-state vision-state--off"
                      }
                    >
                      {decision.allowed ? "✓ Granted" : "• Not granted"}
                    </span>
                  </td>
                  <td className="muted">
                    {decision.allowed
                      ? `${decision.grantLevel}-level grant${
                          decision.expiresAt
                            ? `, expires ${new Date(decision.expiresAt).toLocaleDateString()}`
                            : ""
                        }`
                      : decision.remediation}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {canManageRights && (
          <div className="vision-actions">
            <fieldset className="vision-fieldset">
              <legend>Grant at partner level</legend>
              {SCOPES.map(({ key, label }) => (
                <label key={key} className="vision-check">
                  <input
                    type="checkbox"
                    checked={pending[key]}
                    onChange={(e) => setPending((p) => ({ ...p, [key]: e.target.checked }))}
                  />
                  {label}
                </label>
              ))}
              <button
                type="button"
                className="admin-btn"
                disabled={busy || !Object.values(pending).some(Boolean) || evidenceCount === 0}
                onClick={() =>
                  run("Grant recorded.", async () => {
                    await grantVisionScope({
                      partnerId: source.partner.id,
                      ...pending,
                      evidenceId: source.partner.evidence[0]?.id,
                    });
                    setPending({
                      canAnalyze: false,
                      canTrain: false,
                      canPublishHighlight: false,
                      canShareWithScout: false,
                    });
                  })
                }
              >
                Grant
              </button>
            </fieldset>
          </div>
        )}

        {liveScopes.length > 0 && (
          <>
            <h3 className="vision-subhead">Live grants</h3>
            <table className="vision-table">
              <thead>
                <tr>
                  <th scope="col">Level</th>
                  <th scope="col">Scopes</th>
                  <th scope="col">Expires</th>
                  {canManageRights && <th scope="col">&nbsp;</th>}
                </tr>
              </thead>
              <tbody>
                {liveScopes.map((scope) => (
                  <tr key={scope.id}>
                    <td>{scope.grantLevel}</td>
                    <td className="muted">
                      {SCOPES.filter(({ key }) => scope[key]).map(({ label }) => label).join(", ") ||
                        "none"}
                    </td>
                    <td className="muted">
                      {scope.expiresAt ? new Date(scope.expiresAt).toLocaleDateString() : "no expiry"}
                    </td>
                    {canManageRights && (
                      <td>
                        <button
                          type="button"
                          className="admin-btn admin-btn--danger"
                          disabled={busy}
                          onClick={() => {
                            const reason = window.prompt(
                              "Why is this grant being withdrawn? Every future rights check fails immediately."
                            );
                            if (!reason) return;
                            void run("Grant withdrawn. Future checks now fail.", () =>
                              revokeVisionScope(scope.id, reason)
                            );
                          }}
                        >
                          Withdraw
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      {/* Acquisition */}
      <section className="vision-panel">
        <h2 className="vision-panel__title">Acquisition</h2>
        <p className="muted vision-footnote">
          Status: <strong>{source.acquisitionStatus}</strong>
          {source.acquisitionMethod ? ` · ${source.acquisitionMethod.replace(/_/g, " ")}` : ""}
          {source.authorizedBy
            ? ` · approved by ${source.authorizedBy.name} (${source.authorizedBy.role})`
            : ""}
        </p>

        {source.acquisitionStatus === "catalogued" && canManageRights && (
          <div className="vision-actions">
            <fieldset className="vision-fieldset">
              <legend>Authorize acquisition</legend>
              <label>
                <span>How was the copy obtained?</span>
                <select value={method} onChange={(e) => setMethod(e.target.value)}>
                  {ACQUISITION_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Who at {source.partner.name} approved it?</span>
                <select value={signatoryId} onChange={(e) => setSignatoryId(e.target.value)}>
                  <option value="">Select a signatory</option>
                  {source.partner.signatories.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} — {s.role}
                    </option>
                  ))}
                </select>
              </label>
              {source.partner.signatories.length === 0 && (
                <p className="vision-warn">
                  No authorized signatory recorded for this partner. An acquisition needs a name
                  behind it.
                </p>
              )}
              <button
                type="button"
                className="admin-btn"
                disabled={busy || !signatoryId}
                onClick={() =>
                  run("Acquisition authorized.", () =>
                    authorizeVisionAcquisition(source.id, {
                      acquisitionMethod: method,
                      signatoryId,
                    })
                  )
                }
              >
                Authorize
              </button>
            </fieldset>
          </div>
        )}

        {source.acquisitionStatus !== "catalogued" &&
          source.acquisitionStatus !== "refused" &&
          canManageRights && (
            <div className="vision-actions">
              <button
                type="button"
                className="admin-btn"
                disabled={busy}
                onClick={() =>
                  run("Upload link issued.", async () => {
                    const grant = await issueVisionUploadGrant(source.id, { expiresInHours: 72 });
                    setIssuedToken({ token: grant.token, expiresAt: grant.expiresAt });
                  })
                }
              >
                Issue partner upload link
              </button>
              <p className="muted vision-footnote">
                A single-use link for a partner with no DTP account. Shown once — DTP stores only its
                hash and cannot recover it.
              </p>
            </div>
          )}

        {issuedToken && (
          <div className="vision-panel vision-panel--ok vision-token">
            <strong>Send this to {source.partner.name}. It will not be shown again.</strong>
            <code className="vision-token__value">{issuedToken.token}</code>
            <p className="muted">
              Expires {new Date(issuedToken.expiresAt).toLocaleString()} · one upload only
            </p>
          </div>
        )}

        {source.uploadGrants.length > 0 && (
          <p className="muted vision-footnote">
            {source.uploadGrants.filter((g) => g.usedAt).length} of {source.uploadGrants.length} link(s)
            used.
          </p>
        )}
      </section>

      {/* Copies under DTP control: each asset, its pipeline, and the screens that open on it. */}
      <section className="vision-panel">
        <h2 className="vision-panel__title">Copies under DTP control</h2>
        {source.videoAssets.length === 0 ? (
          <p className="muted">
            None. This source is a reference only, and cannot enter a dataset. Upload footage with
            <code className="vision-mono"> pnpm --filter @dtp/api vision:upload -- --source {source.id} --file …</code>
          </p>
        ) : (
          <div className="vision-assets">
            {source.videoAssets.map((asset) => {
              const jobs = jobsByAsset[asset.id] ?? [];
              const latest = latestByType(jobs);
              const done = succeededTypes(jobs);
              const next = nextStage(jobs);
              const picked = stagePick[asset.id] ?? next?.type ?? STAGES[0]!.type;
              const stage = STAGES.find((s) => s.type === picked) ?? STAGES[0]!;
              const missing = missingFor(stage, done);
              const hasProxy = asset.variants.some((v) => v.kind === "proxy") || done.has("transcode");
              return (
                <article key={asset.id} className="vision-asset">
                  <header className="vision-asset__head">
                    <div>
                      <strong>{asset.ingestState}</strong>
                      <span className="muted"> · {asset.videoCodec ?? "codec unknown"} · {formatDuration(asset.durationMs)} · {asset.duplicateClusterId ? "grouped with a re-upload" : "unique so far"}</span>
                      {asset.ingestError && <div className="vision-warn vision-sub">{asset.ingestError}</div>}
                    </div>
                    <code className="vision-mono vision-asset__id" title="Asset id">{asset.id}</code>
                  </header>

                  <div className="vision-asset__links">
                    <Link to={`/admin/vision/workstation/identity/${asset.id}`} className={hasProxy ? "" : "vision-link--dim"}>
                      Identity review →
                    </Link>
                    <Link to={`/admin/vision/workstation/calibration/${asset.id}`} className={hasProxy ? "" : "vision-link--dim"}>
                      Calibration editor →
                    </Link>
                    {!hasProxy && <span className="vision-footnote">both screens need the proxy: transcode first</span>}
                  </div>

                  <table className="vision-table vision-asset__stages">
                    <tbody>
                      {STAGES.map((s) => {
                        const run = latest.get(s.type);
                        return (
                          <tr key={s.type}>
                            <th scope="row">{s.label}</th>
                            <td className={run?.state === "failed" ? "vision-warn" : run?.state === "succeeded" ? "" : "muted"}>{describeRun(run)}</td>
                            <td className="muted vision-sub">{s.where === "gpu" ? "GPU" : "CPU"} · {s.note}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  <div className="vision-asset__queue">
                    <label className="vision-row">
                      <span className="vision-row__label">Queue</span>
                      <select value={picked} onChange={(e) => setStagePick((p) => ({ ...p, [asset.id]: e.target.value }))} disabled={busy}>
                        {STAGES.map((s) => (
                          <option key={s.type} value={s.type}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      disabled={busy || !canQueue(stage, done)}
                      onClick={() =>
                        run(`${stage.label} queued on ${asset.id.slice(0, 8)}.`, async () => {
                          await queueVisionJob({ type: stage.type, videoAssetId: asset.id });
                          await loadJobs(source.videoAssets.map((a) => a.id));
                        })
                      }
                    >
                      Queue {stage.label.toLowerCase()}
                    </button>
                    <span className="vision-footnote">
                      {missing ? `needs ${missing.join(", ")} to succeed first` : next?.type === stage.type ? "the next stage in order" : "prerequisites met"}
                      {" · the API refuses a stage out of order; the worker runs it"}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Blast radius, before acting rather than after. */}
      <section className="vision-panel">
        <h2 className="vision-panel__title">Revocation impact</h2>
        {impact ? (
          <>
            <p className="muted vision-footnote">
              {impact.assets} copy/copies · {impact.variants} derived file(s) · {impact.jobs} job(s) ·{" "}
              {impact.duplicateClusters} duplicate cluster(s) · {impact.liveScopes} live grant(s)
            </p>
            {impact.datasetVersions.length > 0 && (
              <p className="vision-warn">
                Used by {impact.datasetVersions.length} dataset version(s):{" "}
                {impact.datasetVersions.map((d) => `${d.label}${d.frozen ? " (frozen)" : ""}`).join(", ")}
              </p>
            )}
            <p className="muted vision-footnote">{impact.note}</p>
          </>
        ) : (
          <button
            type="button"
            className="admin-btn"
            disabled={busy}
            onClick={() =>
              run("Impact calculated.", async () => setImpact(await fetchVisionSourceImpact(source.id)))
            }
          >
            What breaks if this is revoked?
          </button>
        )}
      </section>

      <p className="muted vision-footnote">
        <Link to="/admin/vision/sources">← All sources</Link>
      </p>
    </div>
  );
}
