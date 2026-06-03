import { type ReactNode } from "react";
import { normalizeClubName } from "../../../lib/normalize-club-name";

type Props = {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  required?: boolean;
  id?: string;
};

export function ClubNameField({
  value,
  onChange,
  label = "Club name",
  placeholder = "e.g. FC Bethel",
  required,
  id,
}: Props) {
  const trimmed = value.trim();
  const mapped = trimmed ? normalizeClubName(trimmed) : "";
  const changed = trimmed.length > 0 && mapped !== trimmed;

  return (
    <label className="admin-sb-field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        type="text"
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {trimmed && (
        <span
          className={
            changed ? "admin-club-map admin-club-map--mapped" : "admin-club-map admin-club-map--ok"
          }
        >
          Mapped to: {mapped}
          {changed ? " ✓" : " ✓"}
        </span>
      )}
    </label>
  );
}

type LinesProps = {
  value: string;
  onChange: (value: string) => void;
  label?: ReactNode;
  placeholder?: string;
  rows?: number;
};

/** Textarea with per-line club name normalization preview. */
export function ClubNameLinesField({
  value,
  onChange,
  label = "Teams (one per line)",
  placeholder,
  rows = 6,
}: LinesProps) {
  const lines = value.split("\n").filter((line) => line.trim());

  return (
    <label className="admin-sb-field">
      <span>{label}</span>
      <textarea
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {lines.length > 0 && (
        <ul className="admin-club-map-list">
          {lines.slice(0, 8).map((line) => {
            const raw = line.split("|")[0]?.trim() ?? line.trim();
            const mapped = normalizeClubName(raw);
            const changed = mapped !== raw;
            return (
              <li key={line} className={changed ? "admin-club-map--mapped" : "admin-club-map--ok"}>
                {raw !== mapped ? `${raw} → ${mapped}` : mapped} ✓
              </li>
            );
          })}
          {lines.length > 8 && (
            <li className="muted">+{lines.length - 8} more line(s)</li>
          )}
        </ul>
      )}
    </label>
  );
}
