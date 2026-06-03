import { Link } from "react-router-dom";

type Crumb = { label: string; to?: string };

type Props = {
  title: string;
  description?: string;
  crumbs?: Crumb[];
  actions?: React.ReactNode;
};

export function AdminPageHeader({ title, description, crumbs, actions }: Props) {
  return (
    <header className="admin-sb-page-header">
      {crumbs && crumbs.length > 0 && (
        <nav className="admin-sb-breadcrumbs" aria-label="Breadcrumb">
          <Link to="/admin">Admin</Link>
          {crumbs.map((c, i) => (
            <span key={`${c.label}-${i}`}>
              <span className="admin-sb-breadcrumbs__sep" aria-hidden="true">
                /
              </span>
              {c.to ? <Link to={c.to}>{c.label}</Link> : <span>{c.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="admin-sb-page-header__row">
        <div>
          <h1 className="admin-sb-page-title">{title}</h1>
          {description && <p className="admin-sb-lead muted">{description}</p>}
        </div>
        {actions && <div className="admin-sb-page-actions">{actions}</div>}
      </div>
    </header>
  );
}
