import { NavLink, Outlet } from "react-router-dom";
import { LiveScoreRibbon } from "./components/LiveScoreRibbon";
import { AdBanner } from "../../components/AdBanner";
import { ModuleAdRails } from "../../components/ModuleAdRails";
import { creativeSizeLabel } from "../../config/adFormatSpecs";
import { useAdSlot } from "../../context/AdConfigContext";

/** Header mobile banner only; desktop top uses `scoreboardTop` in ModuleAdRails */

const links = [
  { to: "/scoreboard", end: true, label: "Overview" },
  { to: "/scoreboard/browse", label: "Competitions" },
  { to: "/scoreboard/highlights", label: "Highlights" },
  { to: "/scoreboard/live", label: "Live" },
];

export function ScoreboardLayout() {
  const mobileAd = useAdSlot("scoreboardLeaderboardMobile");

  return (
    <div className="scoreboard-module">
      <header className="scoreboard-header">
        <div className="scoreboard-brand">
          <span className="scoreboard-brand__mark">ScoreBoard</span>
          <span className="scoreboard-brand__tag">by DTP Africa</span>
        </div>
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
        <nav className="sb-subnav" aria-label="ScoreBoard">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                isActive ? "sb-subnav__link active" : "sb-subnav__link"
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
