import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { filterSearchOptions, type SearchOption } from "../search-select";

type SearchSelectProps<T extends SearchOption> = {
  label: string;
  options: T[];
  value: string;
  onChange: (id: string, option?: T) => void;
  /** Controlled when the parent also searches the server with it. */
  query?: string;
  onQueryChange?: (query: string) => void;
  loading?: boolean;
  placeholder?: string;
  hint?: string;
  disabled?: boolean;
  /** How many matches to list at once. Typing narrows it. */
  limit?: number;
};

/**
 * A type-to-search picker for the records page dialogs: the list sits under the
 * input inside the dialog rather than floating, so a modal never clips it, and the
 * chosen option is restated below so a long name is never ambiguous.
 */
export function SearchSelect<T extends SearchOption>({
  label,
  options,
  value,
  onChange,
  query: controlledQuery,
  onQueryChange,
  loading = false,
  placeholder = "Type to search…",
  hint,
  disabled = false,
  limit = 30,
}: SearchSelectProps<T>) {
  const id = useId();
  const [ownQuery, setOwnQuery] = useState("");
  const query = controlledQuery ?? ownQuery;
  const setQuery = (next: string) => {
    if (onQueryChange) onQueryChange(next);
    else setOwnQuery(next);
  };
  const [active, setActive] = useState(0);

  const matches = useMemo(() => filterSearchOptions(options, query, limit), [options, query, limit]);
  const selected = useMemo(() => options.find((o) => o.id === value), [options, value]);

  useEffect(() => setActive(0), [query]);

  const pick = (option: T) => {
    onChange(option.id, option);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      /* Enter picks the highlighted match; it must not submit the dialog's form. */
      e.preventDefault();
      if (matches[active]) pick(matches[active]);
    }
  };

  return (
    <div className="admin-sb-field admin-player-search-picker admin-sb-search-select">
      <span id={`${id}-label`}>{label}</span>
      <div className="admin-player-search-picker__control">
        <input
          type="search"
          role="combobox"
          aria-expanded
          aria-controls={`${id}-list`}
          aria-labelledby={`${id}-label`}
          aria-autocomplete="list"
          aria-activedescendant={matches[active] ? `${id}-opt-${matches[active].id}` : undefined}
          placeholder={placeholder}
          value={query}
          disabled={disabled}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      {hint ? <small className="muted">{hint}</small> : null}
      <ul id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`} className="admin-player-search-picker__list">
        {matches.map((option, i) => (
          <li
            key={option.id}
            id={`${id}-opt-${option.id}`}
            role="option"
            aria-selected={option.id === value}
            className={[
              i === active ? "is-active" : "",
              option.id === value ? "is-selected" : "",
            ].join(" ")}
          >
            <button type="button" disabled={disabled} onClick={() => pick(option)} onMouseEnter={() => setActive(i)}>
              <span className="admin-sb-search-select__label">
                {option.label}
                {option.badge ? <em className="admin-sb-search-select__badge">{option.badge}</em> : null}
              </span>
              {option.detail ? <small className="muted">{option.detail}</small> : null}
            </button>
          </li>
        ))}
        {loading ? (
          <li className="admin-player-search-picker__empty muted" role="presentation">
            Searching…
          </li>
        ) : matches.length === 0 ? (
          <li className="admin-player-search-picker__empty muted" role="presentation">
            {query.trim() ? "Nothing matches. Try fewer or different words." : "Start typing a name…"}
          </li>
        ) : null}
      </ul>
      <p className="admin-sb-search-select__chosen" aria-live="polite">
        {selected ? (
          <>
            Selected: <strong>{selected.label}</strong>
            {selected.detail ? <span className="muted"> · {selected.detail}</span> : null}
          </>
        ) : (
          <span className="muted">Nothing selected yet.</span>
        )}
      </p>
    </div>
  );
}
