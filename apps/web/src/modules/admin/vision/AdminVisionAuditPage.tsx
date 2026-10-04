import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchVisionAudit, type VisionAuditFacets, type VisionAuditRow } from "../../../api/vision";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { NO_FILTERS, actionFamilies, activeFilterCount, describeActor, describeKind, filtersFromParams, hasDetails, paramsFromFilters, requestFor, targetLink, type AuditFilters } from "./audit-trail";
import { Panel, Pill, formatWhen, short } from "./vision-ui";

const PAGE = 50;

/**
 * The audit trail: who did what, newest first.
 *
 * It reads and does nothing else. The filters are the address, so a filtered
 * trail can be bookmarked or sent to someone; older rows are fetched a page at
 * a time from where the last page ended, so rows written while somebody reads
 * do not shift what they are looking at.
 */
export function AdminVisionAuditPage() {
  usePageTitle("Audit trail");
  const [params, setParams] = useSearchParams();
  const applied = useMemo(() => filtersFromParams(params), [params]);
  const [draft, setDraft] = useState<AuditFilters>(applied);
  const [rows, setRows] = useState<VisionAuditRow[] | null>(null);
  const [matching, setMatching] = useState<number | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [facets, setFacets] = useState<VisionAuditFacets | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* An answer to an earlier set of filters must not land on top of a later one. */
  const asked = useRef(0);

  const load = useCallback(async () => {
    const mine = ++asked.current;
    setError(null);
    setRows(null);
    try {
      const page = await fetchVisionAudit({ ...requestFor(applied), limit: PAGE });
      if (mine !== asked.current) return;
      setRows(page.items);
      setMatching(page.matching ?? null);
      setNextCursor(page.nextCursor);
      if (page.facets) setFacets(page.facets);
      setOpen(new Set());
    } catch (e) {
      if (mine !== asked.current) return;
      setRows([]);
      setMatching(null);
      setNextCursor(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [applied]);

  useEffect(() => {
    setDraft(applied);
    void load();
  }, [applied, load]);

  const older = async () => {
    if (!nextCursor || loadingMore) return;
    const mine = asked.current;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await fetchVisionAudit({ ...requestFor(applied), limit: PAGE, cursor: nextCursor });
      if (mine !== asked.current) return;
      setRows((before) => [...(before ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingMore(false);
    }
  };

  const apply = (next: AuditFilters) => setParams(paramsFromFilters(next));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    apply(draft);
  };
  const set = (key: keyof AuditFilters) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [key]: e.target.value }));
  const toggle = (id: string) =>
    setOpen((before) => {
      const next = new Set(before);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const families = useMemo(() => actionFamilies(facets?.actions ?? []), [facets]);
  const filtered = activeFilterCount(applied);

  return (
    <div className="vision-page">
      {error && <p className="vision-panel vision-panel--error">{error}</p>}
      <Panel
        title="Audit trail"
        actions={
          <button type="button" onClick={() => void load()}>
            Refresh
          </button>
        }
      >
        <form onSubmit={submit}>
          <div className="vision-filters">
            <label>
              <span>Action</span>
              <select value={draft.action} onChange={set("action")}>
                <option value="">Any action</option>
                {/* A filter in the address that the menu does not list is still shown as chosen. */}
                {draft.action && !families.some((g) => `${g.family}.` === draft.action || g.actions.includes(draft.action)) && <option value={draft.action}>{draft.action}</option>}
                {families.map((g) => (
                  <optgroup key={g.family} label={g.family}>
                    {g.actions.length > 1 && <option value={`${g.family}.`}>every {g.family} action</option>}
                    {g.actions.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label>
              <span>Who</span>
              <input value={draft.actor} onChange={set("actor")} placeholder="part of an email, or an admin id" />
            </label>
            <label>
              <span>Signed in with</span>
              <select value={draft.method} onChange={set("method")}>
                <option value="">Any</option>
                <option value="jwt">a person's sign-in</option>
                <option value="api_key">the operator key</option>
                <option value="provision_key">the worker's provision key</option>
                <option value="none">nothing: no actor recorded</option>
              </select>
            </label>
            <label>
              <span>Kind of thing</span>
              <select value={draft.targetKind} onChange={set("targetKind")}>
                <option value="">Any kind</option>
                {draft.targetKind && !(facets?.targetKinds ?? []).includes(draft.targetKind) && <option value={draft.targetKind}>{describeKind(draft.targetKind)}</option>}
                {(facets?.targetKinds ?? []).map((k) => (
                  <option key={k} value={k}>
                    {describeKind(k)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Its id</span>
              <input value={draft.targetId} onChange={set("targetId")} placeholder="the whole id" />
            </label>
            <label>
              <span>From</span>
              <input type="date" value={draft.from} max={draft.to || undefined} onChange={set("from")} />
            </label>
            <label>
              <span>To</span>
              <input type="date" value={draft.to} min={draft.from || undefined} onChange={set("to")} />
            </label>
          </div>
          <div className="vision-audit__buttons">
            <button type="submit">Show</button>
            {(filtered > 0 || activeFilterCount(draft) > 0) && (
              <button type="button" className="vision-audit__quiet" onClick={() => apply(NO_FILTERS)}>
                Clear filters
              </button>
            )}
          </div>
        </form>

        <p className="vision-footnote muted" aria-live="polite">
          {rows === null
            ? "Loading…"
            : error && rows.length === 0
              ? "The trail could not be read; the reason is above."
              : matching === null
                ? `${rows.length} row(s) shown.`
              : matching === 0
                ? filtered
                  ? "Nothing on the trail matches these filters."
                  : "Nothing has been written to the trail yet."
                : `${matching.toLocaleString()} row(s)${filtered ? " match" : " on the trail"}; showing the newest ${rows.length.toLocaleString()}. Days are yours, in this computer's time zone.`}
        </p>

        {rows && rows.length > 0 && (
          <div className="admin-sb-table-wrap">
            <table className="vision-table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">What</th>
                  <th scope="col">To what</th>
                  <th scope="col">Who</th>
                  <th scope="col">Reason</th>
                  <th scope="col">
                    <span className="vision-visually-hidden">Details</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const actor = describeActor(row);
                  const link = targetLink(row.targetKind, row.targetId);
                  const details = hasDetails(row.data);
                  const shown = open.has(row.id);
                  return (
                    <Fragment key={row.id}>
                      <tr>
                        <td className="vision-sub">{formatWhen(row.createdAt)}</td>
                        <td>
                          <code className="vision-mono">{row.action}</code>
                        </td>
                        <td className="vision-sub">
                          {describeKind(row.targetKind)}
                          {row.targetId && (
                            <div>
                              {link ? (
                                <Link to={link} title={row.targetId}>
                                  <code className="vision-mono">{short(row.targetId)}</code>
                                </Link>
                              ) : (
                                <code className="vision-mono" title={row.targetId}>
                                  {short(row.targetId)}
                                </code>
                              )}{" "}
                              <button type="button" className="vision-audit__quiet" onClick={() => apply({ ...NO_FILTERS, targetKind: row.targetKind, targetId: row.targetId ?? "" })}>
                                its trail
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="vision-sub">
                          {actor.who}
                          <div>
                            <Pill tone={actor.person ? "ok" : "muted"}>{actor.how}</Pill>
                          </div>
                        </td>
                        <td className="vision-sub vision-audit__reason">{row.reason ?? <span className="muted">—</span>}</td>
                        <td>
                          {details && (
                            <button type="button" className="vision-audit__quiet" aria-expanded={shown} aria-controls={`audit-${row.id}`} onClick={() => toggle(row.id)}>
                              {shown ? "Hide details" : "Details"}
                            </button>
                          )}
                        </td>
                      </tr>
                      {details && shown && (
                        <tr className="vision-table__detail" id={`audit-${row.id}`}>
                          <td colSpan={6}>
                            <pre className="vision-audit__data">{JSON.stringify(row.data, null, 2)}</pre>
                            <span className="muted vision-sub">
                              row <code className="vision-mono">{row.id}</code>
                              {row.targetId && (
                                <>
                                  {" "}
                                  · target <code className="vision-mono">{row.targetId}</code>
                                </>
                              )}
                              {row.actorId && (
                                <>
                                  {" "}
                                  · actor <code className="vision-mono">{row.actorId}</code>
                                </>
                              )}
                            </span>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {rows && rows.length > 0 && (
          <div className="vision-audit__buttons">
            {nextCursor ? (
              <button type="button" disabled={loadingMore} onClick={() => void older()}>
                {loadingMore ? "Loading…" : "Show older"}
              </button>
            ) : (
              <span className="muted vision-sub">That is the whole of it.</span>
            )}
          </div>
        )}

        <p className="vision-footnote muted">
          The trail is written as things happen and cannot be edited here or anywhere else. Reading it needs <code>vision.audit.read</code>.
        </p>
      </Panel>
    </div>
  );
}
