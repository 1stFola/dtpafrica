import { Link } from "react-router-dom";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useAdminVisionContext } from "./AdminVisionLayout";
import { VisionConfigurationPanels } from "./AdminVisionStatusPage";
import { Panel } from "./vision-ui";

/**
 * The Vision hub: what there is, what needs a person, and where each thing
 * is done. The configuration panels that used to be the whole page follow,
 * because an operator still needs to confirm which environment they are in.
 */
export function AdminVisionOverviewPage() {
  usePageTitle("Vision Engine");
  const { overview } = useAdminVisionContext();

  const tiles = overview
    ? [
        { to: "/admin/vision/sources", label: "Sources & rights", count: overview.sources, note: `${overview.partners} partner(s). Register a partner and its sources, attach rights evidence, grant scopes, authorise acquisition.` },
        { to: "/admin/vision/footage", label: "Footage", count: overview.assets, note: `${overview.assetsReady} ready. Every copy under DTP control, where each is in the pipeline, and the screens that open on it.` },
        { to: "/admin/vision/pipeline", label: "Pipeline", count: overview.jobsQueued + overview.jobsRunning, note: `${overview.jobsQueued} queued, ${overview.jobsRunning} running, ${overview.jobsFailed} failed; ${overview.workersActive} worker(s) alive. Retry, cancel, provision.` },
        { to: "/admin/vision/annotation", label: "Annotation", count: overview.annotationOpen, note: "Open tasks. Claim a window to label, review submitted work, see the corpus mix." },
        { to: "/admin/vision/datasets", label: "Datasets", count: overview.datasets, note: "Versions, members, splits, the leakage report, freeze and export." },
        { to: "/admin/vision/models", label: "Models", count: overview.models, note: `${overview.modelsInProduction} in production. Register, benchmark, request and approve promotion, roll back.` },
        { to: "/admin/vision/events", label: "Events", count: overview.candidatesUnreviewed, note: "Candidates awaiting a second person; promotion into the match record." },
      ]
    : [];

  return (
    <div className="vision-page">
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
          The review screens open from Footage: the annotation workstation from a task, the identity review and the calibration editor from an asset with a proxy.
          Footage arrives through <code className="vision-mono">pnpm --filter @dtp/api vision:upload</code> from any machine, or a partner's upload link from a source.
        </p>
      </Panel>
      <VisionConfigurationPanels />
    </div>
  );
}
