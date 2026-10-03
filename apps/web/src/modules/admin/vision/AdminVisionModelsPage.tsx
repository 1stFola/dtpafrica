import { useCallback, useEffect, useState } from "react";
import {
  approveVisionPromotion,
  createVisionModel,
  fetchVisionBenchmarks,
  fetchVisionDatasets,
  fetchVisionModels,
  fetchVisionPromotions,
  registerVisionModelVersion,
  rejectVisionPromotion,
  requestVisionBenchmark,
  requestVisionPromotion,
  rollbackVisionModel,
  type VisionDatasetVersionRow,
  type VisionModelRow,
} from "../../../api/vision";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useAdminAuth } from "../AdminAuthContext";
import { useAdminVisionContext } from "./AdminVisionLayout";
import { Field, Panel, Pill, formatWhen, short, toneOfState, useAction } from "./vision-ui";

const TASKS = ["detect", "track", "identify", "calibrate", "event", "vlm"];

/**
 * The model registry: models and their versions, each with the actions its
 * stage allows -- benchmark against a frozen dataset, request promotion, a
 * different person approves or rejects, roll back. The licence note is
 * required at registration because the register says nothing ships without one.
 */
export function AdminVisionModelsPage() {
  usePageTitle("Models");
  const { hasPermission } = useAdminAuth();
  const { refreshOverview } = useAdminVisionContext();
  const [models, setModels] = useState<VisionModelRow[] | null>(null);
  const [datasets, setDatasets] = useState<VisionDatasetVersionRow[]>([]);
  const [report, setReport] = useState<{ title: string; body: unknown } | null>(null);
  const [newModel, setNewModel] = useState({ key: "", task: "detect", description: "" });
  const [versionFor, setVersionFor] = useState<string | null>(null);
  const [newVersion, setNewVersion] = useState({ version: "", gitCommit: "", configKey: "", workerImage: "", licenceNote: "", datasetVersionId: "", weightsKey: "", weightsChecksum: "" });
  const [benchDataset, setBenchDataset] = useState("");
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async () => {
    const [m, d] = await Promise.all([fetchVisionModels(), fetchVisionDatasets()]);
    setModels(m.models);
    setDatasets(d.versions.filter((v) => v.frozenAt));
    await refreshOverview();
  }, [refreshOverview]);
  const { busy, run, messages, setError } = useAction(load);

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [load, setError]);

  const canTrain = hasPermission("vision.models.train");
  const canPromote = hasPermission("vision.models.promote");

  async function show(title: string, fetcher: () => Promise<unknown>) {
    try {
      setReport({ title, body: await fetcher() });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="vision-page">
      {messages}
      {canTrain && (
        <Panel title="Register a model">
          <form
            className="vision-form vision-form--grid"
            onSubmit={(e) => {
              e.preventDefault();
              void run(`Model "${newModel.key}" registered. Register its first version next.`, async () => {
                await createVisionModel({ key: newModel.key.trim(), task: newModel.task, description: newModel.description.trim() || undefined });
                setNewModel({ key: "", task: "detect", description: "" });
              });
            }}
          >
            <Field label="Key" hint="e.g. detector/rf-detr-base">
              <input value={newModel.key} onChange={(e) => setNewModel({ ...newModel, key: e.target.value })} required />
            </Field>
            <Field label="Task">
              <select value={newModel.task} onChange={(e) => setNewModel({ ...newModel, task: e.target.value })}>
                {TASKS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Description">
              <input value={newModel.description} onChange={(e) => setNewModel({ ...newModel, description: e.target.value })} />
            </Field>
            <button type="submit" disabled={busy || !newModel.key.trim()}>
              Register model
            </button>
          </form>
        </Panel>
      )}

      <Panel title="Models">
        {models === null ? (
          <p className="muted">Loading…</p>
        ) : models.length === 0 ? (
          <p className="muted">No model registered. Every detection names its model version; nothing runs without one.</p>
        ) : (
          models.map((m) => (
            <section key={m.id} className="vision-model">
              <header className="vision-asset__head">
                <div>
                  <strong>{m.key}</strong> <Pill tone="muted">{m.task}</Pill>
                  <div className="vision-sub muted">{m.description ?? ""}</div>
                </div>
                {canTrain && (
                  <button type="button" onClick={() => setVersionFor(versionFor === m.id ? null : m.id)}>
                    {versionFor === m.id ? "Close" : "Register version"}
                  </button>
                )}
              </header>

              {versionFor === m.id && (
                <form
                  className="vision-form vision-form--grid"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(`Version ${newVersion.version} of ${m.key} registered as a candidate.`, async () => {
                      await registerVisionModelVersion(m.id, {
                        version: newVersion.version.trim(),
                        gitCommit: newVersion.gitCommit.trim(),
                        configKey: newVersion.configKey.trim(),
                        workerImage: newVersion.workerImage.trim(),
                        licenceNote: newVersion.licenceNote.trim(),
                        datasetVersionId: newVersion.datasetVersionId || undefined,
                        weightsKey: newVersion.weightsKey.trim() || undefined,
                        weightsChecksum: newVersion.weightsChecksum.trim() || undefined,
                      });
                      setVersionFor(null);
                    });
                  }}
                >
                  <Field label="Version" hint="e.g. 0.1">
                    <input value={newVersion.version} onChange={(e) => setNewVersion({ ...newVersion, version: e.target.value })} required />
                  </Field>
                  <Field label="Git commit" hint="the commit the model is reproducible from">
                    <input value={newVersion.gitCommit} onChange={(e) => setNewVersion({ ...newVersion, gitCommit: e.target.value })} required pattern="[0-9a-fA-F]{7,64}" />
                  </Field>
                  <Field label="Config key" hint="object key of the config that produced it">
                    <input value={newVersion.configKey} onChange={(e) => setNewVersion({ ...newVersion, configKey: e.target.value })} required />
                  </Field>
                  <Field label="Worker image">
                    <input value={newVersion.workerImage} onChange={(e) => setNewVersion({ ...newVersion, workerImage: e.target.value })} required />
                  </Field>
                  <Field label="Trained on" hint="a frozen dataset version; blank for a pretrained baseline">
                    <select value={newVersion.datasetVersionId} onChange={(e) => setNewVersion({ ...newVersion, datasetVersionId: e.target.value })}>
                      <option value="">pretrained baseline</option>
                      {datasets.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Weights key" hint="optional; the first run pins the checksum otherwise">
                    <input value={newVersion.weightsKey} onChange={(e) => setNewVersion({ ...newVersion, weightsKey: e.target.value })} />
                  </Field>
                  <Field label="Weights SHA-256" hint="optional">
                    <input value={newVersion.weightsChecksum} onChange={(e) => setNewVersion({ ...newVersion, weightsChecksum: e.target.value })} pattern="[0-9a-fA-F]{64}" />
                  </Field>
                  <Field label="Licence note" hint="required: code, weights and pretraining data, as the OSS register has them">
                    <textarea value={newVersion.licenceNote} onChange={(e) => setNewVersion({ ...newVersion, licenceNote: e.target.value })} rows={3} required minLength={10} />
                  </Field>
                  <button type="submit" disabled={busy}>
                    Register version
                  </button>
                </form>
              )}

              {m.versions.length === 0 ? (
                <p className="muted vision-sub">No versions.</p>
              ) : (
                <div className="admin-sb-table-wrap">
                  <table className="vision-table">
                    <thead>
                      <tr>
                        <th scope="col">Version</th>
                        <th scope="col">Stage</th>
                        <th scope="col">Commit</th>
                        <th scope="col">Weights</th>
                        <th scope="col">Runs</th>
                        <th scope="col">Registered</th>
                        <th scope="col" />
                      </tr>
                    </thead>
                    <tbody>
                      {m.versions.map((v) => (
                        <tr key={v.id}>
                          <td>
                            <strong>{v.version}</strong> <code className="vision-mono vision-sub">{short(v.id)}</code>
                          </td>
                          <td>
                            <Pill tone={toneOfState(v.stage)}>{v.stage}</Pill>
                            {v.promotedAt && <div className="vision-sub muted">promoted {formatWhen(v.promotedAt)}</div>}
                          </td>
                          <td className="vision-mono vision-sub">{v.gitCommit.slice(0, 8)}</td>
                          <td className="vision-sub muted">{v.weightsChecksum ? `pinned ${v.weightsChecksum.slice(0, 10)}…` : "unpinned"}</td>
                          <td>{v._count.jobs}</td>
                          <td className="muted vision-sub">{formatWhen(v.createdAt)}</td>
                          <td>
                            <div className="vision-inline">
                              <button type="button" onClick={() => void show(`Benchmarks of ${m.key} ${v.version}`, () => fetchVisionBenchmarks(v.id))}>
                                Benchmarks
                              </button>
                              <button type="button" onClick={() => void show(`Promotions of ${m.key} ${v.version}`, () => fetchVisionPromotions(v.id))}>
                                Promotions
                              </button>
                              {canTrain && (
                                <>
                                  <select value={benchDataset} onChange={(e) => setBenchDataset(e.target.value)} aria-label="Frozen dataset to benchmark against">
                                    <option value="">dataset…</option>
                                    {datasets.map((d) => (
                                      <option key={d.id} value={d.id}>
                                        {d.label}
                                      </option>
                                    ))}
                                  </select>
                                  <button type="button" disabled={busy || !benchDataset} onClick={() => run(`Benchmark of ${v.version} queued.`, () => requestVisionBenchmark(v.id, benchDataset))}>
                                    Benchmark
                                  </button>
                                  {v.stage === "benchmarked" && (
                                    <button type="button" disabled={busy} onClick={() => run(`Promotion of ${v.version} requested; a different person approves.`, () => requestVisionPromotion(v.id))}>
                                      Request promotion
                                    </button>
                                  )}
                                </>
                              )}
                              {canPromote && v.stage === "promotion_requested" && (
                                <>
                                  <button type="button" disabled={busy} onClick={() => run(`${v.version} promoted to production.`, () => approveVisionPromotion(v.id))}>
                                    Approve
                                  </button>
                                  <input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="reason" aria-label="Rejection reason" />
                                  <button
                                    type="button"
                                    disabled={busy || rejectReason.trim().length < 3}
                                    onClick={() =>
                                      run(`Promotion of ${v.version} rejected.`, async () => {
                                        const p = (await fetchVisionPromotions(v.id)) as { promotions?: { id: string; state: string }[] };
                                        const pending = p.promotions?.find((x) => x.state === "requested" || x.state === "pending");
                                        if (!pending) throw new Error("No pending promotion request found for this version.");
                                        await rejectVisionPromotion(pending.id, rejectReason.trim());
                                        setRejectReason("");
                                      })
                                    }
                                  >
                                    Reject
                                  </button>
                                </>
                              )}
                              {canPromote && v.stage === "production" && (
                                <button type="button" disabled={busy} onClick={() => run(`${v.version} rolled back; what it replaced is production again.`, () => rollbackVisionModel(v.id))}>
                                  Roll back
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
            </section>
          ))
        )}
      </Panel>

      {report && (
        <Panel title={report.title} actions={<button type="button" onClick={() => setReport(null)}>Close</button>}>
          <pre className="vision-pre">{JSON.stringify(report.body, null, 2)}</pre>
        </Panel>
      )}
    </div>
  );
}
