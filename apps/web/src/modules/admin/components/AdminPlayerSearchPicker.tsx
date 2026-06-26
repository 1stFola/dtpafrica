import { useCallback, useEffect, useId, useRef, useState } from "react";
import { adminApi, type AdminPlayerRow } from "../../../api/admin";
import { useDebouncedValue } from "../../../hooks/useDebouncedValue";
import { isAbortError } from "../../../api/client";

function formatPlayerOption(p: AdminPlayerRow): string {
  const ovr =
    p.overallRating != null ? ` · OVR ${p.overallRating}` : "";
  return `${p.displayName} (${p.positionPrimary})${ovr}`;
}

type AdminPlayerSearchPickerProps = {
  value: string;
  onChange: (playerId: string, player?: AdminPlayerRow) => void;
  /** Slug for slug preview when a player is selected. */
  selectedSlug?: string | null;
};

export function AdminPlayerSearchPicker({
  value,
  onChange,
  selectedSlug,
}: AdminPlayerSearchPickerProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 300);
  const [results, setResults] = useState<AdminPlayerRow[]>([]);
  const [selected, setSelected] = useState<AdminPlayerRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!value) {
      setSelected(null);
      return;
    }
    if (selected?.id === value) return;

    let active = true;
    adminApi
      .players({ id: value, limit: 1 })
      .then((page) => {
        if (!active) return;
        setSelected(page.items[0] ?? null);
      })
      .catch(() => {
        if (active) setSelected(null);
      });

    return () => {
      active = false;
    };
  }, [value, selected?.id]);

  useEffect(() => {
    let active = true;
    setLoading(true);

    adminApi
      .players({
        q: debouncedQuery.trim() || undefined,
        sort: "name",
        sortDir: "asc",
        limit: 40,
        offset: 0,
      })
      .then((page) => {
        if (!active) return;
        setResults(page.items);
      })
      .catch((e) => {
        if (!active || isAbortError(e)) return;
        setResults([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [debouncedQuery]);

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const pick = useCallback(
    (player: AdminPlayerRow) => {
      setSelected(player);
      setQuery("");
      setOpen(false);
      onChange(player.id, player);
    },
    [onChange]
  );

  const clear = () => {
    setSelected(null);
    setQuery("");
    onChange("");
  };

  const displayValue = open ? query : selected ? formatPlayerOption(selected) : query;

  return (
    <div
      ref={rootRef}
      className="admin-player-search-picker admin-sb-field admin-calibration__select"
    >
      <span id={`${listId}-label`}>Load existing player (optional)</span>
      <div className="admin-player-search-picker__control">
        <input
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${listId}-listbox`}
          aria-labelledby={`${listId}-label`}
          aria-autocomplete="list"
          placeholder="Type to search players…"
          value={displayValue}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (selected) {
              setSelected(null);
              onChange("");
            }
          }}
          onFocus={() => setOpen(true)}
        />
        {(value || query) && (
          <button
            type="button"
            className="admin-player-search-picker__clear"
            aria-label="Clear player selection"
            onClick={clear}
          >
            ×
          </button>
        )}
      </div>
      {selectedSlug && (
        <p className="muted admin-player-search-picker__slug">Slug: {selectedSlug}</p>
      )}
      {open && (
        <ul
          id={`${listId}-listbox`}
          role="listbox"
          className="admin-player-search-picker__list"
          aria-labelledby={`${listId}-label`}
        >
          {!loading && results.length === 0 && (
            <li className="admin-player-search-picker__empty muted" role="presentation">
              {debouncedQuery.trim()
                ? "No players match your search."
                : "Start typing a player name…"}
            </li>
          )}
          {loading && (
            <li className="admin-player-search-picker__empty muted" role="presentation">
              Searching…
            </li>
          )}
          {results.map((player) => (
            <li key={player.id} role="option" aria-selected={player.id === value}>
              <button type="button" onClick={() => pick(player)}>
                {formatPlayerOption(player)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
