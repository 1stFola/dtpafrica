import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { fetchVisionAssets, type VisionAssetRow } from "../../../api/vision";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useAdminAuth } from "../AdminAuthContext";
import { useAdminVisionContext } from "./AdminVisionLayout";
import { VisionConfigurationPanels } from "./AdminVisionStatusPage";
import { Panel } from "./vision-ui";
import { ANNOTATION_SCREEN_PERMISSIONS } from "./annotation-access";

/**
 * The Vision hub: what there is, what needs a person, and where each thing
 * is done. The configuration panels that used to be the whole page follow,
 * because an operator still needs to confirm which environment they are in.
 */
export function AdminVisionOverviewPage() {
  usePageTitle("Vision Engine");
  const { overview } = useAdminVisionContext();
  const { hasPermission } = useAdminAuth();
  const [assets, setAssets] = useState<VisionAssetRow[]>([]);
  const [assetStatus, setAssetStatus] = useState("loading");
  useEffect(() => {
    let active = true;
    fetchVisionAssets().then(({ assets: rows }) => {
      if (active) {
        setAssets(rows.filter((asset) => asset.hasProxy).slice(0, 6));
        setAssetStatus("ready");
      }
    }).catch(() => { if (active) setAssetStatus("error"); });
    return () => { active = false; };
  }, []);

  const tiles = overview
    ? [
        { to: "/admin/vision/sources", label: "Sources & rights", count: overview.sources, note: `${overview.partners} partner(s). Register a partner and its sources, attach rights evidence, grant scopes, authorise acquisition.` },
        { to: "/admin/vision/footage", label: "Footage", count: overview.assets, note: `${overview.assetsReady} ready. Every copy under DTP control, where each is in the pipeline, and the screens that open on it.` },
        { to: "/admin/vision/pipeline", label: "Pipeline", count: overview.jobsQueued + overview.jobsRunning, note: `${overview.jobsQueued} queued, ${overview.jobsRunning} running, ${overview.jobsFailed} failed; ${overview.workersActive} worker(s) alive. Retry, cancel, provision.` },
        ...(hasPermission("vision.review")
          ? [{ to: "/admin/vision/review", label: "Review queue", count: overview.reviewQueue, note: `${overview.identitiesUnreviewed} identity window(s) and ${overview.candidatesUnreviewed} event candidate(s) awaiting a second person. Each opens on the video.` }]
          : []),
        ...(hasPermission(ANNOTATION_SCREEN_PERMISSIONS) ? [{ to: "/admin/vision/annotation", label: "Annotation", count: overview.annotationOpen, note: "Open tasks. Claim a window to label, review submitted work, see the corpus mix." }] : []),
        { to: "/admin/vision/datasets", label: "Datasets", count: overview.datasets, note: "Versions, members, splits, the leakage report, freeze and export." },
        { to: "/admin/vision/models", label: "Models", count: overview.models, note: `${overview.modelsInProduction} in production. Register, benchmark, request and approve promotion, roll back.` },
        { to: "/admin/vision/events", label: "Events", count: overview.candidatesUnreviewed, note: "Candidates awaiting a second person; promotion into the match record." },
      ]
    : [];

  return (
    <div className="vision-page">
      {hasPermission("vision.review") && <Panel title="Ready to review">
        <p className="muted">Open a clip in the full-screen workstation to review identities and events.</p>
        <div className="vision-ready-clips">
          {assets.map((asset) => <article key={asset.id} className="vision-ready-clip">
            <div>
              <h3>{asset.sbMatch ? `${asset.sbMatch.homeTeam.name} vs ${asset.sbMatch.awayTeam.name}` : asset.sourceVideoRecord?.title || "Untitled footage"}</h3>
              <p className="muted">{asset.sourceVideoRecord?.title}{asset.durationMs != null ? ` · ${(asset.durationMs / 1000).toFixed(1)} seconds` : ""}</p>
              <p className="muted">{asset.counts.tracks === 0 ? "Video ready. Player tracking has not run yet." : `${asset.counts.tracks} player tracks`}</p>
            </div>
            <Link className="vision-open-review" to={`/admin/vision/workstation/identity/${asset.id}`}>Open review</Link>
          </article>)}
        </div>
        {assetStatus === "loading" && <p role="status">Loading footage…</p>}
        {assetStatus === "error" && <p role="alert">Could not load ready footage. Open Footage to try again.</p>}
        {assetStatus === "ready" && assets.length === 0 && <p className="muted">No clips are ready yet. Check Footage for processing progress.</p>}
        <Link to="/admin/vision/footage">Browse all footage →</Link>
        <p><Link to="/admin/vision/event-gold">Collect independent event references and compare scores →</Link></p>
      </Panel>}
      {overview && !overview.enabled && (
        <p className="vision-panel vision-panel--error">
          Vision is switched off on this server: `VISION_ENABLED` is not set, storage is in memory and nothing runs. The pages below read, but nothing lands.
        </p>
      )}
      <Panel title="Where things are done">
        <div className="vision-tiles">
          {tiles.map((t) => (
            <Link key={t.to} to={t.to} className="vision-tile">
              <span className="vision-tile__count">{t.count}</span>
              <span className="vision-tile__label">{t.label}</span>
              <span className="vision-tile__note muted">{t.note}</span>
            </Link>
          ))}
          {!overview && <p className="muted">Loading counts…</p>}
        </div>
        <p className="vision-footnote muted">
          Choose Open review above or beside a clip in Footage. The workstation uses the full screen; its Vision link brings you back here.
        </p>
      </Panel>
      {hasPermission("vision.jobs.run") && <VisionConfigurationPanels />}
    </div>
  );
}
