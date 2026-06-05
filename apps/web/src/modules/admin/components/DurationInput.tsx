const DURATION_RE = /^\d{1,2}:[0-5]\d$/;

/** Strip non-digits and format as MM:SS while typing (e.g. 0345 → 03:45). */
export function maskDurationInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  const mm = digits.slice(0, digits.length - 2);
  const ss = digits.slice(-2);
  return `${mm}:${ss}`;
}

export function isValidDuration(value: string): boolean {
  return DURATION_RE.test(value.trim());
}

type Props = {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  required?: boolean;
};

export function DurationInput({ value, onChange, id, required }: Props) {
  return (
    <input
      id={id}
      required={required}
      inputMode="numeric"
      autoComplete="off"
      value={value}
      placeholder="03:45"
      maxLength={5}
      pattern="\d{1,2}:[0-5]\d"
      title="MM:SS format, e.g. 03:45"
      onChange={(e) => onChange(maskDurationInput(e.target.value))}
      onBlur={() => {
        if (!value) return;
        const [mm = "", ss = ""] = value.split(":");
        if (ss.length === 1) {
          onChange(`${mm}:0${ss}`);
        } else if (!value.includes(":") && value.length <= 2) {
          onChange(`${value}:00`);
        }
      }}
    />
  );
}
