import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { adminApi } from "../../../api/admin";
import { fetchCompetitions, type SbCompetition, type SbMatchListItem } from "../../../api/scoreboard";
import { usePageTitle } from "../../../hooks/usePageTitle";

/**
 * Fixtures calendar — a staff-facing view of every published fixture across
 * every competition, browsable by month, week or day.
 *
 * Read-only by design: nothing here mutates a fixture. It exists so staff can
 * answer "what is on, and when" without pivoting competition by competition.
 *
 * Only published fixtures under published competitions are shown; the endpoint
 * enforces that server-side rather than trusting a client filter.
 */

type ViewMode = "month" | "week" | "day";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/* ---------- date helpers (local time, Monday-first weeks) ---------- */

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function endOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(23, 59, 59, 999);
  return out;
}

/** Monday-first: JS getDay() is 0=Sun, so Sunday maps to offset 6. */
function startOfWeek(d: Date): Date {
  const out = startOfDay(d);
  const offset = (out.getDay() + 6) % 7;
  out.setDate(out.getDate() - offset);
  return out;
}

function startOfMonth(d: Date): Date {
  const out = startOfDay(d);
  out.setDate(1);
  return out;
}

function endOfMonth(d: Date): Date {
  const out = startOfDay(d);
  out.setMonth(out.getMonth() + 1, 0);
  return endOfDay(out);
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

/** Stable local YYYY-MM-DD key — never via toISOString(), which shifts to UTC. */
function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function sameDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b);
}

/**
 * The window to request for a given view. Month is padded out to whole weeks
 * so the leading/trailing cells of the grid carry their real fixtures.
 */
function rangeFor(view: ViewMode, anchor: Date): { from: Date; to: Date } {
  if (view === "day") return { from: startOfDay(anchor), to: endOfDay(anchor) };
  if (view === "week") {
    const from = startOfWeek(anchor);
    return { from, to: endOfDay(addDays(from, 6)) };
  }
  const from = startOfWeek(startOfMonth(anchor));
  const lastCell = addDays(startOfWeek(endOfMonth(anchor)), 6);
  return { from, to: endOfDay(lastCell) };
}

/* ---------- presentation helpers ---------- */

const STATUS_LABEL: Record<string, string> = {
  scheduled: "Scheduled",
  live: "Live",
  halftime: "Half time",
  finished: "Full time",
  postponed: "Postponed",
  cancelled: "Cancelled",
};

function statusTone(status: string): string {
  if (status === "live" || status === "halftime") return "live";
  if (status === "finished") return "done";
  if (status === "postponed" || status === "cancelled") return "off";
  return "upcoming";
}

