import { useEffect, useState, type CSSProperties } from "react";

/**
 * Retro split-flap ("departure board") counter. Each digit flips forward one
 * card at a time until it reaches its target, like a railway board, so a new
 * goal visibly ticks over. Tiles take their accent from the nearest
 * `--sb-comp-hue`. Screen readers get the plain number from the aria-label.
 */

/** Quick while running through cards, slower on the last one so a change lands visibly. */
const FAST_STEP_MS = 80;
const SLOW_STEP_MS = 280;

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

function FlapDigit({ digit }: { digit: number }) {
  // Boards power up at zero and flip to their value; reduced motion skips that.
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? digit : 0));
  const flipping = shown !== digit;
  const next = flipping ? (shown + 1) % 10 : shown;
  const stepMs = (digit - shown + 10) % 10 > 1 ? FAST_STEP_MS : SLOW_STEP_MS;

  useEffect(() => {
    if (!flipping) return;
    if (prefersReducedMotion()) {
      setShown(digit);
      return;
    }
    const timer = window.setTimeout(() => setShown(next), stepMs);
    return () => window.clearTimeout(timer);
  }, [flipping, next, digit, stepMs]);

  return (
    <span className="sf-digit" style={{ "--sf-step": `${stepMs}ms` } as CSSProperties}>
      {/* Behind the flaps: the incoming card's top, the outgoing card's bottom. */}
      <span className="sf-half sf-half--top">
        <span>{next}</span>
      </span>
      <span className="sf-half sf-half--bottom">
        <span>{shown}</span>
      </span>
      {flipping && (
        <>
          {/* Keyed per step so each card restarts the fall animation. */}
          <span key={`top-${shown}`} className="sf-flap sf-flap--top">
            <span>{shown}</span>
          </span>
          <span key={`bottom-${next}`} className="sf-flap sf-flap--bottom">
            <span>{next}</span>
          </span>
        </>
      )}
    </span>
  );
}

export function SplitFlapCounter({
  value,
  label,
  minDigits = 2,
}: {
  value: number;
  label: string;
  /** Zero-padded width, so a board does not change size as it counts up. */
  minDigits?: number;
}) {
  const safe = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  const digits = String(safe).padStart(minDigits, "0").split("").map(Number);
  return (
    <span className="sf-counter" role="img" aria-label={`${safe} ${label.toLowerCase()}`}>
      <span className="sf-counter__digits" aria-hidden="true">
        {digits.map((digit, index) => (
          // Keyed by place value so units stay units when a digit is added.
          <FlapDigit key={digits.length - index} digit={digit} />
        ))}
      </span>
      <span className="sf-counter__label" aria-hidden="true">
        {label}
      </span>
    </span>
  );
}
