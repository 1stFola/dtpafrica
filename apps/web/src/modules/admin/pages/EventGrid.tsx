import { useCallback, useRef, useState } from "react";
import { EVENT_LABELS } from "../../../api/scoreboard";
import type { EventCaptureMap } from "../../../api/adminMatchStats";
import { capturesStat, captureSummary } from "./eventStatCapture";
import { categoryFor, type FeedbackPrefs } from "./useFeedbackPrefs";

function labelFor(type: string): string {
  return EVENT_LABELS[type] ?? type.replace(/_/g, " ");
}

/** Vibration lengths in ms, by category. Ignored where unsupported. */
const HAPTIC: Record<string, number | number[]> = {
  impact: [18, 26, 34],
  defensive: 22,
  standard: 10,
  locked: [14, 60, 14],
  /* A double pulse for a capture, so the hand can tell an event that also filed
     a statistic from one that only went to the log. */
  captured: [12, 40, 22],
};

type Ripple = { id: number; x: number; y: number };
type Plus = { id: number; x: number };

/**
 * One event in the capture grid.
 *
 * Deliberately not a `disabled` button: a disabled control swallows its own
 * click, and the whole point of the locked state here is that tapping it should
 * tell you *why* you cannot log yet. It carries `aria-disabled` instead, so
 * assistive technology still reports it as unavailable while the tap survives
 * to trigger the nudge.
 */
function EventButton({
  type,
  locked,
  lockedForType,
  prefs,
  captureMap,
  statLabels,
  onLog,
  onBlocked,
}: {
  type: string;
  locked: boolean;
  lockedForType?: (type: string) => boolean;
  prefs: FeedbackPrefs;
  captureMap: EventCaptureMap;
  /** Stat key to display label, for saying what a tap will also capture. */
  statLabels: Record<string, string>;
  onLog: (type: string) => void;
  onBlocked: () => void;
}) {
  const category = categoryFor(type);
  const captures = capturesStat(captureMap, type);
  const isLocked = lockedForType?.(type) ?? locked;
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const [pluses, setPluses] = useState<Plus[]>([]);
  const [nudging, setNudging] = useState(false);
  const [firing, setFiring] = useState(false);
  const seq = useRef(0);

  const buzz = useCallback(
    (pattern: number | number[]) => {
      if (!prefs.visuals) return;
      // Scale haptics with intensity; "low" stays silent to the hand.
      if (prefs.intensity === "low") return;
      try {
        navigator.vibrate?.(pattern);
      } catch {
        /* Unsupported or blocked — purely decorative, so ignore. */
      }
    },
    [prefs.intensity, prefs.visuals]
  );

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (isLocked) {
      if (prefs.visuals) {
        setNudging(true);
        window.setTimeout(() => setNudging(false), 420);
      }
      buzz(HAPTIC.locked);
      onBlocked();
      return;
    }

    if (prefs.visuals) {
      // Ripple originates at the finger, not the centre — it reads as touch.
      const rect = e.currentTarget.getBoundingClientRect();
      const id = (seq.current += 1);
      setRipples((r) => [...r, { id, x: e.clientX - rect.left, y: e.clientY - rect.top }]);
      window.setTimeout(() => setRipples((r) => r.filter((item) => item.id !== id)), 600);
      setFiring(true);
      window.setTimeout(() => setFiring(false), 460);

      /* A statistic was filed as well as the event. The "+" floats off the
         button so the recorder can see the Statistics tab was fed without
         leaving the one they are working in. */
      if (captures) {
        setPluses((p) => [...p, { id, x: e.clientX - rect.left }]);
        window.setTimeout(() => setPluses((p) => p.filter((item) => item.id !== id)), 900);
      }
    }

    buzz(captures ? HAPTIC.captured : HAPTIC[category]);
    onLog(type);
  };

  const cls = [
    "mcx-grid__btn",
    `mcx-grid__btn--${category}`,
    captures ? "mcx-grid__btn--captures" : "",
    isLocked ? "is-locked" : "",
    nudging ? "is-nudging" : "",
    firing ? "is-firing" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={cls}
      onClick={handleClick}
      aria-disabled={isLocked}
      title={captures ? (captureSummary(captureMap, type, statLabels) ?? undefined) : undefined}
    >
      <span className="mcx-grid__label">{labelFor(type)}</span>
      {ripples.map((r) => (
        <span key={r.id} className="mcx-grid__ripple" style={{ left: r.x, top: r.y }} />
      ))}
      {pluses.map((p) => (
        <span key={p.id} className="mcx-grid__plus" style={{ left: p.x }} aria-hidden="true">
          +
        </span>
      ))}
    </button>
  );
}

/**
 * The capture grid.
 *
 * Order stays alphabetical — recorders build muscle memory on position, and
 * that is worth more mid-match than visual grouping. Category shows through
 * colour, weight and the sound each tap makes instead.
 */
export function EventGrid({
  types,
  locked,
  lockedForType,
  prefs,
  captureMap,
  statLabels,
  onLog,
  onBlocked,
}: {
  types: readonly string[];
  locked: boolean;
  lockedForType?: (type: string) => boolean;
  prefs: FeedbackPrefs;
  captureMap: EventCaptureMap;
  statLabels: Record<string, string>;
  onLog: (type: string) => void;
  onBlocked: () => void;
}) {
  return (
    <div
      className="mcx-grid"
      aria-label="Event types"
      data-intensity={prefs.visuals ? prefs.intensity : "off"}
    >
      {types.map((type) => (
        <EventButton
          key={type}
          type={type}
          locked={locked}
          lockedForType={lockedForType}
          prefs={prefs}
          captureMap={captureMap}
          statLabels={statLabels}
          onLog={onLog}
          onBlocked={onBlocked}
        />
      ))}
    </div>
  );
}
