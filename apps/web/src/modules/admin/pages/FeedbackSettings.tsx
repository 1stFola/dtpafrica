import { useFeedbackPrefs } from "./useFeedbackPrefs";
import { useUISound, type FeedbackIntensity } from "./useUISound";

const LEVELS: { value: FeedbackIntensity; label: string; hint: string }[] = [
  { value: "low", label: "Low", hint: "Barely there — for a quiet press box" },
  { value: "medium", label: "Medium", hint: "Balanced, the default" },
  { value: "high", label: "High", hint: "Loud and lively — for a full stand" },
];

/**
 * Sound and motion controls for the capture grid.
 *
 * Lives on the recorder's landing page rather than inside the console: this is
 * something you set once before kickoff, and burying it behind a match would
 * mean fiddling with settings while play is live.
 */
export function FeedbackSettings() {
  const { prefs, update } = useFeedbackPrefs();
  // Always audible while testing, so the sample plays even with sound muted.
  const preview = useUISound({ enabled: true, intensity: prefs.intensity });

  const open = !prefs.collapsed;

  return (
    <section className="mcx-fx" aria-labelledby="mcx-fx-title">
      <button
        type="button"
        className="mcx-fx__head"
        aria-expanded={open}
        aria-controls="mcx-fx-body"
        onClick={() => update({ collapsed: open })}
      >
        <span className="mcx-fx__heading">
          <h2 id="mcx-fx-title">Tap feedback</h2>
          <span className="muted">
            How the event buttons react when you capture. Saved on this device only.
          </span>
        </span>
        {/* A literal +/- rather than a chevron: unambiguous at a glance on a
            phone held at arm's length pitch-side. */}
        <span className="mcx-fx__fold" aria-hidden="true">
          {open ? "−" : "+"}
        </span>
      </button>

      {!open && (
        <p className="mcx-fx__summary">
          {prefs.sound || prefs.visuals ? (
            <>
              {[prefs.sound && "Sound", prefs.visuals && "Animations"]
                .filter(Boolean)
                .join(" and ")}{" "}
              on · {prefs.intensity} intensity
            </>
          ) : (
            "Sound and animations off"
          )}
        </p>
      )}

      <div id="mcx-fx-body" hidden={!open}>
      <div className="mcx-fx__toggles">
        <label className="mcx-fx__switch">
          <input
            type="checkbox"
            checked={prefs.sound}
            onChange={(e) => update({ sound: e.target.checked })}
          />
          <span>Sound effects</span>
        </label>

        <label className="mcx-fx__switch">
          <input
            type="checkbox"
            checked={prefs.visuals}
            onChange={(e) => update({ visuals: e.target.checked })}
          />
          <span>Animations &amp; haptics</span>
        </label>
      </div>

      <fieldset className="mcx-fx__levels" disabled={!prefs.sound && !prefs.visuals}>
        <legend>Intensity</legend>
        <div className="mcx-fx__row">
          {LEVELS.map((level) => (
            <button
              key={level.value}
              type="button"
              className={`mcx-fx__level${prefs.intensity === level.value ? " is-active" : ""}`}
              aria-pressed={prefs.intensity === level.value}
              onClick={() => {
                update({ intensity: level.value });
                // Play at the level just chosen so the choice is audible.
                if (prefs.sound) preview("standard");
              }}
            >
              <strong>{level.label}</strong>
              <span>{level.hint}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <div className="mcx-fx__try">
        <span className="muted">Hear them:</span>
        <button type="button" className="mcx-btn" onClick={() => preview("impact")}>
          High impact
        </button>
        <button type="button" className="mcx-btn" onClick={() => preview("defensive")}>
          Defensive
        </button>
        <button type="button" className="mcx-btn" onClick={() => preview("standard")}>
          Standard play
        </button>
        <button type="button" className="mcx-btn" onClick={() => preview("error")}>
          Blocked
        </button>
      </div>
      </div>
    </section>
  );
}
