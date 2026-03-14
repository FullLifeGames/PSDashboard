interface Props {
  currentTurn: number;
  maxTurn: number;
  onTurnChange: (turn: number) => void;
  onPrev: () => void;
  onNext: () => void;
}

export function Timeline({ currentTurn, maxTurn, onTurnChange, onPrev, onNext }: Props) {
  return (
    <div className="ps-panel" style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          onClick={onPrev}
          disabled={currentTurn <= 1}
          className="ps-btn"
          style={{ padding: '4px 10px', fontSize: 14, lineHeight: 1 }}
        >
          &#9664;
        </button>

        <input
          type="range"
          min={1}
          max={maxTurn}
          value={currentTurn}
          onChange={e => onTurnChange(parseInt(e.target.value, 10))}
          aria-label="Turn selector"
          style={{ flex: 1 }}
        />

        <button
          type="button"
          onClick={onNext}
          disabled={currentTurn >= maxTurn}
          className="ps-btn"
          style={{ padding: '4px 10px', fontSize: 14, lineHeight: 1 }}
        >
          &#9654;
        </button>

        <span style={{ fontSize: 11, color: '#aab', minWidth: 80, textAlign: 'center' }}>
          Turn <strong style={{ color: '#fff' }}>{currentTurn}</strong> / {maxTurn}
        </span>
      </div>
    </div>
  );
}
