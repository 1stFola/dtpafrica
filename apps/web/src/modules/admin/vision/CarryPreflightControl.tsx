import { useEffect, useRef, useState } from "react";
import { fetchVisionCarryPreflight, type VisionCarryPreflight } from "../../../api/vision";
import { EventCarryControl } from "./EventCarryControl";

export function CarryPreflightResult({ result }: { result: VisionCarryPreflight }) {
  return <div role="status">
    {result.ready ? <p>Carry evidence checks passed for rule {result.modelVersionId.slice(0, 8)} and possession {result.possessionJobId.slice(0, 8)}. A job operator must still queue the stage; queueing repeats these checks. Accuracy and licence approval are separate.</p> : <><p>First blocker: <strong>{result.blocker.error}</strong> — {result.blocker.message}</p><p>{result.blocker.remediation}</p><p>Resolve this blocker and recheck; later inputs have not all been verified.</p></>}
    <p className="vision-footnote">Checked {new Date(result.checkedAt).toLocaleString()}. This is a snapshot, not a reservation or a queued job.</p>
  </div>;
}

export function CarryPreflightControl({ assetId }: { assetId: string }) {
  const [version, setVersion] = useState("");
  const [result, setResult] = useState<VisionCarryPreflight | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  useEffect(() => { setResult(null); setError(""); setBusy(false); return () => { request.current++; }; }, [assetId, version]);
  return <div>
    <h3>Check carry compatibility</h3>
    <EventCarryControl assetId={assetId} value={version} onChange={setVersion} disabled={busy} />
    <p>With no selected rule, the check uses the registered production event version. It checks the latest completed possession run. No worker is launched and no compute is purchased.</p>
    <button type="button" disabled={busy} onClick={async () => {
      const serial = ++request.current; setBusy(true); setError(""); setResult(null);
      try { const value = await fetchVisionCarryPreflight(assetId, version || undefined); if (serial === request.current) setResult(value); }
      catch (e) { if (serial === request.current) setError(e instanceof Error ? e.message : String(e)); }
      finally { if (serial === request.current) setBusy(false); }
    }}>{busy ? "Checking evidence…" : "Check carry evidence"}</button>
    {error && <p role="alert">Preflight unavailable: {error}</p>}
    {result?.videoAssetId === assetId && <CarryPreflightResult result={result} />}
  </div>;
}
