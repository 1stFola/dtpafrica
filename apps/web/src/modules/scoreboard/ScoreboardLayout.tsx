import { NavLink, Outlet } from "react-router-dom";
import { BrandLogo } from "../../components/BrandLogo";
import { LiveScoreRibbon } from "./components/LiveScoreRibbon";
import { AdBanner } from "../../components/AdBanner";
import { ModuleAdRails } from "../../components/ModuleAdRails";
import { creativeSizeLabel } from "../../config/adFormatSpecs";
import { useAdSlot } from "../../context/AdConfigContext";
import { HIGH_FETCH_PRIORITY } from "../../utils/imgPriority";

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
    <div className="scoreboard-module dtp-page">
      {/* Figma "DTP" -> Scoreboard 186:139: black hero, cyan eyebrow,
          Gasoek 90px display, live ribbon and subnav beneath. */}
      <section className="dtp-hero">
        <img className="dtp-hero__media" {...HIGH_FETCH_PRIORITY} decoding="async" src="/figma/hero-scoreboard.webp" alt="" aria-hidden="true" />
        <div className="dtp-hero__scrim" aria-hidden="true" />
        <div className="dtp-shell dtp-hero__inner">
          <p className="dtp-eyebrow" style={{ color: "var(--dtp-cyan)" }}>
            Nigeria Grassroots Football
          </p>
          <h1 className="dtp-display dtp-display--hero dtp-hero__title">Scoreboard</h1>
          <NavLink to="/" className="scoreboard-brand__partner">
            <BrandLogo variant="white-horizontal" size="scoreboard" />
          </NavLink>
        </div>
      </section>

      <header className="scoreboard-header">
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
        <nav className="dtp-chips sb-subnav" aria-label="ScoreBoard">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className="dtp-chip"
              style={({ isActive }) =>
                isActive
                  ? {
                      background: "var(--dtp-cyan)",
                      borderColor: "var(--dtp-cyan)",
                      color: "var(--dtp-ink)",
                      fontWeight: 600,
                    }
                  : undefined
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
