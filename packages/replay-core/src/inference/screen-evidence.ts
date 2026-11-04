import { Protocol } from '@pkmn/protocol';
import { conditionTurns, ITEM_BLOCKERS, type ConditionTurns } from '../dex-facts/screen-turns.ts';
import { revealedField } from '../team-info.ts';
import { toId } from '../ids.ts';
import { dexOf } from '../rules-dex.ts';
import { findPokemon, type InferrerState } from './inferrer-state.ts';
import { arg, hasKw, identOf, keyOf, type LogLine } from './log-line.ts';
import { illusionPossible, possibleAbilities, ruleOutUnknown } from './item-evidence.ts';

/**
 * Round 86 (T310): the item that held a screen, from the screen's turns in the log. Reflect, Light Screen and Aurora Veil last
 * five turns, eight with Light Clay (`conditionTurns` reads both numbers from the Dex's condition). The log shows a screen's
 * start in the action phase of the turn its setter used the move and its end in the residual phase of a later turn, so the
 * lifetime counts the turns: the plain five rule out the items that would have extended it, the turns of one item prove it.
 *
 * A verdict needs an observed end in the residual phase on the side that holds the interval. Nothing is read when the turns
 * prove nothing: a removal ends a screen in the action phase (found by the phase, never by a move's name); a screen that moves
 * without a line (Court Change) shows an end on a side with no interval and voids the open ones; a screen still standing at the
 * log's end could have been taken by such a mover; a start whose move line carries `[from]` (Snatch, Copycat, Metronome) or
 * `[silent]` belongs to no setter the reader can name. The rule-out alone doubts an item that counted for nothing (Klutz,
 * Embargo, Magic Room: `ITEM_BLOCKERS`); both verdicts doubt an item the log showed or changed, and an Illusion team. The
 * sweeps `screen-turns-sweep.spec.ts` and `screen-evidence.spec.ts` hold the table, the blockers, the removers and the movers
 * to the simulator in every rule set and both game types.
 */

/** A screen standing on one side, opened at its setter's move. */
interface Interval {
  /** The `|turn|` the setter used the move on. */
  turn: number;
  /** The setter's ident with its position, and its key without. */
  ident: string;
  key: string;
  table: ConditionTurns;
  /** The item at the start is not the set item (the log showed it or it changed), or a mover may have taken the screen. */
  doubt: boolean;
  /** The setter's item counted for nothing at the start (Embargo on it, Magic Room): the plain turns then prove nothing. */
  blocked: boolean;
}

export interface ScreenWatch {
  turn: number;
  /** Inside the residual phase: a bare `|` with no move, switch or faint-replacement line since. */
  residual: boolean;
  /** The latest `|move|` line of the action, which names the setter of a start that follows. */
  move: { ident: string; name: string; from: boolean } | null;
  /** The open screens by side and condition id. */
  open: Map<string, Interval>;
}

/** Lines that end the residual window and the resolving move: a header bar is followed by actions, the residual bar is not. */
const ACTION_LINES = new Set(['move', 'switch', 'drag', 'cant', 'replace']);
const MOVE_ENDS = new Set(['done', 'turn', 'upkeep', 'switch', 'drag', 'cant']);

const newWatch = (): ScreenWatch => ({ turn: 0, residual: false, move: null, open: new Map() });

/** The condition a `-sidestart` or `-sideend` line names ('move: Reflect' and 'Reflect' both read 'reflect'). */
const conditionOf = (line: LogLine): string => toId(Protocol.parseEffect(arg(line, 2)).name);

/** Whether the move sets this condition on its user's side, by the move's own Dex entry. */
function setsCondition(state: InferrerState, moveName: string, condition: string): boolean {
  const move = dexOf(state).moves.get(moveName);
  const side = move.exists ? move.sideCondition ?? move.self?.sideCondition : undefined;
  return !!side && toId(side) === condition;
}

