interface PlayOutBarProps {
  playOut: { active: boolean } | null;
  playOutNotice: { text: string; watchTurn: number } | null;
  hasVariation: boolean;
  viewTurn: number;
  startDisabled: boolean;
  /** The session option: depth-1 matrix on every turn of the run. */
  fastPlayOut: boolean;
  onStartPlayOut: () => void;
  onStopPlayOut: () => void;
  onWatchFrom: (turn: number) => void;
  onFastPlayOutChange: (fast: boolean) => void;
}

const FAST_TITLE = 'Every turn of the run is evaluated by the depth-1 matrix search instead of the Auto line. ' +
  'Much faster once Pokémon have fainted, and weaker there: the tree search looks several turns ahead, this one looks one turn ahead.';

/** The running state: spinner, the fast marker, and Stop. */
function RunningRow({ fastPlayOut, onStopPlayOut }: Pick<PlayOutBarProps, 'fastPlayOut' | 'onStopPlayOut'>) {
  return (
    <>
      <span className="ps-spinner" aria-hidden="true" />
      {/* The detailed progress line lives in the Evaluation
          panel (beside the growing graph) — one place, not two. */}
      <span style={{ fontSize: 11, color: '#f0c76b' }}>
        Engine play-out running{fastPlayOut ? ' (fast: depth-1 matrix)' : ''}
      </span>
      <button type="button" className="ps-btn" onClick={() => onStopPlayOut()} style={{ padding: '2px 10px', fontSize: 11 }}>
        Stop
      </button>
    </>
  );
}

/** The launcher with its hint and the fast option. */
function StartRow({ viewTurn, startDisabled, fastPlayOut, onStartPlayOut, onFastPlayOutChange }: Pick<PlayOutBarProps,
  'viewTurn' | 'startDisabled' | 'fastPlayOut' | 'onStartPlayOut' | 'onFastPlayOutChange'>) {
  return (
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
      <label title={FAST_TITLE} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#aabbcc' }}>
        <input
          type="checkbox"
          checked={fastPlayOut}
          onChange={event => onFastPlayOutChange(event.target.checked)}
          disabled={startDisabled}
        />
        Fast play-out
      </label>
    </>
  );
}

/** "Let it play out" launcher, the fast option, the running notice, and the finished-line watch entry. */
export function PlayOutBar({
  playOut, playOutNotice, hasVariation, viewTurn, startDisabled, fastPlayOut,
  onStartPlayOut, onStopPlayOut, onWatchFrom, onFastPlayOutChange,
}: PlayOutBarProps) {
  return (
    <div className="ps-panel" style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {playOut?.active
        ? <RunningRow fastPlayOut={fastPlayOut} onStopPlayOut={onStopPlayOut} />
        : (
          <StartRow
            viewTurn={viewTurn} startDisabled={startDisabled} fastPlayOut={fastPlayOut}
            onStartPlayOut={onStartPlayOut} onFastPlayOutChange={onFastPlayOutChange}
          />
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
