import { useId } from 'react';
import type { EvalPreferences, SearchBudget } from '@fulllifegames/eval-engine';
import { readSearchBudget, treeThresholdText } from '../lib/eval/search-budget-setting';

export interface SearchSelectsProps {
  prefs: EvalPreferences;
  onPrefsChange: (prefs: EvalPreferences) => void;
  /** A search runs: the selects lock. */
  running: boolean;
}

/** One game type's auto line in words, from its split of the search budget. */
function autoLineText(split: SearchBudget['singles']): string {
  const threshold = treeThresholdText(split);
  if (threshold === null) return 'the MCTS tree on every turn';
  const draws = split.earlySamples === 1 ? 'one sample' : `${split.earlySamples} samples`;
  return `the depth-${split.earlyDepth} matrix with ${draws} until ${threshold}, then the MCTS tree`;
}

/** Round 67 (T111): the auto help text reads the budget in force, so a measurement form never shows stale numbers. */
function autoTitle(budget: SearchBudget): string {
  return `Auto picks the engine per turn. Singles: ${autoLineText(budget.singles)}. Doubles: ${autoLineText(budget.doubles)}. ` +
    `The MCTS search runs ${budget.trees} trees of ${budget.iterations} iterations each.`;
}

/**
 * Round 89 (ruling 49): the search's own preferences, Depth and, under a matrix depth, Samples, as rows of the Setup menu (they stood in the
 * Evaluation header before). The stored `mode`, `depth` and `samples` keep their meaning; this is the one place that draws them. The rows
 * use the Setup menu's select rows (`.ps-setup-row` in layout.css).
 */
export function SearchSelects({ prefs, onPrefsChange, running }: SearchSelectsProps) {
  const depthId = useId();
  const samplesId = useId();
  return (
    <>
      <label className="ps-setup-row" htmlFor={depthId}>
        Depth
        <select
          id={depthId}
          className="ps-setup-row-select"
          value={prefs.mode === 'mcts' || prefs.mode === 'auto' ? prefs.mode : String(prefs.depth)}
          onChange={event => {
            const value = event.target.value;
            if (value === 'mcts' || value === 'auto') onPrefsChange({ ...prefs, mode: value });
            else onPrefsChange({ ...prefs, mode: 'matrix', depth: parseInt(value, 10) as EvalPreferences['depth'] });
          }}
          disabled={running}
          title={autoTitle(readSearchBudget())}
        >
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="mcts">MCTS</option>
          <option value="auto">Auto</option>
        </select>
      </label>
      {prefs.mode === 'matrix' && (
        <label
          className="ps-setup-row"
          htmlFor={samplesId}
          title="Damage-roll seeds averaged per cell. Only affects cells where a KO is in range; quiet cells are roll-insensitive and always simulate once."
        >
          Samples
          <select
            id={samplesId}
            className="ps-setup-row-select"
            value={prefs.samples}
            onChange={event => onPrefsChange({ ...prefs, samples: parseInt(event.target.value, 10) as EvalPreferences['samples'] })}
            disabled={running}
          >
            <option value={1}>1</option>
            <option value={3}>3</option>
            <option value={5}>5</option>
          </select>
        </label>
      )}
    </>
  );
}