/** The table of a condition whose turns an item changes, null for every other. */
function tableOf(state: InferrerState, condition: string): ConditionTurns | null {
  const table = conditionTurns(dexOf(state), condition);
  return table && table.byItem.size > 0 ? table : null;
}

/** A start in the action phase, set by the move line before it. */
function onStart(state: InferrerState, watch: ScreenWatch, line: LogLine) {
  const side = identOf(arg(line, 1))?.side;
  const condition = conditionOf(line);
  const table = tableOf(state, condition);
  const move = watch.move;
  if (!side || !table || !move || move.from || hasKw(line, 'silent') || watch.residual || watch.turn < 1) return;
  if (!setsCondition(state, move.name, condition)) return;
  const items = state.itemWatch;
  const key = keyOf(move.ident);
  watch.open.set(`${side}|${condition}`, {
    turn: watch.turn, ident: move.ident, key, table,
    doubt: !items || items.items.has(key),
    blocked: !items || items.embargoed.has(key) || items.magicRoom,
  });
}

/** Whether the setter may have had an ability that makes its item count for nothing. */
function mayIgnoreItem(state: InferrerState, interval: Interval): boolean {
  const abilities = possibleAbilities(state, interval.ident);
  return !abilities || ITEM_BLOCKERS.ability.some(ability => abilities.has(ability));
}

/** The verdict of an observed end: the lifetime in turns against the Dex's table. */
function judge(state: InferrerState, interval: Interval, lifetime: number) {
  const { plain, byItem } = interval.table;
  if (interval.doubt || illusionPossible(state) || !interval.key.startsWith(state.opponentSide)) return;
  if ([...state.swappedIdents.keys()].some(ident => keyOf(ident) === interval.key)) return;
  if (lifetime === plain) {
    if (interval.blocked || mayIgnoreItem(state, interval)) return;
    for (const item of byItem.keys()) ruleOutUnknown(state, interval.key, item);
    return;
  }
  const items = [...byItem].filter(([, turns]) => turns === lifetime).map(([item]) => item);
  const pokemon = items.length === 1 ? findPokemon(state, interval.key.slice(4)) : undefined;
  if (pokemon && (!pokemon.item.value || pokemon.item.value === '(has item)')) {
    pokemon.item = revealedField(dexOf(state).items.get(items[0]).name);
  }
}

/** An end: in the residual phase it closes the screen with a verdict, in the action phase it is a removal, with no interval it is a mover. */
function onEnd(state: InferrerState, watch: ScreenWatch, line: LogLine) {
  const side = identOf(arg(line, 1))?.side;
  const condition = conditionOf(line);
  if (!side || !tableOf(state, condition)) return;
  const interval = watch.open.get(`${side}|${condition}`);
  if (!interval) {
    for (const [id, open] of watch.open) if (id.endsWith(`|${condition}`)) open.doubt = true;
    return;
  }
  watch.open.delete(`${side}|${condition}`);
  if (watch.residual) judge(state, interval, watch.turn - interval.turn + 1);
}

/**
 * The line handler, called after `watchItemEvidence` (it has updated the item watch this line reads): the turn and the phase,
 * the setter's move, the start and the end of a screen.
 */
export function watchScreenEvidence(state: InferrerState, line: LogLine) {
  const watch = (state.screenWatch ??= newWatch());
  if (line.cmd === 'turn') watch.turn = Number(arg(line, 1)) || 0;
  if (line.cmd === 'done') watch.residual = true;
  else if (line.cmd === 'turn' || line.cmd === 'upkeep' || ACTION_LINES.has(line.cmd)) watch.residual = false;
  if (line.cmd === 'move') watch.move = { ident: arg(line, 1), name: arg(line, 2), from: hasKw(line, 'from') };
  else if (MOVE_ENDS.has(line.cmd)) watch.move = null;
  if (line.cmd === '-sidestart') onStart(state, watch, line);
  else if (line.cmd === '-sideend') onEnd(state, watch, line);
}
