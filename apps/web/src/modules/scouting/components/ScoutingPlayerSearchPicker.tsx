import { useCallback, useEffect, useId, useRef, useState } from "react";
import { apiGet, isAbortError } from "../../../api/client";
import { useDebouncedValue } from "../../../hooks/useDebouncedValue";

export type ScoutingSearchPlayer = {
  id: string;
  displayName: string;
  positionPrimary: string;
  overallRating: number | null;
  playerPhotoUrl: string | null;
};

type Props = {
  excludeIds: string[];
  maxPlayers: number;
  disabled?: boolean;
  onAdd: (player: ScoutingSearchPlayer) => void;
};

function formatPlayerOption(p: ScoutingSearchPlayer): string {
  const ovr = p.overallRating != null ? ` · OVR ${p.overallRating}` : "";
  return `${p.displayName} (${p.positionPrimary})${ovr}`;
}

export function ScoutingPlayerSearchPicker({
  excludeIds,
  maxPlayers,
  disabled = false,
  onAdd,
}: Props) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 300);
  const [results, setResults] = useState<ScoutingSearchPlayer[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const atCapacity = excludeIds.length >= maxPlayers;

  useEffect(() => {
    const q = debouncedQuery.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let active = true;
    setLoading(true);

    const params = new URLSearchParams({ q, limit: "40" });
    apiGet<{ players: ScoutingSearchPlayer[] }>(
      `/scouting/player-search?${params.toString()}`,
      controller.signal
    )
      .then((page) => {
        if (!active) return;
        setResults(
          page.players.filter((player) => !excludeIds.includes(player.id))
        );
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
      controller.abort();
    };
  }, [debouncedQuery, excludeIds]);

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
    (player: ScoutingSearchPlayer) => {
      onAdd(player);
      setQuery("");
      setOpen(false);
    },
    [onAdd]
  );

  return (
    <div ref={rootRef} className="scouting-compare__search">
      <label id={`${listId}-label`} className="scouting-compare__search-label">
        Add player
      </label>
      <div className="scouting-compare__search-control">
        <input
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${listId}-listbox`}
          aria-labelledby={`${listId}-label`}
          aria-autocomplete="list"
          placeholder={
            atCapacity
              ? `Maximum ${maxPlayers} players selected`
              : "Type to search players…"
          }
          value={query}
          disabled={disabled || atCapacity}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
        {query && (
          <button
            type="button"
            className="scouting-compare__search-clear"
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              setOpen(false);
            }}
          >
            ×
          </button>
        )}
      </div>
      {open && !atCapacity && (
        <ul
          id={`${listId}-listbox`}
          role="listbox"
          className="scouting-compare__search-list"
          aria-labelledby={`${listId}-label`}
        >
          {debouncedQuery.trim().length < 2 && (
            <li className="scouting-compare__search-empty muted" role="presentation">
              Type at least 2 characters to search…
            </li>
          )}
          {debouncedQuery.trim().length >= 2 && !loading && results.length === 0 && (
            <li className="scouting-compare__search-empty muted" role="presentation">
              No players match your search.
            </li>
          )}
          {loading && (
            <li className="scouting-compare__search-empty muted" role="presentation">
              Searching…
            </li>
          )}
          {results.map((player) => (
            <li key={player.id} role="option">
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
