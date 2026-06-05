import { NavLink, Outlet } from "react-router-dom";
import { ModuleAdRails } from "../../components/ModuleAdRails";

const links = [
  { to: "/valuation", end: true, label: "Overview" },
  { to: "/valuation/generate", label: "Generate" },
  { to: "/valuation/compare", label: "Compare" },
];

export function ValuationLayout() {
  return (
    <div className="valuation-module">
      <header className="scoreboard-header">
        <h1>Market Value Confidence</h1>
        <p className="muted">
          Deterministic valuation bands for Nigerian grassroots talent — visibility,
          verification, and market demand weighted.
        </p>
        <nav className="scouting-subnav" aria-label="Valuation">
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
        topSlot="valuationTop"
        leftSlot="valuationLeft"
        rightSlot="valuationRight"
      >
        <Outlet />
      </ModuleAdRails>
    </div>
  );
}
