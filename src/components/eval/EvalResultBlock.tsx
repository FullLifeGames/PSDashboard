import { type EvalResult, type RankedChoice, formatLine, winDeltaText, winPercent } from '@fulllifegames/eval-engine';
import type { EvalStatus, TurnEvalSettings } from '../../hooks/useEvaluation';
import { EvalMatrixView } from '../EvalMatrixView';
import { MiniBar } from '../EvalTurnAnalysis';
import { exploreTitle } from './turn-copy';
import { rowLineTail } from '../../lib/row-line';

// Displayed values are win probabilities ("52%") and point deltas ("−8%").

type PickChoice = (side: 'p1' | 'p2', choice: RankedChoice, reply?: RankedChoice | null, from?: EvalResult | null) => void;

function ChoiceDetail({ choice, index, best, faintedFraction, tail }: {
  choice: RankedChoice; index: number; best: RankedChoice | undefined; faintedFraction?: number | null;
  /** The later steps of the row's line (`rowLineTail`): the line the Lines section shows, not the principal variation. */
  tail?: { p1: string; p2: string }[];
}) {
  const evPct = winPercent(choice.ev, faintedFraction);
  const gap = best ? choice.ev - best.ev : 0;
  return (
    <>
      <span className="ps-eval-choice-main">
        <span style={{ color: '#778' }}>{index + 1}.</span>
        <span style={{ color: '#cde', flex: '1 1 auto', minWidth: 0 }}>{choice.label}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', color: '#aab' }}>
          <MiniBar value={choice.ev} />
          {evPct}%
          {index > 0 && gap < 0 && <span style={{ color: '#778' }}>({winDeltaText(gap)})</span>}
        </span>
      </span>
      {tail && tail.length > 0 && (
        <span className="ps-eval-line">
          then {formatLine(tail)}
        </span>
      )}
    </>
  );
}

/**
 * The equilibrium value in the eval bar's language: the win odds this choice is worth against balanced play; the floor and the punishing
 * reply live in the tooltip.
 */
function choiceTooltip(choice: RankedChoice, clickable: boolean, faintedFraction?: number | null, opponentReads = false): string {
  return `Win probability ${winPercent(choice.ev, faintedFraction)}% vs balanced play; higher is better for this side` +
    ` · guaranteed at least ${winPercent(choice.worstCase, faintedFraction)}%` +
    (choice.punishedBy ? ` (worst reply: ${choice.punishedBy})` : '') +
    '. Choices are ranked by their value against balanced play.' +
    (clickable ? ' ' + exploreTitle(opponentReads) : '');
}

function ChoiceList({
  side, choices, reply, result, onPickChoice, faintedFraction, opponentReads,
}: {
  side: 'p1' | 'p2';
  choices: RankedChoice[];
  reply: RankedChoice | null;
  /** The result these rows are from: a click hands it on, so Hard mode can read the reply that hurts the clicked move most. */
  result: EvalResult;
  onPickChoice?: PickChoice;
  doubles?: boolean;
  faintedFraction?: number | null;
  opponentReads?: boolean;
}) {
  const best = choices[0];
  return (
    <div className="ps-eval-column">
      {choices.slice(0, 3).map((choice, index) => {
        const tooltip = choiceTooltip(choice, !!onPickChoice, faintedFraction, opponentReads);
        const detail = <ChoiceDetail choice={choice} index={index} best={best} faintedFraction={faintedFraction} tail={rowLineTail(result, side, choice, !!opponentReads)} />;
        return onPickChoice ? (
          <button
            key={choice.choice}
            type="button"
            className="ps-btn ps-eval-choice"
            title={tooltip}
            onClick={() => onPickChoice(side, choice, reply, result)}
          >
            {detail}
          </button>
        ) : (
          <div key={choice.choice} className="ps-eval-choice" title={tooltip}>
            {detail}
          </div>
        );
      })}
    </div>
  );
}

function SettingsLine({ result, resultSettings }: {
  result: EvalResult;
  resultSettings?: TurnEvalSettings | null;
}) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 10, color: '#778', marginTop: 2 }}>
      <span title="What produced the numbers shown for this turn.">
        {resultSettings
          ? (resultSettings.mode === 'mcts'
            ? 'MCTS'
            : `depth ${resultSettings.depth} · ${resultSettings.samples} sample${resultSettings.samples > 1 ? 's' : ''}`)
          : `depth ${result.depthCompleted}`}
      </span>
      {result.interval > 0.25 && (
        <span style={{ color: '#b6a46a' }} title="No safe line exists: the outcome hinges on out-predicting the opponent.">
          toss-up: prediction battle
        </span>
      )}
    </div>
  );
}

export function EvalResultBlock({ result, status, playerNames, positionLabel, resultSettings, onPickChoice, onPickPair, doubles, faintedFraction, opponentReads }: {
  result: EvalResult;
  status: EvalStatus;
  playerNames: [string, string];
  positionLabel?: string | null;
  resultSettings?: TurnEvalSettings | null;
  onPickChoice?: PickChoice;
  onPickPair?: (p1: { choice: string; label: string }, p2: { choice: string; label: string }) => void;
  doubles?: boolean;
  /** The fainted share of the shown turn; the percents print at it, as the graph does. Absent: the opening map. */
  faintedFraction?: number | null;
  opponentReads?: boolean;
}) {
  const p1Pct = winPercent(result.score, faintedFraction);
  return (
    <div className={status === 'stale' ? 'ps-eval-stale' : undefined}>
      {positionLabel && (
        <div style={{ fontSize: 10, color: '#8fa3bd', marginBottom: 2 }}>{positionLabel}</div>
      )}
      <div className="ps-eval-labels">
        <span className="ps-eval-bar-p1">{playerNames[0]} {p1Pct}%</span>
        <span className="ps-eval-bar-p2">{playerNames[1]} {100 - p1Pct}%</span>
      </div>
      <div className="ps-eval-bar" role="img" aria-label={`Advantage estimate: ${playerNames[0]} ${p1Pct}%, ${playerNames[1]} ${100 - p1Pct}%`}>
        <div className="ps-eval-bar-fill" style={{ width: `${p1Pct}%` }} />
        <div className="ps-eval-bar-tick" />
      </div>
      <SettingsLine result={result} resultSettings={resultSettings} />
      <div className="ps-eval-columns">
        {/* Stale results describe the PREVIOUS position — clicking them
            would map old choices onto the new state (wrong switches). */}
        <ChoiceList side="p1" choices={result.perSide.p1} reply={result.perSide.p2[0] ?? null} result={result} onPickChoice={status === 'stale' ? undefined : onPickChoice} doubles={doubles} faintedFraction={faintedFraction} opponentReads={opponentReads} />
        <ChoiceList side="p2" choices={result.perSide.p2} reply={result.perSide.p1[0] ?? null} result={result} onPickChoice={status === 'stale' ? undefined : onPickChoice} doubles={doubles} faintedFraction={faintedFraction} opponentReads={opponentReads} />
      </div>
      {result.matrix && (
        <EvalMatrixView
          matrix={result.matrix}
          playerNames={playerNames}
          onPickPair={status === 'stale' ? undefined : onPickPair}
          faintedFraction={faintedFraction}
        />
      )}
    </div>
  );
}
