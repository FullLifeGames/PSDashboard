import type { ReactNode } from 'react';
import { type EvalResult, type RankedChoice, winDeltaText, winPercent } from '@fulllifegames/eval-engine';
import type { EvalStatus, TurnEvalSettings } from '../../hooks/useEvaluation';
import { EvalMatrixView } from '../EvalMatrixView';
import { MiniBar } from '../EvalTurnAnalysis';

// Displayed values are win probabilities ("52%") and point deltas ("−8%").

type PickChoice = (side: 'p1' | 'p2', choice: RankedChoice, reply?: RankedChoice | null) => void;

function ChoiceDetail({ choice, index, best }: { choice: RankedChoice; index: number; best: RankedChoice | undefined }) {
  const evPct = winPercent(choice.ev);
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
      {choice.line && choice.line.length > 0 && (
        <span className="ps-eval-line">
          then {choice.line.map(step => `${step.p1} · ${step.p2}`).join(' → ')}
        </span>
      )}
    </>
  );
}

/** The equilibrium value in the eval bar's own language: the win odds
 *  this choice is worth against balanced play. The guaranteed floor
 *  and the punishing reply live in the tooltip. */
function choiceTooltip(choice: RankedChoice, clickable: boolean): string {
  return `Win probability ${winPercent(choice.ev)}% vs balanced play; higher is better for this side` +
    ` · guaranteed at least ${winPercent(choice.worstCase)}%` +
    (choice.punishedBy ? ` (worst reply: ${choice.punishedBy})` : '') +
    '. Choices are ranked by their value against balanced play.' +
    (clickable ? ' Click to play this turn out against the engine’s reply.' : '');
}

function ChoiceList({
  side, choices, reply, onPickChoice,
}: {
  side: 'p1' | 'p2';
  choices: RankedChoice[];
  /** The other side's engine answer, committed alongside a clicked line. */
  reply: RankedChoice | null;
  onPickChoice?: PickChoice;
  doubles?: boolean;
}) {
  const best = choices[0];
  return (
    <div className="ps-eval-column">
      {choices.slice(0, 3).map((choice, index) => {
        const tooltip = choiceTooltip(choice, !!onPickChoice);
        const detail = <ChoiceDetail choice={choice} index={index} best={best} />;
        return onPickChoice ? (
          <button
            key={choice.choice}
            type="button"
            className="ps-btn ps-eval-choice"
            title={tooltip}
            onClick={() => onPickChoice(side, choice, reply)}
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

function SettingsLine({ result, resultSettings, children }: {
  result: EvalResult;
  resultSettings?: TurnEvalSettings | null;
  children: ReactNode;
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
      {children}
    </div>
  );
}

/** The single-position result: the advantage bar, its provenance, the ranked lines, and the matrix. */
export function EvalResultBlock({ result, status, playerNames, positionLabel, resultSettings, thinkDeeper, onPickChoice, onPickPair, doubles }: {
  result: EvalResult;
  status: EvalStatus;
  playerNames: [string, string];
  positionLabel?: string | null;
  resultSettings?: TurnEvalSettings | null;
  thinkDeeper: ReactNode;
  onPickChoice?: PickChoice;
  onPickPair?: (p1: { choice: string; label: string }, p2: { choice: string; label: string }) => void;
  doubles?: boolean;
}) {
  const p1Pct = winPercent(result.score);
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
      <SettingsLine result={result} resultSettings={resultSettings}>
        {thinkDeeper}
      </SettingsLine>
      <div className="ps-eval-columns">
        {/* Stale results describe the PREVIOUS position — clicking them
            would map old choices onto the new state (wrong switches). */}
        <ChoiceList side="p1" choices={result.perSide.p1} reply={result.perSide.p2[0] ?? null} onPickChoice={status === 'stale' ? undefined : onPickChoice} doubles={doubles} />
        <ChoiceList side="p2" choices={result.perSide.p2} reply={result.perSide.p1[0] ?? null} onPickChoice={status === 'stale' ? undefined : onPickChoice} doubles={doubles} />
      </div>
      {result.matrix && (
        <EvalMatrixView
          matrix={result.matrix}
          playerNames={playerNames}
          onPickPair={status === 'stale' ? undefined : onPickPair}
        />
      )}
    </div>
  );
}
