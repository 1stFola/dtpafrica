import { NavLink, Outlet } from "react-router-dom";

const links = [
  { to: "/featured-players", label: "Featured players" },
  { to: "/partners/academies", label: "Academies" },
  { to: "/blog", label: "Blog" },
  { to: "/about", label: "About" },
  { to: "/contact", label: "Contact" },
  { to: "/register", label: "Register" },
];

export function MarketingLayout() {
  return (
    <div className="marketing-module">
      <nav className="marketing-subnav" aria-label="DirectToPro">
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            className={({ isActive }) =>
              isActive ? "subnav-link active" : "subnav-link"
            }
          >
            {l.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
