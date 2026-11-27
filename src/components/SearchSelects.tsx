import { useId } from 'react';
import type { EvalPreferences, SearchBudget } from '@fulllifegames/eval-engine';
import { engineNote } from '../lib/engines/registry';
import type { EngineChoice } from '../hooks/useEngineChoice';
import { readSearchBudget, treeThresholdText } from '../lib/eval/search-budget-setting';

export interface SearchSelectsProps {
  prefs: EvalPreferences;
  onPrefsChange: (prefs: EvalPreferences) => void;
  running: boolean;
  external: boolean;
  showTera: boolean;
  engines?: Pick<EngineChoice, 'engines' | 'selected' | 'select'>;
}

function autoLineText(split: SearchBudget['singles']): string {
  const threshold = treeThresholdText(split);
  if (threshold === null) return 'the MCTS tree on every turn';
  const draws = split.earlySamples === 1 ? 'one sample' : `${split.earlySamples} samples`;
  return `the depth-${split.earlyDepth} matrix with ${draws} until ${threshold}, then the MCTS tree`;
}

function autoTitle(budget: SearchBudget): string {
  return `Auto picks the engine per turn. Singles: ${autoLineText(budget.singles)}. Doubles: ${autoLineText(budget.doubles)}. ` +
    `The MCTS search runs ${budget.trees} trees of ${budget.iterations} iterations each.`;
}

function TeraRow({ prefs, onPrefsChange, running }: Pick<SearchSelectsProps, 'prefs' | 'onPrefsChange' | 'running'>) {
  const teraId = useId();
  return (
    <label
      className="ps-setup-row"
      htmlFor={teraId}
      title="Auto: in a new game on wherever the format allows Tera, in a replay off until someone terastallizes. Draft and custom formats keep the option only for the Pokémon that terastallized. Revealed: force that restriction for any format."
    >
      Tera
      <select
        id={teraId}
        className="ps-setup-row-select"
        value={prefs.tera}
        onChange={event => onPrefsChange({ ...prefs, tera: event.target.value as EvalPreferences['tera'] })}
        disabled={running}
      >
        <option value="auto">Auto</option>
        <option value="on">On</option>
        <option value="off">Off</option>
        <option value="revealed">Revealed</option>
      </select>
    </label>
  );
}

function DepthRows({ prefs, onPrefsChange, running }: Pick<SearchSelectsProps, 'prefs' | 'onPrefsChange' | 'running'>) {
  const depthId = useId();
  const samplesId = useId();
  return (
    <>
      <label className="ps-setup-row" htmlFor={depthId} title={autoTitle(readSearchBudget())}>
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

function EngineRow({ engines, running }: { engines: NonNullable<SearchSelectsProps['engines']>; running: boolean }) {
  const engineId = useId();
  return (
    <label
      className="ps-setup-row"
      htmlFor={engineId}
      title={`Which engine evaluates: the dashboard's own search or another one (ENGINES.md). ${engineNote(engines.selected)}`}
    >
      Engine
      <select
        id={engineId}
        aria-label="Engine"
        className="ps-setup-row-select"
        value={engines.selected.id}
        disabled={running}
        onChange={event => engines.select(event.target.value)}
      >
        {engines.engines.map(engine => <option key={engine.id} value={engine.id}>{engine.name}</option>)}
      </select>
    </label>
  );
}

export function SearchSelects({ external, showTera, engines, ...rows }: SearchSelectsProps) {
  return (
    <>
      {engines && engines.engines.length > 1 && <EngineRow engines={engines} running={rows.running} />}
      {!external && <DepthRows {...rows} />}
      {showTera && <TeraRow {...rows} />}
    </>
  );
}
