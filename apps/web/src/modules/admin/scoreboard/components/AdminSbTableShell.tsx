type Props = {
  loading?: boolean;
  empty?: boolean;
  emptyTitle?: string;
  emptyHint?: string;
  columns: number;
  children: React.ReactNode;
};

export function AdminSbTableShell({
  loading,
  empty,
  emptyTitle = "No records yet",
  emptyHint,
  columns,
  children,
}: Props) {
  if (loading) {
    return (
      <div className="admin-table-wrap admin-sb-table-wrap" aria-busy="true">
        <table className="admin-table admin-sb-table">
          <tbody>
            {Array.from({ length: 5 }, (_, i) => (
              <tr key={i}>
                {Array.from({ length: columns }, (_, j) => (
                  <td key={j}>
                    <span className="admin-sb-skeleton admin-sb-skeleton--line" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (empty) {
    return (
      <div className="admin-sb-empty-state dtp-empty-state">
        <p className="admin-sb-empty-state__title dtp-empty-state__title">{emptyTitle}</p>
        {emptyHint && <p className="muted">{emptyHint}</p>}
      </div>
    );
  }

  return <div className="admin-table-wrap admin-sb-table-wrap">{children}</div>;
}
