import type { SearchProgress } from '@fulllifegames/eval-engine';
import type { EvalStatus as EvalStatusKind } from '../../hooks/useEvaluation';

export interface PlayOutProgress {
  startTurn: number;
  turns: number;
  atTurn: number | null;
}

function PlayOutProgressLine({ playOutProgress }: { playOutProgress: PlayOutProgress }) {
  return (
    <div className="ps-playout-progress" role="status">
      <span className="ps-spinner" aria-hidden="true" />
      <span>
        Engine is playing both sides from turn {playOutProgress.startTurn} —{' '}
        {playOutProgress.turns} turn{playOutProgress.turns === 1 ? '' : 's'} played
        {playOutProgress.atTurn !== null && playOutProgress.atTurn > playOutProgress.startTurn
          ? `, now at turn ${playOutProgress.atTurn}` : ''}.
        The gold line below grows as it plays.
      </span>
    </div>
  );
}

/** The run state under the header: play-out, reconstruction, search progress, error, staleness. */
export function EvalStatus({ playOutProgress, status, reconstructProgress, progress, error }: {
  playOutProgress?: PlayOutProgress | null;
  status: EvalStatusKind;
  reconstructProgress: { turn: number; target: number } | null;
  progress: SearchProgress | null;
  error: string | null;
}) {
  return (
    <>
      {playOutProgress && <PlayOutProgressLine playOutProgress={playOutProgress} />}
      {!playOutProgress && status === 'reconstructing' && (
        <div style={{ fontSize: 11, color: '#fd6' }}>
          Rebuilding position…{reconstructProgress ? ` (turn ${reconstructProgress.turn}/${reconstructProgress.target})` : ''}
        </div>
      )}
      {!playOutProgress && status === 'searching' && (
        <>
          <div style={{ fontSize: 11, color: '#fd6' }}>
            Searching… depth {progress?.depth ?? 1}
          </div>
          <div className="ps-eval-progress">
            <div style={{ width: `${progress && progress.total > 0 ? Math.round((100 * progress.done) / progress.total) : 0}%` }} />
          </div>
        </>
      )}
      {status === 'error' && (
        <div role="alert" style={{ fontSize: 11, color: '#f3a6a6' }}>
          Evaluation failed: {error}
        </div>
      )}
      {!playOutProgress && status === 'stale' && (
        <div style={{ fontSize: 11, color: '#b6a46a', marginBottom: 4 }}>
          Position changed; re-evaluate.
        </div>
      )}
    </>
  );
}
