import { useCallback, useState, type ReactNode } from "react";

/**
 * The small set of pieces every page of the Vision environment is built from:
 * a panel, a labelled row, a form field, and one hook that runs an action,
 * shows what it did or why it refused, and reloads. Kept here so the eight
 * pages read alike and an operator learns the environment once.
 */

export function Panel({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="vision-panel">
      <div className="vision-panel__head">
        <h2 className="vision-panel__title">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Row({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="vision-row">
      <span className="vision-row__label">{label}</span>
      <span className="vision-row__value">
        {value}
        {note && <span className="vision-row__note muted">{note}</span>}
      </span>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="vision-field">
      <span className="vision-field__label">{label}</span>
      {children}
      {hint && <span className="vision-field__hint muted">{hint}</span>}
    </label>
  );
}

export function Pill({ tone, children }: { tone?: "ok" | "warn" | "bad" | "muted"; children: ReactNode }) {
  return <span className={`vision-pill${tone ? ` vision-pill--${tone}` : ""}`}>{children}</span>;
}

export function toneOfState(state: string): "ok" | "warn" | "bad" | "muted" {
  if (["succeeded", "ready", "accepted", "production", "frozen", "acquired"].includes(state)) return "ok";
  if (["failed", "rejected", "cancelled", "refused", "revoked"].includes(state)) return "bad";
  if (["queued", "claimed", "running", "uploading", "unreviewed", "candidate", "benchmarked", "promotion_requested"].includes(state)) return "warn";
  return "muted";
}

/** Runs an action, reports it in words, reloads. The API's refusal messages are the ones shown. */
export function useAction(reload: () => Promise<unknown> | void) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (label: string, action: () => Promise<unknown>) => {
      setBusy(true);
      setNotice(null);
      setError(null);
      try {
        await action();
        setNotice(label);
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [reload]
  );
  const messages = (
    <>
      {error && <p className="vision-panel vision-panel--error">{error}</p>}
      {notice && <p className="vision-panel vision-panel--ok">{notice}</p>}
    </>
  );
  return { busy, run, messages, setError };
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : m ? `${m}m ${s % 60}s` : `${s}s`;
}

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function short(id: string | null | undefined, n = 8): string {
  return id ? id.slice(0, n) : "—";
}
