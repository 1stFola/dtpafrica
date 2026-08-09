import { NavLink, Outlet } from "react-router-dom";
import { ModuleAdRails } from "../../components/ModuleAdRails";
import { HIGH_FETCH_PRIORITY } from "../../utils/imgPriority";

/* Figma "DTP" -> Scouting Hubs 118:1711. Black hero plate, orange eyebrow,
   Gasoek 90px display. The sub-navigation is not drawn in the frame but the
   module's child routes need it, so it renders as chips under the lead. */

const links = [
  { to: "/scouting", end: true, label: "Overview" },
  { to: "/scouting/strong-xi", label: "Strong XI" },
  { to: "/scouting/compare", label: "Compare" },
  { to: "/scouting/generate", label: "Generate" },
];

export function ScoutingLayout() {
  return (
    <div className="scouting-module dtp-page">
      <section className="dtp-hero">
        <img className="dtp-hero__media" {...HIGH_FETCH_PRIORITY} decoding="async" src="/figma/hero-scouting.webp" alt="" aria-hidden="true" />
        <div className="dtp-hero__scrim" aria-hidden="true" />
        <div className="dtp-shell dtp-hero__inner">
          <p className="dtp-eyebrow" style={{ color: "var(--dtp-orange)" }}>
            Talent Pipeline &amp; Scouting Overview
          </p>
          <h1 className="dtp-display dtp-display--hero dtp-hero__title">Scouting Hub</h1>
          <p className="dtp-lead dtp-hero__lead">
            Real-time target tracking, scout assignments, and performance metrics.
          </p>
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
        </div>
      </section>

      <div className="dtp-band dtp-band--paper">
        <div className="dtp-shell">
          <ModuleAdRails topSlot="scoutingTop" leftSlot="scoutingLeft" rightSlot="scoutingRight">
            <Outlet />
          </ModuleAdRails>
        </div>
      </div>
    </div>
  );
}
