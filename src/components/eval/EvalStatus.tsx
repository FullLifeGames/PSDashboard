import type { SearchProgress } from '@fulllifegames/eval-engine';
import type { EvalStatus as EvalStatusKind } from '../../hooks/useEvaluation';

export interface PlayOutProgress {
  startTurn: number;
  turns: number;
  atTurn: number | null;
  fast?: boolean;
  stopping?: boolean;
  game?: boolean;
}

function PlayOutProgressLine({ playOutProgress }: { playOutProgress: PlayOutProgress }) {
  return (
    <div className="ps-playout-progress" role="status">
      <span className="ps-spinner" aria-hidden="true" />
      <span>
        {playOutProgress.stopping
          ? 'Stopping: the engine finishes the turn in flight, then the play-out ends.'
          : `Engine is playing both sides from turn ${playOutProgress.startTurn}.`}{' '}
        {playOutProgress.turns} turn{playOutProgress.turns === 1 ? '' : 's'} played
        {playOutProgress.atTurn !== null && playOutProgress.atTurn > playOutProgress.startTurn
          ? `, now at turn ${playOutProgress.atTurn}` : ''}.
        {playOutProgress.stopping ? '' : playOutProgress.game ? ' The line below grows as it plays.' : ' The gold line below grows as it plays.'}
        {playOutProgress.fast && !playOutProgress.stopping ? ' Fast mode: every turn is a depth-1 matrix search.' : ''}
      </span>
    </div>
  );
}

/**
 * The line under a stale result. A search the user stopped says what it left: the first level of a search is the quick estimate (a forced
 * replacement's arrival values, a normal turn's depth-1 matrix), a later partial is the result so far. Any other stale result stands for a
 * position that changed.
 */
function StaleLine({ stoppedAt }: { stoppedAt: number | null }) {
  return (
    <div role={stoppedAt === null ? undefined : 'status'} style={{ fontSize: 11, color: '#b6a46a', marginBottom: 4 }}>
      {stoppedAt === null
        ? 'Position changed; re-evaluate.'
        : `Search stopped. Showing ${stoppedAt <= 1 ? 'the quick estimate' : 'the result so far'}.`}
    </div>
  );
}

function StopNote({ status, stoppedAt, stoppedEmpty }: { status: EvalStatusKind; stoppedAt: number | null; stoppedEmpty: boolean }) {
  if (status === 'stale') return <StaleLine stoppedAt={stoppedAt} />;
  if (status !== 'idle' || !stoppedEmpty) return null;
  return (
    <div role="status" style={{ fontSize: 11, color: '#b6a46a', marginBottom: 4 }}>
      Search stopped before a first result.
    </div>
  );
}

export function EvalStatus({ playOutProgress, status, reconstructProgress, progress, error, stoppedAt = null, stoppedEmpty = false }: {
  playOutProgress?: PlayOutProgress | null;
  status: EvalStatusKind;
  reconstructProgress: { turn: number; target: number } | null;
  progress: SearchProgress | null;
  error: string | null;
  stoppedAt?: number | null;
  stoppedEmpty?: boolean;
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
      {!playOutProgress && <StopNote status={status} stoppedAt={stoppedAt} stoppedEmpty={stoppedEmpty} />}
    </>
  );
}
