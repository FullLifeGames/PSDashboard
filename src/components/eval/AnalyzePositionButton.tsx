import type { TurnEvalSettings } from '../../hooks/useEvaluation';

/**
 * A gap turn's first analysis: a turn the line has not reached yet searches itself and its follow-up turn at the panel's settings.
 * An analyzed turn offers nothing: the deeper stage is "Think deeper".
 */
export function AnalyzePositionButton({ onAnalyze, target, disabled, smogonPending }: {
  onAnalyze?: () => void;
  target?: TurnEvalSettings | { mode: 'auto' } | null;
  disabled: boolean | undefined;
  smogonPending?: boolean;
}) {
  if (!onAnalyze || !target) return null;
  return (
    <button
      type="button"
      className="ps-btn"
      disabled={disabled}
      onClick={onAnalyze}
      title={smogonPending
        ? 'Waiting for Smogon data: searching now would build the teams without the guessed sets.'
        : 'Search this position and its follow-up turn at the named settings. The score, ranked moves, matrix, graph, and report fill in together.'}
      style={{ padding: '1px 6px', fontSize: 10 }}
    >
      Analyze this position
      {` (${target.mode === 'mcts' ? 'MCTS'
        : target.mode === 'auto' ? 'auto'
        : `depth ${target.depth}`})`}
    </button>
  );
}
