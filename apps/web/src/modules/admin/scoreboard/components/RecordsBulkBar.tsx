import { countOf, type Noun } from "../bulk-actions";

/**
 * The bar that appears under a Master records filter row once rows are selected.
 *
 * It says what is selected out of what, because those two numbers together are the only thing
 * standing between "delete the three I ticked" and "delete the four hundred this filter shows".
 * Select-all takes the filtered rows and nothing else — that is enforced in `row-selection`, and
 * the counts here are how an admin sees it.
 *
 * Hidden when nothing is selected rather than rendered empty, so the table does not sit under a
 * strip of disabled buttons all day.
 */
export type BulkAction = {
  label: string;
  /** Red, for anything that removes records. */
  danger?: boolean;
  onRun: () => void | Promise<void>;
  /** Why it cannot run now, which also disables it. */
  disabledReason?: string;
};

type Props = {
  noun: Noun;
  selectedCount: number;
  visibleCount: number;
  allVisibleSelected: boolean;
  onSelectAllVisible: () => void;
  onClear: () => void;
  busy?: boolean;
  actions: BulkAction[];
};

export function RecordsBulkBar({
  noun,
  selectedCount,
  visibleCount,
  allVisibleSelected,
  onSelectAllVisible,
  onClear,
  busy = false,
  actions,
}: Props) {
  if (selectedCount === 0) return null;

  return (
    <div className="admin-sb-bulk-bar" role="group" aria-label={`Bulk actions for ${noun.many}`}>
      <span className="admin-sb-bulk-bar__count" aria-live="polite">
        <strong>{countOf(noun, selectedCount)}</strong> selected
        {visibleCount > selectedCount ? (
          <span className="muted"> of {visibleCount} shown</span>
        ) : null}
      </span>

      <div className="admin-sb-bulk-bar__picks">
        {/* Not a toggle-all checkbox: the header already has one, and a second control that
            sometimes clears and sometimes selects is the kind of button people press twice. */}
        {!allVisibleSelected && visibleCount > 0 && (
          <button
            type="button"
            className="admin-inline-button"
            onClick={onSelectAllVisible}
            disabled={busy}
          >
            Select all {visibleCount} shown
          </button>
        )}
        <button type="button" className="admin-inline-button" onClick={onClear} disabled={busy}>
          Clear selection
        </button>
      </div>

      <div className="admin-sb-bulk-bar__actions">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            className={
              action.danger
                ? "admin-inline-button admin-inline-button--danger"
                : "admin-inline-button"
            }
            onClick={() => void action.onRun()}
            disabled={busy || Boolean(action.disabledReason)}
            title={action.disabledReason}
          >
            {action.label}
          </button>
        ))}
        {busy && <span className="muted">Working…</span>}
      </div>
    </div>
  );
}
