import { useCallback, useEffect, useState } from "react";
import {
  addVisionDatasetMembers,
  createVisionDataset,
  exportVisionDataset,
  fetchVisionDataset,
  fetchVisionDatasetLeakage,
  fetchVisionDatasetRepresentation,
  fetchVisionDatasets,
  freezeVisionDataset,
  splitVisionDataset,
  type VisionDatasetVersionRow,
} from "../../../api/vision";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useAdminAuth } from "../AdminAuthContext";
import { useAdminVisionContext } from "./AdminVisionLayout";
import { Field, Panel, Pill, formatWhen, short, useAction } from "./vision-ui";

/**
 * Dataset versions: create one, add footage by asset id, generate the splits,
 * read the leakage and representation reports, freeze, export. The reports are
 * shown as the API returns them; they are the gate's evidence, not a chart.
 */
export function AdminVisionDatasetsPage() {
  usePageTitle("Datasets");
  const { hasPermission } = useAdminAuth();
  const { refreshOverview } = useAdminVisionContext();
  const [versions, setVersions] = useState<VisionDatasetVersionRow[] | null>(null);
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [report, setReport] = useState<{ kind: string; body: unknown } | null>(null);
  const [memberIds, setMemberIds] = useState("");

  const load = useCallback(async () => {
    setVersions((await fetchVisionDatasets()).versions);
    if (open) setDetail(await fetchVisionDataset(open));
    await refreshOverview();
  }, [open, refreshOverview]);
  const { busy, run, messages, setError } = useAction(load);

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [load, setError]);

  const canManage = hasPermission("vision.datasets.manage");

  async function show(id: string, kind: "leakage" | "representation") {
    try {
      setReport({ kind, body: kind === "leakage" ? await fetchVisionDatasetLeakage(id) : await fetchVisionDatasetRepresentation(id) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="vision-page">
      {messages}
      {canManage && (
        <Panel title="New dataset version">
          <form
            className="vision-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(`Dataset "${label}" created. Add footage, split, then freeze.`, async () => {
                await createVisionDataset({ label: label.trim(), description: description.trim() || undefined });
                setLabel("");
                setDescription("");
              });
            }}
          >
            <Field label="Label" hint="Unique. The gold benchmark and every model version name it.">
              <input value={label} onChange={(e) => setLabel(e.target.value)} required minLength={2} />
            </Field>
            <Field label="Description">
              <input value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <button type="submit" disabled={busy || label.trim().length < 2}>
              Create
            </button>
          </form>
        </Panel>
      )}

      <Panel title="Dataset versions">
        {versions === null ? (
          <p className="muted">Loading…</p>
        ) : versions.length === 0 ? (
          <p className="muted">None yet. A dataset version is the only thing a model may train or benchmark on, and only once frozen.</p>
        ) : (
          <div className="admin-sb-table-wrap">
            <table className="vision-table">
              <thead>
                <tr>
                  <th scope="col">Label</th>
                  <th scope="col">State</th>
                  <th scope="col">Members</th>
                  <th scope="col">Models</th>
                  <th scope="col">Created</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <button type="button" className="vision-linklike" onClick={() => setOpen(open === v.id ? null : v.id)}>
                        {v.label} {open === v.id ? "▾" : "▸"}
                      </button>
                      <div className="vision-sub muted">{v.description ?? ""}</div>
                    </td>
                    <td>{v.frozenAt ? <Pill tone="ok">frozen {formatWhen(v.frozenAt)}</Pill> : <Pill tone="warn">open</Pill>}</td>
                    <td>{v._count.members}</td>
                    <td>{v._count.modelVersions}</td>
                    <td className="muted vision-sub">{formatWhen(v.createdAt)}</td>
                    <td>
                      <div className="vision-inline">
                        <button type="button" onClick={() => void show(v.id, "leakage")}>
                          Leakage
                        </button>
                        <button type="button" onClick={() => void show(v.id, "representation")}>
                          Representation
                        </button>
                        {canManage && !v.frozenAt && (
                          <>
                            <button type="button" disabled={busy} onClick={() => run(`Splits generated for "${v.label}".`, () => splitVisionDataset(v.id))}>
                              Split
                            </button>
                            <button type="button" disabled={busy} onClick={() => run(`"${v.label}" frozen. It can be trained on and benchmarked now, and never changed.`, () => freezeVisionDataset(v.id))}>
                              Freeze
                            </button>
                          </>
                        )}
                        {canManage && v.frozenAt && (
                          <button type="button" disabled={busy} onClick={() => run(`Export of "${v.label}" queued.`, () => exportVisionDataset(v.id))}>
                            Export
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {open && (
        <Panel title={`Dataset ${short(open)}`}>
          {detail ? <pre className="vision-pre">{JSON.stringify(detail, null, 2)}</pre> : <p className="muted">Loading…</p>}
          {canManage && (
            <form
              className="vision-form"
              onSubmit={(e) => {
                e.preventDefault();
                const ids = memberIds.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
                void run(`${ids.length} asset(s) added. The eligibility firewall refuses any without training rights.`, async () => {
                  await addVisionDatasetMembers(open, ids);
                  setMemberIds("");
                });
              }}
            >
              <Field label="Add footage" hint="Asset ids, one per line or comma-separated; from the Footage page.">
                <textarea value={memberIds} onChange={(e) => setMemberIds(e.target.value)} rows={3} />
              </Field>
              <button type="submit" disabled={busy || !memberIds.trim()}>
                Add members
              </button>
            </form>
          )}
        </Panel>
      )}

      {report && (
        <Panel title={`${report.kind === "leakage" ? "Leakage report" : "Representation"}`} actions={<button type="button" onClick={() => setReport(null)}>Close</button>}>
          <pre className="vision-pre">{JSON.stringify(report.body, null, 2)}</pre>
        </Panel>
      )}
    </div>
  );
}
