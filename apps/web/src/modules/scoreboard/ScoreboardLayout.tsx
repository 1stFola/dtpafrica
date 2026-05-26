import { NavLink, Outlet } from "react-router-dom";
import { LiveScoreRibbon } from "./components/LiveScoreRibbon";

const links = [
  { to: "/scoreboard", end: true, label: "Overview" },
  { to: "/scoreboard/live", label: "Live" },
  { to: "/scoreboard/browse", label: "Browse" },
  { to: "/scoreboard/competition/jagaban-cup-2026", label: "Jagaban Cup" },
  { to: "/scoreboard/highlights", label: "Highlights" },
  { to: "/scoreboard/supervisor", label: "Supervisor" },
];

export function ScoreboardLayout() {
  return (
    <div className="scoreboard-module">
      <header className="scoreboard-header">
        <h1>ScoreBoard</h1>
        <p className="muted">Live matches, standings, highlights, and operator tools</p>
        <LiveScoreRibbon />
        <nav className="scouting-subnav" aria-label="ScoreBoard">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                isActive ? "subnav-link active" : "subnav-link"
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <Outlet />
    </div>
  );
}
