import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchVisionModels, type VisionModelRow } from "../../../api/vision";

export function carryVersions(models: VisionModelRow[]) {
  return models.filter((m) => m.task === "event").flatMap((m) => m.versions.filter((v) => v.configKey === "event-carry/v1" && v.weightsChecksum === null && v.weightsKey === null && v.stage !== "archived")
    .map((v) => ({ id: v.id, label: `${m.key} · ${v.version} · ${v.stage}` })));
}

export function EventCarryControl({ assetId, value, onChange, disabled }: { assetId: string; value: string; onChange: (id: string) => void; disabled: boolean }) {
  const [models, setModels] = useState<VisionModelRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => { let active = true; fetchVisionModels().then((data) => { if (active) setModels(data.models); }).catch((e) => { if (active) setError(e instanceof Error ? e.message : "Cannot load event rules."); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  const versions = carryVersions(models);
  return <div>
    <label className="vision-row"><span className="vision-row__label">Carry rule version</span>
      <select aria-label={`Carry rule version for ${assetId}`} value={value} disabled={disabled || loading} onChange={(e) => onChange(e.target.value)}>
        <option value="">{loading ? "Loading versions…" : "Choose a registered rule version…"}</option>
        {versions.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
      </select>
    </label>
    {error && <p role="alert">{error}</p>}
    <p className="vision-footnote">Requires a current calibrated possession run on a clip of at most five minutes. Carries need at least one second and two metres of observed movement. Import a completed run on the Events page for independent human review; accuracy still needs evaluation.</p>
    {!loading && !versions.length && !error && <p className="vision-footnote">No compatible carry rule is registered. <Link to="/admin/vision/models">Open the model registry</Link>.</p>}
  </div>;
}
