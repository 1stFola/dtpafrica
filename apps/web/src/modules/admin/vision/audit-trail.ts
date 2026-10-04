/**
 * The audit screen's own rules, apart from the page so they can be tested:
 * what the filters are, how they sit in the address bar, how a day the reader
 * picked becomes the moments the API is asked for, and how a row's actor and
 * target are put into words.
 */

export type AuditFilters = {
  action: string;
  targetKind: string;
  targetId: string;
  actor: string;
  method: string;
  /** A day as the date input gives it, `YYYY-MM-DD`, in the reader's own time zone. */
  from: string;
  to: string;
};

export const NO_FILTERS: AuditFilters = { action: "", targetKind: "", targetId: "", actor: "", method: "", from: "", to: "" };

const KEYS = Object.keys(NO_FILTERS) as (keyof AuditFilters)[];

/** The filters are the address: a filtered trail can be bookmarked and sent to someone. */
export function filtersFromParams(params: URLSearchParams): AuditFilters {
  const out = { ...NO_FILTERS };
  for (const key of KEYS) out[key] = (params.get(key) ?? "").trim();
  return out;
}

export function paramsFromFilters(filters: AuditFilters): URLSearchParams {
  const out = new URLSearchParams();
  for (const key of KEYS) {
    const value = filters[key].trim();
    if (value) out.set(key, value);
  }
  return out;
}

export function activeFilterCount(filters: AuditFilters): number {
  return KEYS.filter((key) => filters[key].trim()).length;
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A picked day as a moment: its first millisecond, or its last. The reader means
 * their own day, so the moment is made in their time zone and sent as UTC.
 * Anything that is not a day comes back as null and is not sent.
 */
export function dayBoundary(day: string, edge: "start" | "end"): string | null {
  const m = DAY.exec(day.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const at = edge === "start" ? new Date(y, mo - 1, d, 0, 0, 0, 0) : new Date(y, mo - 1, d, 23, 59, 59, 999);
  // `new Date(2026, 1, 31)` rolls over into March. A day that does not exist is not a day.
  if (at.getFullYear() !== y || at.getMonth() !== mo - 1 || at.getDate() !== d) return null;
  return at.toISOString();
}

/** What is sent to the API for a set of filters: the same, with the days turned into moments. */
export function requestFor(filters: AuditFilters): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of KEYS) {
    const value = filters[key].trim();
    if (!value) continue;
    if (key === "from" || key === "to") {
      const at = dayBoundary(value, key === "from" ? "start" : "end");
      if (at) out[key] = at;
    } else {
      out[key] = value;
    }
  }
  return out;
}

export type AuditActorRow = { actorId: string | null; actorEmail: string | null; actorMethod: string | null };

/**
 * Who did it, in words. Three of the four answers are not a person, and the
 * screen says so plainly instead of leaving an empty cell to be read as a gap.
 */
export function describeActor(row: AuditActorRow): { who: string; how: string; person: boolean } {
  if (row.actorMethod === "provision_key") return { who: "the worker on the box", how: "provision key", person: false };
  if (row.actorMethod === "api_key") return { who: "the operator key", how: "shared key, no person", person: false };
  if (row.actorEmail) return { who: row.actorEmail, how: "signed in", person: true };
  if (row.actorId) return { who: `admin ${row.actorId.slice(0, 8)}`, how: "signed in", person: true };
  return { who: "the system", how: "no actor recorded", person: false };
}

/** `media.raw.read` is `media`; an action with no dot is its own family. */
export function familyOf(action: string): string {
  const dot = action.indexOf(".");
  return dot === -1 ? action : action.slice(0, dot);
}

/** The actions grouped by family, in the order the API lists them, for the filter's menu. */
export function actionFamilies(actions: readonly string[]): { family: string; actions: string[] }[] {
  const out: { family: string; actions: string[] }[] = [];
  for (const action of actions) {
    const family = familyOf(action);
    let group = out.find((g) => g.family === family);
    if (!group) {
      group = { family, actions: [] };
      out.push(group);
    }
    group.actions.push(action);
  }
  return out;
}

/** `vision_video_asset` reads as `video asset`. */
export function describeKind(targetKind: string): string {
  return targetKind.replace(/^vision_/, "").replace(/_/g, " ");
}

/** The page a target can be opened on, for the kinds that have one. */
export function targetLink(targetKind: string, targetId: string | null): string | null {
  if (!targetId) return null;
  if (targetKind === "vision_source_video_record") return `/admin/vision/sources/${targetId}`;
  if (targetKind === "vision_video_asset") return `/admin/vision/events?asset=${targetId}`;
  return null;
}

/** Whether a row has anything behind "Details". */
export function hasDetails(data: unknown): boolean {
  return data !== null && typeof data === "object" && Object.keys(data as object).length > 0;
}
