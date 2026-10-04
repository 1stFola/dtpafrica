import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useOutletContext } from "react-router-dom";
import { fetchVisionOverview, type VisionOverview } from "../../../api/vision";
import { useAdminAuth } from "../AdminAuthContext";

/**
 * The Vision environment: its own shell beside ScoreBoard's, with a section
 * per thing the engine does and the counts that say how much of it there is.
 * Every page under it reaches every action its API offers; the workstation
 * screens (annotation, identity, calibration) open from here but mount outside
 * the shell, because a frame-accurate video tool needs the whole viewport.
 */

const sections = [
  { to: "/admin/vision", end: true, label: "Overview", icon: "◆" },
  { to: "/admin/vision/sources", label: "Sources & rights", icon: "☰" },
  { to: "/admin/vision/footage", label: "Footage", icon: "▣" },
  { to: "/admin/vision/pipeline", label: "Pipeline", icon: "⚙" },
  { to: "/admin/vision/review", label: "Review", icon: "☑", permission: "vision.review" },
  { to: "/admin/vision/annotation", label: "Annotation", icon: "✎", permission: "vision.annotate" },
  { to: "/admin/vision/datasets", label: "Datasets", icon: "⛁" },
  { to: "/admin/vision/models", label: "Models", icon: "◉" },
  { to: "/admin/vision/events", label: "Events", icon: "⚑" },
  { to: "/admin/vision/audit", label: "Audit trail", icon: "≡", permission: "vision.audit.read" },
];

export type AdminVisionOutletContext = { overview: VisionOverview | null; refreshOverview: () => Promise<void> };

export function useAdminVisionContext() {
  return useOutletContext<AdminVisionOutletContext>();
}

export function AdminVisionLayout() {
  const { hasPermission } = useAdminAuth();
  const [overview, setOverview] = useState<VisionOverview | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshOverview = useCallback(async () => {
    setLoading(true);
    try {
      setOverview(await fetchVisionOverview());
    } catch {
      setOverview(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshOverview();
  }, [refreshOverview]);

  const visible = sections.filter((s) => (s.permission ? hasPermission(s.permission) : true));

  return (
    <div className="admin-page admin-scoreboard admin-vision">
      <header className="admin-page-header admin-sb-shell-header">
        <div>
          <nav className="admin-sb-breadcrumbs" aria-label="Breadcrumb">
            <NavLink to="/admin">Admin</NavLink>
            <span className="admin-sb-breadcrumbs__sep">/</span>
            <span>Vision</span>
          </nav>
          <h1>Vision Engine</h1>
          <p className="muted admin-sb-shell-tagline">Footage in, rights first; the pipeline, the review screens, the models, and what reaches the match record</p>
        </div>
        <div className="admin-sb-badges" aria-label="Counts" aria-busy={loading}>
          {overview ? (
            <>
              <span className={`admin-sb-badge${overview.enabled ? "" : " admin-sb-badge--off"}`}>{overview.enabled ? "enabled" : "off"}</span>
              <span className="admin-sb-badge">{overview.sources} sources</span>
              <span className="admin-sb-badge">{overview.assetsReady}/{overview.assets} footage ready</span>
              <span className="admin-sb-badge">{overview.jobsQueued} queued · {overview.jobsRunning} running</span>
              <span className="admin-sb-badge">{overview.workersActive} worker(s)</span>
            </>
          ) : loading ? (
            <span className="admin-sb-badge admin-sb-badge--skeleton">…</span>
          ) : null}
        </div>
      </header>
      <div className="admin-sb-shell">
        <aside className="admin-sb-sidebar" aria-label="Vision sections">
          <nav className="admin-sb-sidebar-nav">
            {visible.map((s) => (
              <NavLink key={s.to} to={s.to} end={s.end} className={({ isActive }) => (isActive ? "admin-sb-sidebar-link active" : "admin-sb-sidebar-link")}>
                <span className="admin-sb-sidebar-link__icon" aria-hidden="true">
                  {s.icon}
                </span>
                {s.label}
              </NavLink>
            ))}
          </nav>
        </aside>
        <div className="admin-sb-shell-main">
          <Outlet context={{ overview, refreshOverview }} />
        </div>
      </div>
    </div>
  );
}
