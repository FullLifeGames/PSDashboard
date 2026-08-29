interface PlayOutBarProps {
  playOut: { active: boolean } | null;
  playOutNotice: { text: string; watchTurn: number } | null;
  hasVariation: boolean;
  viewTurn: number;
  startDisabled: boolean;
  onStartPlayOut: () => void;
  onStopPlayOut: () => void;
  onWatchFrom: (turn: number) => void;
}

/** "Let it play out" launcher, the running notice, and the finished-line watch entry. */
export function PlayOutBar({
  playOut, playOutNotice, hasVariation, viewTurn, startDisabled,
  onStartPlayOut, onStopPlayOut, onWatchFrom,
}: PlayOutBarProps) {
  return (
    <div className="ps-panel" style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {playOut?.active ? (
        <>
          <span className="ps-spinner" aria-hidden="true" />
          {/* The detailed progress line lives in the Evaluation
              panel (beside the growing graph) — one place, not two. */}
          <span style={{ fontSize: 11, color: '#f0c76b' }}>
            Engine play-out running
          </span>
          <button type="button" className="ps-btn" onClick={() => onStopPlayOut()} style={{ padding: '2px 10px', fontSize: 11 }}>
            Stop
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="ps-btn"
            onClick={onStartPlayOut}
            disabled={startDisabled}
            title="The engine plays BOTH sides' best moves from the position you are viewing until the game ends. The view stays on this turn while it runs; when it stops, press play (or Watch) to see the finished line. Stop anytime; played turns stay in the variation."
            style={{ padding: '3px 10px', fontSize: 11, borderColor: 'rgba(240,199,107,0.5)' }}
          >
            &#9658; Let it play out
          </button>
          <span style={{ fontSize: 10, color: '#8fa3bd' }}>
            engine finishes the game from turn {viewTurn}; watch the result from here afterwards
          </span>
        </>
      )}
      {playOutNotice && !playOut?.active && (
        <span role="status" style={{ fontSize: 10, color: '#d4f5e0', display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {playOutNotice.text}
          {hasVariation && (
            <button
              type="button"
              className="ps-btn"
              onClick={() => onWatchFrom(playOutNotice.watchTurn)}
              title="Seek the battle window to where the play-out started and play it."
              style={{ padding: '1px 8px', fontSize: 10 }}
            >
              &#9658; Watch from turn {playOutNotice.watchTurn}
            </button>
          )}
        </span>
      )}
    </div>
  );
}
