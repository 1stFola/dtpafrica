/**
 * Competition crest. Mirrors TeamCrest: render the supplied logo, and fall
 * back to a tinted monogram so a competition without artwork still reads as a
 * badge rather than an empty box.
 */

const PIXELS: Record<CrestSize, number> = { sm: 28, md: 44, lg: 64, xl: 96 };

export type CrestSize = "sm" | "md" | "lg" | "xl";

/**
 * Initials for the monogram. Season years and generic competition words carry
 * no identity, so "RAK BDFA League" reads "RB", not "RBL", and
 * "1XCup 2026" reads "1X" rather than picking up the year as a word.
 */
function competitionMonogram(name: string): string {
  const words = name
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/\b\d{4}\s*\/\s*\d{2,4}\b/g, " ")
    .replace(/\b(cup|league|competition|tournament|division|season)\b/gi, " ")
    .split(/\s+/)
    .filter(Boolean);
  const source = words.length ? words : name.split(/\s+/).filter(Boolean);
  if (source.length === 1) return source[0].slice(0, 2).toUpperCase();
  return source
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

/** Stable hue per competition so the fallback badge is consistent per id. */
function competitionHue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

export function CompetitionCrest({
  competition,
  size = "md",
  className,
}: {
  competition: { id?: string; name: string; logoUrl?: string | null };
  size?: CrestSize;
  className?: string;
}) {
  const px = PIXELS[size];
  const classes = ["sb-comp-crest", `sb-comp-crest--${size}`, className].filter(Boolean).join(" ");

  if (competition.logoUrl) {
    return (
      <span className={classes}>
        <img
          src={competition.logoUrl}
          alt=""
          loading="lazy"
          /* Google Photos links 403 when a referrer is sent. */
          referrerPolicy="no-referrer"
          width={px}
          height={px}
        />
      </span>
    );
  }

  const hue = competitionHue(competition.id ?? competition.name);
  return (
    <span
      className={`${classes} sb-comp-crest--placeholder`}
      style={{ "--sb-comp-hue": String(hue) } as React.CSSProperties}
      aria-hidden="true"
    >
      {competitionMonogram(competition.name)}
    </span>
  );
}
