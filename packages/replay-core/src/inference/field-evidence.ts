import { conditionTurns, startsForGood } from '../dex-facts/screen-turns.ts';
import { terrainConditions } from '../dex-facts/index.ts';
import { Protocol } from '@pkmn/protocol';
import { toId } from '../ids.ts';
import { dexOf } from '../rules-dex.ts';
import type { InferrerState } from './inferrer-state.ts';
import { arg, fromEffect, hasKw, keyOf, ofIdent, type LogLine } from './log-line.ts';
import { judge, type Interval } from './screen-evidence.ts';

/**
 * Round 88 (T329, GitHub issue #65): the item that held a weather or a terrain, from its turns in the log, the sibling of
 * screen-evidence.ts. Sunny Day lasts five turns, eight with Heat Rock; Rain Dance with Damp Rock, Sandstorm with Smooth Rock,
 * Hail and Snowscape with Icy Rock, the four terrains with Terrain Extender (`conditionTurns` reads every pair from the Dex's
 * condition). The log shows the field's start and its end but never the item. The lifetime counts the residual phases the
 * field stood: a start in the action phase counts the turn it started on, a start before the first turn (a lead's ability) or
 * after the turn's `|upkeep` (a replacement's ability) counts from the next turn. The same verdict as a screen's follows
 * (`judge`): the plain five turns rule the items out, the turns of one item prove it.
 *
 * The setter is the user of the move line before the start when the Dex move sets that condition, or the `[of]` body of a
 * `[from] ability:` start; an ability's start counts only where it does not leave the field standing for good (`startsForGood`:
 * before Generation 6 an ability's field never ends). Nothing is read when the turns prove
 * nothing: an end outside the residual phase is a removal; a second weather or terrain replaces the first outside the residual
 * phase (a replaced terrain prints only the new start, never an end of its own); a field still standing at the log's end; a
 * start in the residual phase; a start that carries `[from]` of a move (Metronome, Copycat) or names no setter. The doubts of
 * the screen reader hold here too (an item the log showed or changed, Klutz, Embargo, Magic Room, an Illusion team). The sweep
 * `field-evidence-sweep.spec.ts` plays every setter and every move of every rule set against the reader.
 */

type Kind = 'weather' | 'terrain';

export interface FieldWatch {
  turn: number;
  /** Bare `|` lines since the turn line: the first is the turn's header, the second opens the residual phase. */
  bars: number;
  /** An `|upkeep` line since the turn line: a start now counts from the next turn. */
  upkept: boolean;
  /** The open weather and terrain, with the interval that judges them at their end. */
  open: Map<Kind, { id: string; interval: Interval }>;
}

const newWatch = (): FieldWatch => ({ turn: 0, bars: 0, upkept: false, open: new Map() });

/** Whether the move sets this weather or terrain, by the move's own Dex entry. */
function setsField(state: InferrerState, moveName: string, id: string): boolean {
  const move = dexOf(state).moves.get(moveName);
  const field = move.exists ? move.weather ?? move.terrain : undefined;
  return !!field && toId(field) === id;
}

const inResidual = (watch: FieldWatch): boolean => watch.turn >= 1 && !watch.upkept && watch.bars >= 2;

/** The setter of a start: the `[of]` body of an ability that does not leave the field for good, or the user of the move that sets it. */
function setterOf(state: InferrerState, id: string, line: LogLine): string | null {
  const from = fromEffect(line);
  if (from.type === 'ability') {
    const holder = ofIdent(line);
    return holder && !startsForGood(dexOf(state), id, from.name) ? holder : null;
  }
  const move = state.screenWatch?.move;
  return hasKw(line, 'from') || !move || move.from || !setsField(state, move.name, id) ? null : move.ident;
}

/** The interval of a start the reader can judge: a table with items, the first residual turn, the setter. */
function intervalOf(state: InferrerState, watch: FieldWatch, id: string, line: LogLine): Interval | null {
  const table = conditionTurns(dexOf(state), id);
  if (!table || table.byItem.size === 0 || inResidual(watch) || hasKw(line, 'silent')) return null;
  const ident = setterOf(state, id, line);
  if (!ident) return null;
  const items = state.itemWatch;
  const key = keyOf(ident);
  return {
    turn: watch.turn === 0 || watch.upkept ? watch.turn + 1 : watch.turn, ident, key, table,
    doubt: !items || items.items.has(key),
    blocked: !items || items.embargoed.has(key) || items.magicRoom,
  };
}

/** A start replaces the field of its kind; the same one again (an ability that fails on its own weather) keeps the count. */
function onStart(state: InferrerState, watch: FieldWatch, kind: Kind, id: string, line: LogLine) {
  if (watch.open.get(kind)?.id === id) return;
  watch.open.delete(kind);
  const interval = intervalOf(state, watch, id, line);
  if (interval) watch.open.set(kind, { id, interval });
}

/** An end: in the residual phase it closes the field with a verdict, in the action phase it is a removal. */
function onEnd(state: InferrerState, watch: FieldWatch, kind: Kind, id: string | null) {
  const open = watch.open.get(kind);
  if (!open) return;
  watch.open.delete(kind);
  if (id !== null && id !== open.id) return;
  if (inResidual(watch)) judge(state, open.interval, watch.turn - open.interval.turn + 1);
}

/**
 * The line handler, called after `watchScreenEvidence` (it has updated the latest move line this reads) and after
 * `watchItemEvidence`: the turn and the phase, the start and the end of a weather and of a terrain.
 */
export function watchFieldEvidence(state: InferrerState, line: LogLine) {
  const watch = (state.fieldWatch ??= newWatch());
  if (line.cmd === 'turn') {
    watch.turn = Number(arg(line, 1)) || 0;
    watch.bars = 0;
    watch.upkept = false;
  } else if (line.cmd === 'done') watch.bars++;
  else if (line.cmd === 'upkeep') watch.upkept = true;
  if (line.cmd === '-weather') {
    if (hasKw(line, 'upkeep')) return;
    const id = toId(arg(line, 1));
    if (id === 'none') onEnd(state, watch, 'weather', null);
    else onStart(state, watch, 'weather', id, line);
    return;
  }
  if (line.cmd !== '-fieldstart' && line.cmd !== '-fieldend') return;
  const id = toId(Protocol.parseEffect(arg(line, 1)).name);
  if (!terrainConditions(dexOf(state)).has(id)) return;
  if (line.cmd === '-fieldstart') onStart(state, watch, 'terrain', id, line);
  else onEnd(state, watch, 'terrain', id);
}
