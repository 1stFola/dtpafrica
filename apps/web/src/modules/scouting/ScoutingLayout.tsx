import { NavLink, Outlet } from "react-router-dom";

const links = [
  { to: "/scouting", end: true, label: "Overview" },
  { to: "/scouting/strong-xi", label: "Strong XI" },
  { to: "/scouting/philosophy", label: "Philosophy fit" },
  { to: "/scouting/search", label: "Tactical search" },
  { to: "/scouting/compare", label: "Compare" },
];

export function ScoutingLayout() {
  return (
    <div className="scouting-module">
      <header className="scouting-header">
        <h1>Scouting Intelligence</h1>
        <p className="muted">
          Tactical fit, philosophy matching, and Strong XI generation
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
      <Outlet />
    </div>
  );
}
