import { NavLink, Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import { adminScoreboardApi } from "../../../api/admin-scoreboard";
import type { AdminSbStats } from "./types";

const subLinks = [
  { to: "/admin/scoreboard", end: true, label: "Overview" },
  { to: "/admin/scoreboard/entities", label: "Master records" },
  { to: "/admin/scoreboard/roster", label: "Matchday roster" },
  { to: "/admin/scoreboard/highlights", label: "Highlights" },
  { to: "/admin/scoreboard/match-center", label: "Match center" },
];

export function AdminScoreboardLayout() {
  const [stats, setStats] = useState<AdminSbStats | null>(null);

  useEffect(() => {
    adminScoreboardApi.stats().then(setStats).catch(() => {});
  }, []);

  return (
    <div className="admin-page admin-scoreboard">
      <header className="admin-page-header">
        <div>
          <h1>ScoreBoard operations</h1>
          <p className="muted">
            Entity management, roster submission, highlights, and supervisor hooks
            (migrated from legacy <code>admin-entities.html</code>,{" "}
            <code>admin-roster.html</code>, <code>admin-content.html</code>).
          </p>
        </div>
        {stats && (
          <div className="admin-sb-badges" aria-label="Live entity counts">
            <span className="admin-sb-badge">{stats.competitions} competitions</span>
            <span className="admin-sb-badge">{stats.teams} teams</span>
            <span className="admin-sb-badge">{stats.squadRows} squad rows</span>
            <span className="admin-sb-badge admin-sb-badge--live">
              {stats.liveMatches} live
            </span>
          </div>
        )}
      </header>

      <nav className="admin-sb-subnav" aria-label="ScoreBoard admin">
        {subLinks.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            className={({ isActive }) =>
              isActive ? "admin-sb-subnav-link active" : "admin-sb-subnav-link"
            }
          >
            {l.label}
          </NavLink>
        ))}
        <a href="/scoreboard/supervisor" className="admin-sb-subnav-link external">
          Public supervisor ↗
        </a>
        <a href="/spotter-tablet" className="admin-sb-subnav-link external">
          Spotter tablet ↗
        </a>
      </nav>

      <Outlet context={{ stats, refreshStats: () => adminScoreboardApi.stats().then(setStats) }} />
    </div>
  );
}
