import { useCallback, useEffect, useRef } from "react";

/**
 * Procedural UI sound, synthesised on the fly with the Web Audio API.
 *
 * Nothing is fetched: every sound is built from oscillators and noise buffers
 * at call time. That keeps the console's payload unchanged and, more usefully
 * pitch-side, means the first tap of a match is as instant as the hundredth —
 * there is no sample to wait on over a poor connection.
 */

export type SoundKind = "impact" | "defensive" | "standard" | "error";

export type FeedbackIntensity = "low" | "medium" | "high";

/** Master gain per intensity. Low stays audible in a quiet room without carrying. */
const INTENSITY_GAIN: Record<FeedbackIntensity, number> = {
  low: 0.16,
  medium: 0.34,
  high: 0.6,
};

/**
 * A short burst of filtered noise — the body of a snare snap or the grit under
 * a punch. Generated once per call; the buffers are tiny.
 */
function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const frames = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) {
    // Decay the noise as it is written so the tail never clicks off abruptly.
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }
  return buffer;
}

export function useUISound(options: { enabled: boolean; intensity: FeedbackIntensity }) {
  const { enabled, intensity } = options;
  const ctxRef = useRef<AudioContext | null>(null);

  /* Created on the first sound rather than on mount: browsers refuse to start
     an AudioContext before a user gesture, and an unused one wastes a device
     audio thread. */
  const context = useCallback((): AudioContext | null => {
    if (typeof window === "undefined") return null;
    if (!ctxRef.current) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      try {
        ctxRef.current = new Ctor();
      } catch {
        return null;
      }
    }
    if (ctxRef.current.state === "suspended") void ctxRef.current.resume();
    return ctxRef.current;
  }, []);

  useEffect(() => {
    return () => {
      void ctxRef.current?.close();
      ctxRef.current = null;
    };
  }, []);

  const play = useCallback(
    (kind: SoundKind) => {
      if (!enabled) return;
      const ctx = context();
      if (!ctx) return;

      const now = ctx.currentTime;
      const master = ctx.createGain();
      master.gain.value = INTENSITY_GAIN[intensity];
      master.connect(ctx.destination);

      /** Ramp to zero rather than stopping dead, so nothing clicks. */
      const envelope = (gain: GainNode, peak: number, attack: number, decay: number) => {
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(peak, now + attack);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
      };

      if (kind === "impact") {
        /* Stadium punch: a pitch sweep from 130Hz down to 45Hz for the thump,
           with a noise transient on top so it reads as a hit, not a hum. */
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(130, now);
        osc.frequency.exponentialRampToValueAtTime(45, now + 0.28);
        envelope(gain, 1, 0.008, 0.34);
        osc.connect(gain).connect(master);
        osc.start(now);
        osc.stop(now + 0.4);

        const crack = ctx.createBufferSource();
        const crackGain = ctx.createGain();
        const crackFilter = ctx.createBiquadFilter();
        crack.buffer = noiseBuffer(ctx, 0.12);
        crackFilter.type = "bandpass";
        crackFilter.frequency.value = 1800;
        envelope(crackGain, 0.35, 0.004, 0.1);
        crack.connect(crackFilter).connect(crackGain).connect(master);
        crack.start(now);
        return;
      }

      if (kind === "defensive") {
        /* Snare snap plus a metallic ping: the sound of something being stopped
           rather than something landing. */
        const snap = ctx.createBufferSource();
        const snapGain = ctx.createGain();
        const hp = ctx.createBiquadFilter();
        snap.buffer = noiseBuffer(ctx, 0.09);
        hp.type = "highpass";
        hp.frequency.value = 1200;
        envelope(snapGain, 0.8, 0.003, 0.075);
        snap.connect(hp).connect(snapGain).connect(master);
        snap.start(now);

        const ping = ctx.createOscillator();
        const pingGain = ctx.createGain();
        ping.type = "triangle";
        ping.frequency.setValueAtTime(2400, now);
        ping.frequency.exponentialRampToValueAtTime(1500, now + 0.09);
        envelope(pingGain, 0.22, 0.003, 0.08);
        ping.connect(pingGain).connect(master);
        ping.start(now);
        ping.stop(now + 0.14);
        return;
      }

      if (kind === "standard") {
        /* A tactile tick — deliberately the quietest of the set, because this
           is the one a recorder hears dozens of times in a half. */
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(560, now + 0.05);
        envelope(gain, 0.5, 0.002, 0.055);
        osc.connect(gain).connect(master);
        osc.start(now);
        osc.stop(now + 0.09);
        return;
      }

      /* Error: two low thuds. Low and doubled so it reads as "not yet" rather
         than as a failure, and never competes with the impact sound. */
      [0, 0.13].forEach((offset) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(96, now + offset);
        osc.frequency.exponentialRampToValueAtTime(70, now + offset + 0.1);
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.7, now + offset + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.12);
        osc.connect(gain).connect(master);
        osc.start(now + offset);
        osc.stop(now + offset + 0.16);
      });
    },
    [context, enabled, intensity]
  );

  return play;
}
