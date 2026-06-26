import { NavLink, Outlet } from "react-router-dom";
import { ModuleAdRails } from "../../components/ModuleAdRails";

const links = [
  { to: "/scouting", end: true, label: "Overview" },
  { to: "/scouting/strong-xi", label: "Strong XI" },
  { to: "/scouting/compare", label: "Compare" },
  { to: "/scouting/generate", label: "Generate" },
];

export function ScoutingLayout() {
  return (
    <div className="scouting-module">
      <header className="scouting-header">
        <h1>Scouting Hub</h1>
        <p className="muted">
          Strong XI, player comparison, and market valuation generation
        </p>
        <nav className="scouting-subnav" aria-label="Scouting">
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
      <ModuleAdRails topSlot="scoutingTop" leftSlot="scoutingLeft" rightSlot="scoutingRight">
        <Outlet />
      </ModuleAdRails>
    </div>
  );
}
