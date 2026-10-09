import type { VisionGameState, VisionReviewTrack } from "../../../api/vision";
import { DEFAULT_PITCH, describeCoverage, describeFrame, minimapViewBox, onMinimap, pitchLines, pitchSpots, type GameStateRow } from "./game-state";

/**
 * The tactical minimap: every track's foot point on the pitch at the playhead,
 * in metres, from the game-state chunk covering it. A track with no metres on
 * this frame is not drawn; the caption says how many and why. The map never
 * shows a position a calibration did not pass -- the rows arrive that way.
 */

export type MinimapStatus =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "gap" }
  | { kind: "ready" }
  | { kind: "blocked"; message: string };

type Props = {
  state: VisionGameState | null;
  status: MinimapStatus;
  rows: readonly GameStateRow[];
  /** The review tracks of the job the game state was placed from, by local track id. */
  tracksByLocalId: ReadonlyMap<number, VisionReviewTrack>;
  selectedId: string | null;
  onSelect: (trackId: string) => void;
  labelOf: (track: VisionReviewTrack | undefined, row: GameStateRow) => string;
};

export function VisionMinimap({ state, status, rows, tracksByLocalId, selectedId, onSelect, labelOf }: Props) {
  const dims = state?.pitch ?? DEFAULT_PITCH;
  const placed = rows.filter((r): r is GameStateRow & { xM: number; yM: number } => r.xM !== null && r.yM !== null && onMinimap(r.xM, r.yM, dims));
  const segmentHere = rows.find((r) => r.cameraSegmentId)?.cameraSegmentId ?? null;
  const qualityHere = rows.find((r) => r.quality)?.quality ?? null;

  return (
    <section className="vision-panel vision-minimap" aria-label="Tactical minimap">
      <div className="vision-minimap__head">
        <h3 className="vision-panel__title">Pitch</h3>
        <span className="vision-footnote">{describeCoverage(state?.coverage ?? null, state?.placedWith ?? null)}</span>
      </div>
      <svg className="vision-minimap__pitch" viewBox={minimapViewBox(dims)} role="img" aria-label={`Pitch ${dims.lengthM} by ${dims.widthM} metres`}>
        <rect x={-3} y={-3} width={dims.lengthM + 6} height={dims.widthM + 6} className="vision-minimap__grass" />
        {pitchLines(dims).map((line) => (
          <polyline key={line.id} className="vision-minimap__line" points={line.points.map(([x, y]) => `${x},${y}`).join(" ")} />
        ))}
        {pitchSpots(dims).map(([x, y]) => (
          <circle key={`${x}-${y}`} className="vision-minimap__spot" cx={x} cy={y} r={0.4} />
        ))}
        {placed.map((row) => {
          const track = tracksByLocalId.get(row.localTrackId);
          const selected = track ? track.id === selectedId : false;
          const team = track?.team?.team ?? null;
          /* Side and class were the dot's colour and nothing else. */
          const kind = row.class === "goalkeeper" ? "GK" : row.class === "referee" ? "ref" : row.class === "ball" ? "ball" : "";
          const mark = [team, kind].filter(Boolean).join(" ");
          return (
            <g
              key={row.localTrackId}
              className={["vision-dot", `vision-dot--${row.class}`, team ? `vision-dot--team-${team}` : "", selected ? "vision-dot--selected" : ""].filter(Boolean).join(" ")}
              transform={`translate(${row.xM} ${row.yM})`}
              role={track ? "button" : undefined}
              tabIndex={track ? 0 : undefined}
              aria-label={`${labelOf(track, row)} at ${row.xM.toFixed(1)}, ${row.yM.toFixed(1)} metres`}
              onPointerDown={(event) => {
                event.stopPropagation();
                if (track) onSelect(track.id);
              }}
              onKeyDown={(event) => {
                if (track && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault();
                  onSelect(track.id);
                }
              }}
            >
              <circle r={row.class === "ball" ? 0.8 : 1.3} />
              <text y={-2} textAnchor="middle">{row.class === "ball" ? "ball" : [mark, labelOf(track, row)].filter(Boolean).join(" ")}</text>
            </g>
          );
        })}
      </svg>
      <p className="vision-footnote vision-minimap__caption">
        {status.kind === "none" && "No game state for this footage yet: queue a gamestate job once a segment is calibrated."}
        {status.kind === "loading" && "Reading the chunk for this minute…"}
        {status.kind === "gap" && "No chunk covers this moment."}
        {status.kind === "blocked" && <span className="vision-minimap__blocked">{status.message}</span>}
        {status.kind === "ready" && (
          <>
            {describeFrame(rows)}
            {qualityHere && ` · calibration ${qualityHere}`}
            {segmentHere && <span className="vision-mono"> · segment {segmentHere.slice(0, 8)}</span>}
            {qualityHere === "carried"
              ? " · metres from this frame's calibration, carried from the segment's keyframes; a dot is a foot point the tracker saw"
              : " · metres from the calibration of the segment at the playhead; a dot is a foot point the tracker saw"}
          </>
        )}
      </p>
    </section>
  );
}
