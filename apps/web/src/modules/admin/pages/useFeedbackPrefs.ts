import { useCallback, useEffect, useState } from "react";
import type { FeedbackIntensity, SoundKind } from "./useUISound";

/**
 * Sound and motion preferences for the recorder console.
 *
 * Held in localStorage rather than on the account: this is a property of where
 * someone is standing, not who they are. A recorder wants sound on a quiet
 * training pitch and off in a packed stand, on the same login.
 */

export type FeedbackPrefs = {
  sound: boolean;
  visuals: boolean;
  intensity: FeedbackIntensity;
  /** Whether the settings card is folded away. Set once, then left alone. */
  collapsed: boolean;
};

const KEY = "dtp_match_feedback";

export const DEFAULT_PREFS: FeedbackPrefs = {
  sound: true,
  visuals: true,
  intensity: "medium",
  // Folded by default: these are pre-match settings, and the fixture list is
  // what a recorder opens this page for.
  collapsed: true,
};

function read(): FeedbackPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<FeedbackPrefs>;
    return {
      sound: parsed.sound !== false,
      visuals: parsed.visuals !== false,
      intensity:
        parsed.intensity === "low" || parsed.intensity === "high" ? parsed.intensity : "medium",
      collapsed: parsed.collapsed !== false,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Broadcast within the tab, so the console and the landing page stay in step. */
const CHANNEL = "dtp-feedback-prefs";

export function useFeedbackPrefs() {
  const [prefs, setPrefs] = useState<FeedbackPrefs>(DEFAULT_PREFS);

  useEffect(() => {
    setPrefs(read());
    const sync = () => setPrefs(read());
    window.addEventListener("storage", sync);
    window.addEventListener(CHANNEL, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(CHANNEL, sync);
    };
  }, []);

  const update = useCallback((patch: Partial<FeedbackPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* Private mode: the preference simply does not persist. */
      }
      window.dispatchEvent(new Event(CHANNEL));
      return next;
    });
  }, []);

  return { prefs, update };
}

/**
 * How each event type should feel when tapped.
 *
 * Grouped by what the moment means rather than by data shape: a goal and a shot
 * off the woodwork are both moments the whole ground reacts to, while a
 * clearance and a save are both the sound of danger being stopped.
 */
const HIGH_IMPACT = new Set([
  "goal",
  "goal_penalty",
  "own_goal",
  "woodwork",
  "penalty_saved",
  "penalty_shootout",
  "one_on_one",
]);

const DEFENSIVE = new Set([
  "save",
  "clearance",
  "goal_line_clearance",
  "interception",
  "recovery_tackle",
  "tackle_won",
  "aerial_duel_won",
  "blocked_shot",
  "goalkeeper_claim",
  "goalkeeper_command",
  "goalkeeper_distribution",
  "goalkeeper_intervention",
  "goalkeeper_punch",
  "sweeper_keep",
]);

export type EventCategory = "impact" | "defensive" | "standard";

export function categoryFor(type: string): EventCategory {
  if (HIGH_IMPACT.has(type)) return "impact";
  if (DEFENSIVE.has(type)) return "defensive";
  return "standard";
}

/** The category maps straight onto a sound. */
export function soundFor(type: string): SoundKind {
  return categoryFor(type) as SoundKind;
}
