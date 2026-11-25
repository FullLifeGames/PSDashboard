import type { Battle, PRNGSeed } from '@pkmn/sim';
import { positionBattle, type SimPosition } from '../forward/position.ts';
import { drawKeyed } from './draw.ts';
import { parsePairChoice, planTimeFallback } from './guards.ts';
import { readPattern, type EntriesFor, type TableFor } from './pattern.ts';
import { entriesOf, tablesFor } from './sampler.ts';
import type { DieQuantiles } from '../search/root-quantile.ts';

interface PairKeyState { battle: Battle; tableFor: TableFor; entriesFor: EntriesFor; pairable: Map<number, boolean> }

const states = new WeakMap<object, PairKeyState>();

function stateOf(owner: object, root: SimPosition): PairKeyState {
  let state = states.get(owner);
  if (!state) {
    const battle = positionBattle(root);
    state = { battle, tableFor: tablesFor(root), entriesFor: entriesOf(battle), pairable: new Map() };
    states.set(owner, state);
  }
  return state;
}

function pairable(state: PairKeyState, key: number, p1Choice: string, p2Choice: string): boolean {
  let ok = state.pairable.get(key);
  if (ok === undefined) {
    const p1 = parsePairChoice(state.battle, 0, p1Choice);
    const p2 = parsePairChoice(state.battle, 1, p2Choice);
    ok = !!p1 && !!p2 && planTimeFallback(state.battle, [p1, p2]) === null;
    state.pairable.set(key, ok);
  }
  return ok;
}

/** `classWeight`: the plan's chance of the drawn class, null together with a null key. */
export interface KeyedAdvance { child: SimPosition; log: string[]; pendingSwitch: boolean; classKey: string | null; classWeight: number | null }

/** One root draw of a doubles tree with its class key; null when the pair plan never reads the cell. */
export function keyedAdvance(
  owner: object, root: SimPosition, key: number, p1Choice: string, p2Choice: string, seed: PRNGSeed, quantiles?: DieQuantiles,
): KeyedAdvance | null {
  const state = stateOf(owner, root);
  if (!pairable(state, key, p1Choice, p2Choice)) return null;
  const drawn = drawKeyed(root, p1Choice, p2Choice, seed, true, quantiles);
  const pattern = readPattern(drawn.records, drawn.log, state.battle.dex, state.tableFor, state.entriesFor);
  const keyed = pattern.kind === 'pattern' && pattern.events.length > 0;
  return {
    child: drawn.child, log: drawn.log, pendingSwitch: drawn.pendingSwitch,
    classKey: keyed ? pattern.key : null, classWeight: keyed ? pattern.weight : null,
  };
}
