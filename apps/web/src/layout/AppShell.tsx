import { NavLink, Outlet } from "react-router-dom";
import { PRODUCT_MODULES } from "@dtp/domain";
import { DtpLogo } from "@dtp/ui";

export function AppShell() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <NavLink to="/" className="brand">
          <DtpLogo />
          <span>DirectToPro Africa</span>
        </NavLink>
        <nav className="app-nav" aria-label="Main">
          {PRODUCT_MODULES.map((mod) => (
            <NavLink
              key={mod.id}
              to={mod.path}
              className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
            >
              {mod.navLabel}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
      <footer className="app-footer">
        <nav className="footer-nav" aria-label="Footer">
          <NavLink to="/about">About</NavLink>
          <NavLink to="/blog">Blog</NavLink>
          <NavLink to="/academy">Academies</NavLink>
          <NavLink to="/contact">Contact</NavLink>
          <NavLink to="/register">Register</NavLink>
        </nav>
        <p>© {new Date().getFullYear()} DirectToPro Africa</p>
      </footer>
    </div>
  );
}
