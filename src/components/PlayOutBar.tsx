import type { SearchBudget } from '@fulllifegames/eval-engine';
import { readSearchBudget, treeThresholdText } from '../lib/eval/search-budget-setting';

interface PlayOutBarProps {
  /** `stopping` is set after Stop with a turn in flight: the run ends when that turn landed. */
  playOut: { active: boolean; stopping?: unknown } | null;
  playOutNotice: { text: string; watchTurn: number } | null;
  hasVariation: boolean;
  ended?: boolean;
  viewTurn: number;
  atTurnZero?: boolean;
  startDisabled: boolean;
  fastPlayOut: boolean;
  onStartPlayOut: () => void;
  onStopPlayOut: () => void;
  onWatchFrom: (turn: number) => void;
  onFastPlayOutChange: (fast: boolean) => void;
}

function fastTitle(budget: SearchBudget): string {
  const where = (split: SearchBudget['singles']) => {
    const threshold = treeThresholdText(split);
    return threshold === null ? 'every turn' : `once ${threshold}`;
  };
  return 'The depth-1 matrix search evaluates every turn of the run instead of the Auto line. ' +
    `It runs much faster where Auto would run the tree search (doubles: ${where(budget.doubles)}; singles: ${where(budget.singles)}) ` +
    'and reads weaker there: the tree looks several turns ahead, the matrix one turn.';
}

function RunningRow({ fastPlayOut, stopping, onStopPlayOut }: Pick<PlayOutBarProps, 'fastPlayOut' | 'onStopPlayOut'> & { stopping: boolean }) {
  return (
    <>
      <span className="ps-spinner" aria-hidden="true" />
      <span style={{ fontSize: 11, color: '#f0c76b' }}>
        {stopping
          ? 'Stopping: the engine finishes the turn in flight, then stops.'
          : `Engine play-out running${fastPlayOut ? ' (fast: depth-1 matrix)' : ''}`}
      </span>
      <button type="button" className="ps-btn" onClick={() => onStopPlayOut()} disabled={stopping} style={{ padding: '2px 10px', fontSize: 11 }}>
        Stop
      </button>
    </>
  );
}

function StartRow({ viewTurn, atTurnZero, startDisabled, fastPlayOut, onStartPlayOut, onFastPlayOutChange }: Pick<PlayOutBarProps,
  'viewTurn' | 'atTurnZero' | 'startDisabled' | 'fastPlayOut' | 'onStartPlayOut' | 'onFastPlayOutChange'>) {
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
        {atTurnZero
          ? 'engine plays the game from turn 0 with the leads picked above'
          : `engine finishes the game from turn ${viewTurn}; watch the result from here afterwards`}
      </span>
      <label title={fastTitle(readSearchBudget())} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#aabbcc' }}>
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

export function PlayOutBar({
  playOut, playOutNotice, hasVariation, ended = false, viewTurn, atTurnZero = false, startDisabled, fastPlayOut,
  onStartPlayOut, onStopPlayOut, onWatchFrom, onFastPlayOutChange,
}: PlayOutBarProps) {
  return (
    <div className="ps-panel" style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {playOut?.active
        ? <RunningRow fastPlayOut={fastPlayOut} stopping={!!playOut.stopping} onStopPlayOut={onStopPlayOut} />
        : ended
        ? <span style={{ fontSize: 11, color: '#8fa3bd' }}>The game ended at this position: nothing left to play out.</span>
        : (
          <StartRow
            viewTurn={viewTurn} atTurnZero={atTurnZero} startDisabled={startDisabled} fastPlayOut={fastPlayOut}
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
