type Marker = {
  slotId: string;
  slotLabel: string;
  x: number;
  y: number;
  name: string;
  fitScore: number;
  overall: number;
  photoUrl?: string | null;
};

type Props = {
  markers: Marker[];
  onSelect?: (slotId: string) => void;
};

export function TacticalPitch({ markers, onSelect }: Props) {
  return (
    <div className="pitch-wrap">
      <div className="pitch" role="img" aria-label="Tactical formation pitch">
        <div className="pitch-line pitch-mid" />
        <div className="pitch-circle" />
        {markers.map((m) => (
          <button
            key={m.slotId}
            type="button"
            className="pitch-marker"
            style={{ left: `${m.x}%`, top: `${m.y}%` }}
            title={`${m.name} — fit ${m.fitScore}`}
            onClick={() => onSelect?.(m.slotId)}
          >
            <span className="marker-avatar">
              {m.photoUrl ? (
                <img src={m.photoUrl} alt="" />
              ) : (
                <span>{m.name.charAt(0)}</span>
              )}
            </span>
            <span className="marker-name">{m.name.split(" ").pop()}</span>
            <span className="marker-fit">{m.fitScore}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