function kickoffTime(iso: string | null): string {
  if (!iso) return "TBC";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "TBC";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function initials(name: string): string {
  const words = name.replace(/\b(FC|SC|FA|AFC)\b/gi, "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return name.slice(0, 2).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * SbCompetition carries no crest field, so each competition gets a stable hue
 * derived from its id. Deterministic, so a competition keeps its colour across
 * reloads and views. Swap for a real crest once the model has one.
 */
function competitionHue(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) % 360;
  return hash;
}

/**
 * Monogram for a competition. The season year is dropped first, otherwise
 * "1XCup 2026" reduces to "12" — a first-letter-per-word rule reads the year
 * as a word. Single-word names keep their first two characters ("1X"), so
 * numeric-leading names stay recognisable.
 */
function competitionMonogram(name: string): string {
  const cleaned = name
    .replace(/\b(19|20)\d{2}\b/g, "")
    .replace(/\b(cup|league|championship|tournament)\b/gi, "")
    .trim();
  const base = cleaned || name;
  const words = base.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return words[0].slice(0, 2).toUpperCase();
}

function TeamCrestMini({ name, logoUrl }: { name: string; logoUrl?: string | null }) {
  if (logoUrl) {
    return (
      <span className="afx-crest">
        <img src={logoUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
      </span>
    );
  }
  return (
    <span className="afx-crest afx-crest--fallback" aria-hidden="true">
      {initials(name)}
    </span>
  );
}

function CompetitionMark({ competition }: { competition: SbMatchListItem["competition"] }) {
  const hue = competitionHue(competition.id);
  /* Competitions that have no crest — or whose crest URL 404s — fall back to
     the tinted monogram rather than leaving a hole in the row. */
  const [failed, setFailed] = useState(false);
  const showLogo = Boolean(competition.logoUrl) && !failed;
  return (
    <span
      className="afx-comp-mark"
      style={{ "--afx-comp-hue": String(hue) } as React.CSSProperties}
      title={competition.name}
    >
      {showLogo ? (
        <img
          src={competition.logoUrl as string}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        competitionMonogram(competition.name)
      )}
    </span>
  );
}

/**
 * Compact one-line entry used inside month cells. Three stacked cards in a
 * ~130px cell read as clutter, so the month grid carries only what scans at a
 * glance — kickoff, both crests, the tie — and the day modal holds the detail.
 */
function FixtureRow({ match }: { match: SbMatchListItem }) {
  const tone = statusTone(match.status);
  const hue = competitionHue(match.competition.id);
  return (
    <span
      className={`afx-row afx-row--${tone}`}
      style={{ "--afx-comp-hue": String(hue) } as React.CSSProperties}
      title={`${kickoffTime(match.kickoffAt)} · ${match.homeTeam.name} v ${match.awayTeam.name} · ${match.competition.name}`}
    >
      <span className="afx-row__time">{kickoffTime(match.kickoffAt)}</span>
      <span className="afx-row__crests">
        <TeamCrestMini name={match.homeTeam.name} logoUrl={match.homeTeam.logoUrl} />
        <TeamCrestMini name={match.awayTeam.name} logoUrl={match.awayTeam.logoUrl} />
      </span>
      <span className="afx-row__tie">
        {match.homeTeam.shortName ?? match.homeTeam.name}
        <span className="afx-row__v">v</span>
        {match.awayTeam.shortName ?? match.awayTeam.name}
      </span>
      {tone === "live" && <span className="afx-pulse afx-row__live" aria-hidden="true" />}
    </span>
  );
}

function FixtureCard({ match, dense }: { match: SbMatchListItem; dense?: boolean }) {
  const tone = statusTone(match.status);
  const scored = match.status !== "scheduled" && match.status !== "postponed" && match.status !== "cancelled";
  return (
    <article className={`afx-fixture afx-fixture--${tone}${dense ? " afx-fixture--dense" : ""}`}>
      <header className="afx-fixture__top">
        <span className="afx-fixture__time">{kickoffTime(match.kickoffAt)}</span>
        <span className={`afx-chip afx-chip--${tone}`}>
          {tone === "live" && <span className="afx-pulse" aria-hidden="true" />}
          {STATUS_LABEL[match.status] ?? match.status}
        </span>
      </header>

      <div className="afx-fixture__teams">
        <span className="afx-team">
          <TeamCrestMini name={match.homeTeam.name} logoUrl={match.homeTeam.logoUrl} />
          <span className="afx-team__name">{match.homeTeam.name}</span>
          {scored && <span className="afx-team__score">{match.homeScore}</span>}
        </span>
        <span className="afx-team">
          <TeamCrestMini name={match.awayTeam.name} logoUrl={match.awayTeam.logoUrl} />
          <span className="afx-team__name">{match.awayTeam.name}</span>
          {scored && <span className="afx-team__score">{match.awayScore}</span>}
        </span>
      </div>

      <footer className="afx-fixture__meta">
        <CompetitionMark competition={match.competition} />
        <span className="afx-fixture__comp">{match.competition.name}</span>
        {match.roundLabel && <span className="afx-fixture__round">{match.roundLabel}</span>}
        {match.venue && <span className="afx-fixture__venue">{match.venue}</span>}
      </footer>
    </article>
  );
}

/**
 * Day detail modal. Portalled to <body> so no ancestor stacking context can
 * trap it behind the admin chrome.
 */
function DayModal({
  date,
  matches,
  onClose,
}: {
  date: Date;
  matches: SbMatchListItem[];
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    // The page behind must not scroll while the dialog is open.
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = priorOverflow;
      previous?.focus?.();
    };
  }, []);

  /* Grouped by competition so a busy day reads as a few blocks, not a wall. */
  const groups = useMemo(() => {
    const map = new Map<
      string,
      { name: string; id: string; competition: SbMatchListItem["competition"]; items: SbMatchListItem[] }
    >();
    for (const m of matches) {
      const g = map.get(m.competition.id);
      if (g) g.items.push(m);
      else
        map.set(m.competition.id, {
          name: m.competition.name,
          id: m.competition.id,
          competition: m.competition,
          items: [m],
        });
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [matches]);

  return createPortal(
    <div className="afx-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="afx-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Fixtures on ${date.toDateString()}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="afx-modal__head">
          <div>
            <p className="afx-modal__eyebrow">
              {date.toLocaleDateString(undefined, { weekday: "long" })}
            </p>
            <h2 className="afx-modal__title">
              {date.toLocaleDateString(undefined, {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </h2>
          </div>
          <div className="afx-modal__headmeta">
            <span className="afx-modal__count">
              {matches.length} fixture{matches.length === 1 ? "" : "s"}
            </span>
            <button
              ref={closeRef}
              type="button"
              className="afx-modal__close"
              onClick={onClose}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </header>

        <div className="afx-modal__body">
          {matches.length === 0 ? (
            <p className="afx-empty afx-empty--lg">No published fixtures on this day.</p>
          ) : (
            groups.map((g) => (
              <section key={g.id} className="afx-modal__group">
                <header className="afx-modal__grouphead">
                  <CompetitionMark competition={g.competition} />
                  <h3>{g.name}</h3>
                  <span className="afx-modal__groupcount">{g.items.length}</span>
                </header>
                <div className="afx-modal__list">
                  {g.items.map((m) => (
                    <FixtureCard key={m.id} match={m} />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ---------- page ---------- */

export function AdminFixturesPage() {
  usePageTitle("Fixtures calendar");

  const [view, setView] = useState<ViewMode>("month");
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()));
  const [matches, setMatches] = useState<SbMatchListItem[]>([]);
  const [competitions, setCompetitions] = useState<SbCompetition[]>([]);
  const [competitionId, setCompetitionId] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Day whose fixtures are open in the detail modal, or null when closed. */
  const [dayModal, setDayModal] = useState<Date | null>(null);

  const range = useMemo(() => rangeFor(view, anchor), [view, anchor]);

  useEffect(() => {
    fetchCompetitions()
      .then(setCompetitions)
      .catch(() => setCompetitions([]));
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    adminApi
      .fixturesCalendar({
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        competitionId: competitionId || undefined,
        status: status || undefined,
      })
      .then((rows) => {
        if (!active) return;
        setMatches(Array.isArray(rows) ? rows : []);
      })
      .catch((e) => {
        if (active) setError(String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [range.from, range.to, competitionId, status]);

  /** Fixtures bucketed by local day so each cell renders in one lookup. */
  const byDay = useMemo(() => {
    const map = new Map<string, SbMatchListItem[]>();
    for (const m of matches) {
      if (!m.kickoffAt) continue;
      const d = new Date(m.kickoffAt);
      if (Number.isNaN(d.getTime())) continue;
      const key = dayKey(d);
      const list = map.get(key);
      if (list) list.push(m);
      else map.set(key, [m]);
    }
    return map;
  }, [matches]);

  const scheduledCount = useMemo(
    () => matches.filter((m) => m.kickoffAt).length,
    [matches]
  );

  const step = (dir: number) => {
    setAnchor((prev) => {
      if (view === "day") return addDays(prev, dir);
      if (view === "week") return addDays(prev, dir * 7);
      const out = new Date(prev);
      out.setMonth(out.getMonth() + dir, 1);
      return out;
    });
  };

  const heading = useMemo(() => {
    if (view === "month") {
      return anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    }
    if (view === "week") {
      const from = startOfWeek(anchor);
      const to = addDays(from, 6);
      const sameMonth = from.getMonth() === to.getMonth();
      return `${from.toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${to.toLocaleDateString(
        undefined,
        sameMonth
          ? { day: "numeric", month: "short", year: "numeric" }
          : { day: "numeric", month: "short", year: "numeric" }
      )}`;
    }
    return anchor.toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }, [view, anchor]);

  const monthCells = useMemo(() => {
    if (view !== "month") return [];
    const first = startOfWeek(startOfMonth(anchor));
    return Array.from({ length: 42 }, (_, i) => addDays(first, i));
  }, [view, anchor]);

  const weekDays = useMemo(() => {
    if (view !== "week") return [];
    const first = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(first, i));
  }, [view, anchor]);

  const today = startOfDay(new Date());

  return (
    <section className="admin-page admin-sb-section afx-page">
      <header className="afx-header">
        <div className="afx-header__lead">
          <h1>Fixtures calendar</h1>
          <p className="afx-header__sub">
            Every published fixture across all competitions.
            {!loading && (
              <>
                {" "}
                <strong>{scheduledCount}</strong> in view.
              </>
            )}
          </p>
        </div>

        <div className="afx-toolbar">
          <div className="afx-segmented" role="group" aria-label="Calendar view">
            {(["month", "week", "day"] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`afx-segmented__btn${view === mode ? " is-active" : ""}`}
                aria-pressed={view === mode}
                onClick={() => setView(mode)}
              >
                {mode[0].toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>

          <div className="afx-nav">
            <button type="button" className="afx-nav__btn" onClick={() => step(-1)} aria-label="Previous">
              ‹
            </button>
            <button
              type="button"
              className="afx-nav__today"
              onClick={() => setAnchor(startOfDay(new Date()))}
            >
              Today
            </button>
            <button type="button" className="afx-nav__btn" onClick={() => step(1)} aria-label="Next">
              ›
            </button>
          </div>

          <label className="afx-field">
            <span className="sr-only">Jump to date</span>
            <input
              type="date"
              className="afx-input"
              value={dayKey(anchor)}
              onChange={(e) => {
                const [y, m, d] = e.target.value.split("-").map(Number);
                if (y && m && d) setAnchor(startOfDay(new Date(y, m - 1, d)));
              }}
            />
          </label>

          <label className="afx-field">
            <span className="sr-only">Competition</span>
            <select
              className="afx-input"
              value={competitionId}
              onChange={(e) => setCompetitionId(e.target.value)}
            >
              <option value="">All competitions</option>
              {competitions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label className="afx-field">
            <span className="sr-only">Status</span>
            <select className="afx-input" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any status</option>
              <option value="scheduled">Scheduled</option>
              <option value="live">Live</option>
              <option value="finished">Finished</option>
              <option value="postponed">Postponed</option>
            </select>
          </label>
        </div>
      </header>

      <div className="afx-periodbar">
        <h2 className="afx-period">{heading}</h2>
        {loading && <span className="afx-loading">Loading…</span>}
      </div>

      {error && <p className="afx-error">Could not load fixtures: {error}</p>}

      {/* A filtered period with no fixtures otherwise renders as a blank grid,
          which reads as a failure rather than an answer. */}
      {!loading && !error && scheduledCount === 0 && (
        <p className="afx-notice">
          No published fixtures in this {view}
          {competitionId
            ? ` for ${competitions.find((c) => c.id === competitionId)?.name ?? "this competition"}`
            : ""}
          {status ? ` with status “${status}”` : ""}.
          {(competitionId || status) && " Try widening the filters or moving to another period."}
        </p>
      )}

      {view === "month" && (
        <div className="afx-month">
          <div className="afx-month__head" aria-hidden="true">
            {WEEKDAYS.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="afx-month__grid">
            {monthCells.map((cell) => {
              const list = byDay.get(dayKey(cell)) ?? [];
              const outside = cell.getMonth() !== anchor.getMonth();
              const label = `${cell.toDateString()} — ${list.length} fixture${
                list.length === 1 ? "" : "s"
              }`;
              /* The whole cell is the target, so there is no small date-number
                 button to hunt for. */
              return (
                <button
                  key={dayKey(cell)}
                  type="button"
                  className={`afx-cell${outside ? " is-outside" : ""}${
                    sameDay(cell, today) ? " is-today" : ""
                  }${list.length ? " has-fixtures" : ""}`}
                  onClick={() => setDayModal(cell)}
                  aria-label={label}
                  title={label}
                >
                  <span className="afx-cell__date">
                    {cell.getDate()}
                    {list.length > 0 && <span className="afx-cell__count">{list.length}</span>}
                  </span>
                  <span className="afx-cell__items">
                    {list.slice(0, 3).map((m) => (
                      <FixtureRow key={m.id} match={m} />
                    ))}
                    {list.length > 3 && (
                      <span className="afx-cell__more">+{list.length - 3} more</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {view === "week" && (
        <div className="afx-week">
          {weekDays.map((d) => {
            const list = byDay.get(dayKey(d)) ?? [];
            return (
              <div key={dayKey(d)} className={`afx-weekday${sameDay(d, today) ? " is-today" : ""}`}>
                <button
                  type="button"
                  className="afx-weekday__head"
                  onClick={() => setDayModal(d)}
                  aria-label={`${d.toDateString()} — ${list.length} fixture${
                    list.length === 1 ? "" : "s"
                  }`}
                >
                  <span className="afx-weekday__dow">
                    {d.toLocaleDateString(undefined, { weekday: "short" })}
                  </span>
                  <span className="afx-weekday__num">{d.getDate()}</span>
                  {list.length > 0 && <span className="afx-weekday__count">{list.length}</span>}
                </button>
                <div className="afx-weekday__items">
                  {list.length === 0 ? (
                    <p className="afx-empty">No fixtures</p>
                  ) : (
                    list.map((m) => <FixtureCard key={m.id} match={m} />)
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view === "day" && (
        <div className="afx-day">
          {(byDay.get(dayKey(anchor)) ?? []).length === 0 ? (
            <p className="afx-empty afx-empty--lg">
              No published fixtures on {anchor.toLocaleDateString()}.
            </p>
          ) : (
            <div className="afx-day__list">
              {(byDay.get(dayKey(anchor)) ?? []).map((m) => (
                <FixtureCard key={m.id} match={m} />
              ))}
            </div>
          )}
        </div>
      )}

      {dayModal && (
        <DayModal
          date={dayModal}
          matches={byDay.get(dayKey(dayModal)) ?? []}
          onClose={() => setDayModal(null)}
        />
      )}
    </section>
  );
}
