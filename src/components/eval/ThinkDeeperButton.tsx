import type { TurnEvalSettings } from '../../hooks/useEvaluation';
import type { EvalResult } from '../../lib/eval/types';

/**
 * One escalation control for both faces of the turn view: a gap turn gets
 * its first analysis, an analyzed turn re-searches one step deeper. The
 * label names the target so the click is never a surprise. Both faces
 * acquire through the HEALED single-turn reconstruction (per-turn
 * snapshot corrections, with the reached guard as the loud-failure
 * backstop) — the 2026-08-11 hide is resolved; see the calibration
 * header's think-deeper entries.
 */
export function ThinkDeeperButton({ onThinkDeeper, thinkDeeperTarget, disabled, smogonPending, result }: {
  onThinkDeeper?: () => void;
  thinkDeeperTarget?: TurnEvalSettings | { mode: 'auto' } | null;
  disabled: boolean | undefined;
  smogonPending?: boolean;
  result: EvalResult | null;
}) {
  if (!onThinkDeeper || !thinkDeeperTarget) return null;
  return (
    <button
      type="button"
      className="ps-btn"
      disabled={disabled}
      onClick={onThinkDeeper}
      title={smogonPending
        ? 'Waiting for Smogon data: searching now would build the teams without the guessed sets.'
        : 'Re-search this position (and its follow-up turn) at the named settings. The score, ranked moves, matrix, graph, and report update together.'}
      style={{ padding: '1px 6px', fontSize: 10 }}
    >
      {result ? 'Think deeper about this position' : 'Analyze this position'}
      {` (${thinkDeeperTarget.mode === 'mcts' ? 'MCTS'
        : thinkDeeperTarget.mode === 'auto' ? 'auto'
        : `depth ${thinkDeeperTarget.depth}`})`}
    </button>
  );
}
