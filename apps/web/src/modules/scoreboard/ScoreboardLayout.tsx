import { NavLink, Outlet } from "react-router-dom";
import { LiveScoreRibbon } from "./components/LiveScoreRibbon";
import { AdBanner } from "../../components/AdBanner";
import { ModuleAdRails } from "../../components/ModuleAdRails";
import { creativeSizeLabel } from "../../config/adFormatSpecs";
import { useAdSlot } from "../../context/AdConfigContext";

/** Header mobile banner only; desktop top uses `scoreboardTop` in ModuleAdRails */

const links = [
  { to: "/scoreboard", end: true, label: "Overview" },
  { to: "/scoreboard/live", label: "Live" },
  { to: "/scoreboard/browse", label: "Browse" },
  { to: "/scoreboard/competition/jagaban-cup-2026", label: "Jagaban Cup" },
  { to: "/scoreboard/highlights", label: "Highlights" },
  { to: "/scoreboard/supervisor", label: "Supervisor" },
];

export function ScoreboardLayout() {
  const mobileAd = useAdSlot("scoreboardLeaderboardMobile");

  return (
    <div className="scoreboard-module">
      <header className="scoreboard-header">
        <h1>ScoreBoard</h1>
        <p className="muted">Live matches, standings, highlights, and operator tools</p>
        <LiveScoreRibbon />
        {mobileAd && (
          <div className="ad-placement ad-placement--scoreboard ad-placement--scoreboard-header-mobile">
            <AdBanner
              {...mobileAd}
              sizeHint={
                import.meta.env.DEV
                  ? `Recommended creative: ${creativeSizeLabel(mobileAd.format)}`
                  : undefined
              }
            />
          </div>
        )}
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
      <ModuleAdRails
        topSlot="scoreboardTop"
        leftSlot="scoreboardLeft"
        rightSlot="scoreboardRight"
      >
        <Outlet />
      </ModuleAdRails>
    </div>
  );
}
