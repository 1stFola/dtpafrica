import { NavLink, Outlet, useLocation } from "react-router-dom";
import { ModuleAdRails } from "../../components/ModuleAdRails";
import { HIGH_FETCH_PRIORITY } from "../../utils/imgPriority";

/* Figma "DTP" -> Scouting Hubs 118:1711. Black hero plate, orange eyebrow,
   Gasoek 90px display. The sub-navigation is not drawn in the frame: on the
   overview its three tool tiles are the way in, so the chips only render on
   the tool routes, where the tiles are not shown. */

const links = [
  { to: "/scouting", end: true, label: "Overview" },
  { to: "/scouting/strong-xi", label: "Strong XI" },
  { to: "/scouting/compare", label: "Compare" },
  { to: "/scouting/generate", label: "Generate" },
];

export function ScoutingLayout() {
  const { pathname } = useLocation();
  const isOverview = pathname === "/scouting" || pathname === "/scouting/";

  return (
    <div className="scouting-module dtp-page">
      <section className="dtp-hero dtp-hero--stack dtp-hero--bleed">
        <img className="dtp-hero__media" {...HIGH_FETCH_PRIORITY} decoding="async" src="/figma/hero-scouting.webp" alt="" aria-hidden="true" />
        <div className="dtp-hero__scrim" aria-hidden="true" />
        <div className="dtp-shell dtp-hero__inner">
          <p className="dtp-eyebrow">Talent Pipeline &amp; Scouting Overview</p>
          {/* Two lines, as Figma sets it; .dtp-hero__title is pre-line. */}
          <h1 className="dtp-display dtp-display--hero dtp-hero__title">{"Scouting\nHub"}</h1>
          <p className="dtp-lead dtp-hero__lead">
            Real-time target tracking, scout assignments, and performance metrics.
          </p>
          {!isOverview && (
            <nav className="dtp-chips" aria-label="Scouting">
              {links.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  end={l.end}
                  className={({ isActive }) => (isActive ? "dtp-chip is-active" : "dtp-chip")}
                  style={({ isActive }) =>
                    isActive
                      ? {
                          background: "var(--dtp-lime)",
                          borderColor: "var(--dtp-lime)",
                          color: "var(--dtp-green)",
                          fontWeight: 600,
                        }
                      : undefined
                  }
                >
                  {l.label}
                </NavLink>
              ))}
            </nav>
          )}
        </div>
      </section>

      {/* Figma draws one black plate ("Rectangle 2319", 1440x2525) running from
          the top of the frame all the way down to the footer — the tiles and the
          partnering CTA sit on black, not on paper. That also matches the
          module's own shell, which is already dark (#0f172a). */}
      <div className="dtp-band dtp-band--ink">
        <div className="dtp-shell">
          <ModuleAdRails topSlot="scoutingTop" leftSlot="scoutingLeft" rightSlot="scoutingRight">
            <Outlet />
          </ModuleAdRails>
        </div>
      </div>
    </div>
  );
}
