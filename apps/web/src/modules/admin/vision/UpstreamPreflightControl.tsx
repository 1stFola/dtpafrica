import { useEffect, useRef, useState, type ReactNode } from "react";
import { fetchVisionBallTrajectoryPreflight, fetchVisionPossessionPreflight, type VisionBallTrajectoryPreflight, type VisionPossessionPreflight, type VisionPreflightBlocker } from "../../../api/vision";

function Blocker({ blocker }: { blocker: VisionPreflightBlocker }) {
  return <><p>First blocker: <strong>{blocker.error}</strong> — {blocker.message}</p><p>{blocker.remediation}</p><p>Resolve this blocker and recheck; later inputs have not all been verified.</p></>;
}

function Checked({ at }: { at: string }) {
  return <p className="vision-footnote">Checked {new Date(at).toLocaleString()}. This is a snapshot, not a reservation or a queued job.</p>;
}

export function BallTrajectoryPreflightResult({ result }: { result: VisionBallTrajectoryPreflight }) {
  return <div role="status">
    {result.ready ? <p>Ball trajectory inputs passed for detect run {result.detectJobId.slice(0, 8)} (detector {result.detectorVersionId.slice(0, 8)}) across {result.cameraSegments} declared camera window(s). A job operator must still queue the stage; queueing repeats these checks. Detector licensing and ball accuracy are separate.</p> : <Blocker blocker={result.blocker} />}
    <Checked at={result.checkedAt} />
  </div>;
}

export function PossessionPreflightResult({ result }: { result: VisionPossessionPreflight }) {
  return <div role="status">
    {result.ready ? <>
      <p>Calibrated possession inputs passed for ball trajectory {result.ballJobId.slice(0, 8)} and tracks {result.trackJobId.slice(0, 8)}; {result.calibratedSegments} of {result.cameraSegments} camera window(s) have a passing calibration. A job operator must still queue the stage; queueing repeats these checks.</p>
      {result.calibratedSegments < result.cameraSegments && <p>Windows without a passing calibration produce no pitch-constrained evidence. Calibrate them first if carry should cover them.</p>}
    </> : <Blocker blocker={result.blocker} />}
    <Checked at={result.checkedAt} />
  </div>;
}

function PreflightCheck<T extends { videoAssetId: string }>({ assetId, title, label, note, load, render }: {
  assetId: string; title: string; label: string; note: string; load: (assetId: string) => Promise<T>; render: (result: T) => ReactNode;
}) {
  const [result, setResult] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  useEffect(() => { setResult(null); setError(""); setBusy(false); return () => { request.current++; }; }, [assetId]);
  return <div>
    <h3>{title}</h3>
    <p>{note}</p>
    <button type="button" disabled={busy} onClick={async () => {
      const serial = ++request.current; setBusy(true); setError(""); setResult(null);
      try { const value = await load(assetId); if (serial === request.current) setResult(value); }
      catch (e) { if (serial === request.current) setError(e instanceof Error ? e.message : String(e)); }
      finally { if (serial === request.current) setBusy(false); }
    }}>{busy ? "Checking evidence…" : label}</button>
    {error && <p role="alert">Preflight unavailable: {error}</p>}
    {result?.videoAssetId === assetId && render(result)}
  </div>;
}

/** The two stages upstream of carry, checked the way queueing would check them, so a blocker is found where it starts. */
export function UpstreamPreflightControl({ assetId }: { assetId: string }) {
  return <>
    <PreflightCheck assetId={assetId} title="Check ball trajectory inputs" label="Check ball trajectory inputs" load={fetchVisionBallTrajectoryPreflight}
      note="Checks the latest completed detect run against the current source, proxy clock and camera declarations. No worker is launched and no compute is purchased."
      render={(result) => <BallTrajectoryPreflightResult result={result} />} />
    <PreflightCheck assetId={assetId} title="Check calibrated possession inputs" label="Check calibrated possession inputs" load={fetchVisionPossessionPreflight}
      note="Checks the latest completed ball trajectory and track runs with calibrated constraints, the only mode carry accepts. No worker is launched and no compute is purchased."
      render={(result) => <PossessionPreflightResult result={result} />} />
  </>;
}
