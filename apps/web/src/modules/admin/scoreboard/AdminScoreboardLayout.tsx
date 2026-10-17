import { NavLink, Outlet, useOutletContext } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import { adminScoreboardApi } from "../../../api/admin-scoreboard";
import { useAdminAuth } from "../AdminAuthContext";
import type { AdminSbStats } from "./types";

const subLinks = [
  { to: "/admin/scoreboard", end: true, label: "Overview", icon: "◆" },
  {
    to: "/admin/scoreboard/squads",
    label: "Squad upload",
    icon: "⇧",
    permission: "scoreboard.records.manage",
  },
  { to: "/admin/scoreboard/roster", label: "Matchday roster", icon: "☰" },
  { to: "/admin/scoreboard/match-center", label: "Match center", icon: "⏱" },
  {
    to: "/admin/scoreboard/live-streams",
    label: "Live streams",
    icon: "●",
    permission: "scoreboard.live.write",
  },
  { to: "/admin/scoreboard/highlights-manager", label: "Latest videos", icon: "▶" },
  { to: "/admin/scoreboard/highlights", label: "Match clips", icon: "⎘" },
];

export type AdminScoreboardOutletContext = {
  stats: AdminSbStats | null;
  refreshStats: () => Promise<void>;
};

export function useAdminScoreboardContext() {
  return useOutletContext<AdminScoreboardOutletContext>();
}

export function AdminScoreboardLayout() {
  const { hasPermission } = useAdminAuth();
  const [stats, setStats] = useState<AdminSbStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const visibleSubLinks = subLinks.filter((link) =>
    link.permission ? hasPermission(link.permission) : true
  );

  const refreshStats = useCallback(() => {
    setStatsLoading(true);
    return adminScoreboardApi
      .stats()
      .then(setStats)
      .finally(() => setStatsLoading(false));
  }, []);

  useEffect(() => {
    refreshStats().catch(() => setStatsLoading(false));
  }, [refreshStats]);

  return (
    <div className="admin-page admin-scoreboard">
      <header className="admin-page-header admin-sb-shell-header">
        <div>
          <nav className="admin-sb-breadcrumbs" aria-label="Breadcrumb">
            <NavLink to="/admin">Admin</NavLink>
            <span className="admin-sb-breadcrumbs__sep">/</span>
            <span>ScoreBoard</span>
          </nav>
          <h1>ScoreBoard operations</h1>
          <p className="muted admin-sb-shell-tagline">
            Competitions, rosters, live match control, and highlights
          </p>
        </div>
        <div className="admin-sb-badges" aria-label="Entity counts" aria-busy={statsLoading}>
          {statsLoading ? (
            <>
              {[1, 2, 3, 4].map((i) => (
                <span key={i} className="admin-sb-badge admin-sb-badge--skeleton">
                  <span className="admin-sb-skeleton admin-sb-skeleton--badge" />
                </span>
              ))}
            </>
          ) : stats ? (
            <>
              <span className="admin-sb-badge">{stats.competitions} comps</span>
              <span className="admin-sb-badge">{stats.teams} teams</span>
              <span className="admin-sb-badge">{stats.matches} matches</span>
              <span className="admin-sb-badge admin-sb-badge--live">
                {stats.liveMatches} live
              </span>
            </>
          ) : null}
        </div>
      </header>

      <div className="admin-sb-shell">
        <aside className="admin-sb-sidebar" aria-label="ScoreBoard sections">
          <nav className="admin-sb-sidebar-nav">
            {visibleSubLinks.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className={({ isActive }) =>
                  isActive ? "admin-sb-sidebar-link active" : "admin-sb-sidebar-link"
                }
              >
                <span className="admin-sb-sidebar-link__icon" aria-hidden="true">
                  {l.icon}
                </span>
                {l.label}
              </NavLink>
            ))}
          </nav>
        </aside>

        <div className="admin-sb-shell-main">
          <Outlet context={{ stats, refreshStats }} />
        </div>
      </div>
    </div>
  );
}
