import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useLocation } from "react-router-dom";
import { createSupportReport } from "../api/admin";

const AUDIENCES = [
  ["internal_admin", "Internal DTP admin"],
  ["club", "Club"],
  ["scoreboard_operator", "ScoreBoard operator"],
  ["scout", "Scout"],
  ["academy", "Academy"],
] as const;

type SupportAudience = (typeof AUDIENCES)[number][0];

const CATEGORIES = [
  ["scoreboard_ops", "ScoreBoard / match operations"],
  ["player_data", "Player data or profile"],
  ["calibration", "Calibration / ratings"],
  ["media_highlights", "Media / highlights"],
  ["content_admin", "Content / admin"],
  ["deployment", "Site or deployment"],
  ["access_permissions", "Access / permissions"],
  ["other", "Other"],
] as const;

const SEVERITIES = [
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
  ["critical", "Critical"],
] as const;

function audienceForPath(pathname: string): SupportAudience | null {
  if (pathname.startsWith("/admin")) return "internal_admin";
  if (pathname.startsWith("/spotter-tablet")) return "scoreboard_operator";
  if (pathname.startsWith("/scoreboard/supervisor")) return "scoreboard_operator";
  if (pathname.startsWith("/scoreboard")) return "scout";
  if (pathname.startsWith("/scouting")) return "scout";
  if (pathname.startsWith("/featured-players")) return "scout";
  if (pathname.startsWith("/players") || pathname.startsWith("/player")) return "scout";
  if (pathname.startsWith("/academy")) return "academy";
  if (pathname.startsWith("/partners/academies")) return "club";
  return null;
}

export function SupportReportButton() {
  const location = useLocation();
  const inferredAudience = useMemo(() => audienceForPath(location.pathname), [location.pathname]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    audience: inferredAudience ?? "scout",
    category: "scoreboard_ops",
    severity: "medium",
    reporterName: "",
    reporterEmail: "",
    subject: "",
    description: "",
  });

  const pageUrl = useMemo(() => {
    if (typeof window === "undefined") return location.pathname;
    return window.location.href;
  }, [location.pathname]);

  useEffect(() => {
    if (open || !inferredAudience) return;
    setForm((current) => ({ ...current, audience: inferredAudience }));
  }, [inferredAudience, open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await createSupportReport({
        ...form,
        pageUrl,
        reporterName: form.reporterName || undefined,
        reporterEmail: form.reporterEmail || undefined,
      });
      setSent(true);
      setForm((current) => ({ ...current, subject: "", description: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit support report");
    } finally {
      setSaving(false);
    }
  }

  if (!inferredAudience) return null;

  return (
    <>
      <button
        type="button"
        className="support-report-fab"
        onClick={() => {
          setOpen(true);
          setSent(false);
          setError("");
        }}
      >
        Report issue
      </button>
      {open && (
        <div className="support-report-modal-backdrop" role="presentation">
          <div className="support-report-modal" role="dialog" aria-modal="true">
            <header>
              <div>
                <p>DTP Support</p>
                <h2>Report an issue</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close report form">
                x
              </button>
            </header>
            {sent ? (
              <div className="support-report-success">
                <strong>Issue received.</strong>
                <p>
                  The support console will recommend a playbook path for a human admin to review.
                </p>
                <button type="button" className="btn btn-primary" onClick={() => setOpen(false)}>
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={submit}>
                <label>
                  <span>I am reporting as</span>
                  <select
                    value={form.audience}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        audience: event.target.value as SupportAudience,
                      }))
                    }
                  >
                    {AUDIENCES.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Category</span>
                  <select
                    value={form.category}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, category: event.target.value }))
                    }
                  >
                    {CATEGORIES.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Severity</span>
                  <select
                    value={form.severity}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, severity: event.target.value }))
                    }
                  >
                    {SEVERITIES.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Subject</span>
                  <input
                    value={form.subject}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, subject: event.target.value }))
                    }
                    required
                    minLength={4}
                    maxLength={160}
                    placeholder="Example: Timeline CSV did not link player history"
                  />
                </label>
                <label>
                  <span>What happened?</span>
                  <textarea
                    value={form.description}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, description: event.target.value }))
                    }
                    required
                    minLength={10}
                    rows={5}
                    placeholder="Include what you expected, what happened, and any match/player name involved."
                  />
                </label>
                <div className="support-report-modal__grid">
                  <label>
                    <span>Name</span>
                    <input
                      value={form.reporterName}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, reporterName: event.target.value }))
                      }
                    />
                  </label>
                  <label>
                    <span>Email</span>
                    <input
                      type="email"
                      value={form.reporterEmail}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, reporterEmail: event.target.value }))
                      }
                    />
                  </label>
                </div>
                {error && <p className="dtp-error-banner">{error}</p>}
                <footer>
                  <button type="button" onClick={() => setOpen(false)} disabled={saving}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? "Submitting..." : "Submit report"}
                  </button>
                </footer>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
