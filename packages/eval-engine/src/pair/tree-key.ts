import type { Battle, PRNGSeed } from '@pkmn/sim';
import { positionBattle, type SimPosition } from '../forward/position.ts';
import { drawKeyed } from './draw.ts';
import { parsePairChoice, planTimeFallback } from './guards.ts';
import { readPattern, type EntriesFor, type TableFor } from './pattern.ts';
import { entriesOf, tablesFor } from './sampler.ts';

/**
 * Round 86 (A9b): the class key of a doubles tree's root draw, the one the pair plan gives the sampler's classes. A tree draws a
 * root cell once, at its first visit. The draw runs under the pair recorder (`drawKeyed`: the natural stream, number for number),
 * `readPattern` names its class from the recorded dice and the kill tables of the hits, and the key goes into the tree's root book,
 * where the merge joins the tree to the pool of the class it drew. A tree draw and a sampler class share a key because it is one
 * function over the same records. A cell the sampler never plans (a guard before the draw), a read that falls back and a draw
 * without an uncertain event book no key: they carry no blend at the merge either.
 */

interface PairKeyState { battle: Battle; tableFor: TableFor; entriesFor: EntriesFor; pairable: Map<number, boolean> }

/** The pair state of one tree's root, per owner (the tree's root book): the battle, the kill tables of its hits, the entries of its moves. */
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

/** The sampler's gate for a cell: both choices parse to slot actions and no guard sends the cell to the plain draws before any die. */
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

export interface KeyedAdvance { child: SimPosition; log: string[]; pendingSwitch: boolean; classKey: string | null }

/**
 * One root draw of a doubles tree with its class key (null when the draw shows no uncertain event or the read falls back). Null as a
 * whole when the pair plan never reads the cell: the caller draws plainly.
 */
export function keyedAdvance(
  owner: object, root: SimPosition, key: number, p1Choice: string, p2Choice: string, seed: PRNGSeed, stopAtForcedSwitch: boolean,
): KeyedAdvance | null {
  const state = stateOf(owner, root);
  if (!pairable(state, key, p1Choice, p2Choice)) return null;
  const drawn = drawKeyed(root, p1Choice, p2Choice, seed, stopAtForcedSwitch);
  const pattern = readPattern(drawn.records, drawn.log, state.battle.dex, state.tableFor, state.entriesFor);
  const classKey = pattern.kind === 'pattern' && pattern.events.length > 0 ? pattern.key : null;
  return { child: drawn.child, log: drawn.log, pendingSwitch: drawn.pendingSwitch, classKey };
}
