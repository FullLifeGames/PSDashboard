import { State, type Battle, type Pokemon } from '@pkmn/sim';
import { sideIndex } from '@fulllifegames/replay-core';
import { rollsStall } from '../dex-facts/protect.ts';
import { parsePairChoice } from '../pair/guards.ts';
import { BOOKKEEPING_FIELDS, BOOKKEEPING_KEYS, STRIPPED_FIELDS } from './board-facts.ts';

/**
 * The delay facts: the board's serialized state (`board-facts.ts`) with the HP kept and the fields dropped that a held repeat of a
 * stalling move writes without changing what any later turn reads; `test/delay-facts.spec.ts` holds each drop against the installed
 * @pkmn/sim and @pkmn/mods. What an entry on the board (every move, ability, item, status, volatile, condition, weather, terrain and
 * room) reads comes from the source of its handlers in the battle's own Dex (`readsOfEntry`), so the code names no move.
 */

type SideId = 'p1' | 'p2';
type Json = Record<string, unknown>;
type Dex = Battle['dex'];
export type EntryKind = 'move' | 'ability' | 'item' | 'condition';

/** What the handlers of an entry read of the dropped fields. `calls` stands for all of them: a move that calls a move reads anything. */
export interface DelayReads { pp: boolean; used: boolean; last: boolean; calls: boolean; turns: boolean; actions: boolean }

/**
 * The body fields of the last-move group (the keys of the serialized body). Dropped unless a handler on the board reads them, calls a
 * move, locks one or may not repeat itself: the simulator reads the last move for those three in its own code.
 */
export const LAST_FIELDS = ['lastMove', 'lastMoveUsed', 'lastMoveEncore', 'lastMoveTargetLoc', 'moveLastTurnResult', 'moveThisTurnResult', 'attackedBy', 'lastDamage', 'hurtThisTurn', 'timesAttacked'] as const;

/** The simulator's stall counter: the volatile a repeated stalling move rolls against (`dex.conditions`), the same in every generation. */
// eslint-disable-next-line names/no-new-dex-name -- the id of the simulator's stall condition, not the ability Stall
export const STALL_VOLATILE = 'stall';

const PP_READ = /\.pp\b|\bmaxpp\b|\b(?:deduct|restore|gain|set)PP\b/;
const USED_READ = /\.used\b/;
const LAST_READ = /\b(?:lastMove|lastMoveUsed|lastMoveEncore|lastMoveTargetLoc|moveLastTurnResult|moveThisTurnResult|attackedBy|lastDamage|hurtThisTurn|timesAttacked|getLastAttackedBy|getLastDamagedBy)\b/;
const CALLS_MOVE = /\b(?:useMove|runMove|insertChoice|prioritizeAction)\b/;

/**
 * The reads of an entry counter that survive the clamp to 0 or 1: the truth of the count, a comparison with 0, and `> 1` (the three
 * `onTry` handlers behind the move runner's increment). Every reader of the installed builds is one of these, so the counters
 * (`activeTurns`, `activeMoveActions`) clamp; anything else keeps the exact count.
 */
const COUNT_UNSAFE_AFTER = /^\s*(?:\+\+|--|[-+*/%]=?|=(?!=)|<|>=|(?:===?|!==?)\s*[1-9]|>\s*(?:[2-9]|1\d))/;
const COUNT_UNSAFE_BEFORE = /(?:\+\+|--)[\w$.?]*$/;

/** Whether `text` reads `field` in a way the clamp to 0 or 1 would change. */
export function readsCountExactly(text: string, field: 'activeTurns' | 'activeMoveActions'): boolean {
  const mention = new RegExp(`\\b${field}\\b`, 'g');
  for (let hit = mention.exec(text); hit; hit = mention.exec(text)) {
    if (COUNT_UNSAFE_AFTER.test(text.slice(hit.index + field.length)) || COUNT_UNSAFE_BEFORE.test(text.slice(Math.max(0, hit.index - 40), hit.index))) return true;
  }
  return false;
}

type Handler = (...args: never[]) => unknown;

/** Every handler function of an entry, the nested ones included (a move's `condition`, `secondary` and `self`), by its key. */
function handlersOf(entry: unknown, depth = 0, out: [string, Handler][] = [], seen = new Set<unknown>()): [string, Handler][] {
  if (!entry || typeof entry !== 'object' || depth > 3 || seen.has(entry)) return out;
  seen.add(entry);
  for (const [key, value] of Object.entries(entry)) {
    if (typeof value === 'function') out.push([key, value as Handler]);
    else handlersOf(value, depth + 1, out, seen);
  }
  return out;
}

const NONE: DelayReads = { pp: false, used: false, last: false, calls: false, turns: false, actions: false };
const KIND_TABLE = { move: 'moves', ability: 'abilities', item: 'items', condition: 'conditions' } as const;
const memo = new WeakMap<object, Map<string, DelayReads>>();

/** What the handlers of one Dex entry read of the dropped fields (memoized per Dex). */
export function readsOfEntry(dex: Dex, kind: EntryKind, id: string): DelayReads {
  let byDex = memo.get(dex);
  if (!byDex) memo.set(dex, byDex = new Map());
  const key = `${kind}:${id}`;
  let reads = byDex.get(key);
  if (!reads) byDex.set(key, reads = readEntry((dex[KIND_TABLE[kind]] as { get(id: string): unknown }).get(id)));
  return reads;
}

function readEntry(entry: unknown): DelayReads {
  if (!entry) return NONE;
  const handlers = handlersOf(entry);
  const texts = handlers.map(([, fn]) => String(fn));
  // the simulator reads the last move in its own code for a move that may not repeat itself and for a lock; those entries mark it in the Dex
  const locks = handlers.some(([name]) => name === 'onLockMove') || !!(entry as { flags?: Record<string, unknown> }).flags?.['cantusetwice'];
  return {
    pp: texts.some(text => PP_READ.test(text)),
    used: texts.some(text => USED_READ.test(text)),
    last: locks || texts.some(text => LAST_READ.test(text)),
    calls: texts.some(text => CALLS_MOVE.test(text)),
    turns: texts.some(text => readsCountExactly(text, 'activeTurns')),
    actions: texts.some(text => readsCountExactly(text, 'activeMoveActions')),
  };
}

/** Every id of the entries on a body: its slots' moves, abilities, item, status and volatiles. */
function bodyEntries(body: Pokemon): [EntryKind, string][] {
  const moves = new Set([...body.moveSlots, ...body.baseMoveSlots].map(slot => slot.id));
  return [
    ...[...moves].map((id): [EntryKind, string] => ['move', id]),
    ...[body.ability, body.baseAbility].map((id): [EntryKind, string] => ['ability', id]),
    ['item', body.item],
    ...[body.status, ...Object.keys(body.volatiles)].filter(Boolean).map((id): [EntryKind, string] => ['condition', id]),
  ];
}

/** Whether a body on the board could bring a fainted one back: a move of the Dex that sets a slot condition (the simulator revives through the queue action it raises). */
const mayRevive = (battle: Battle): boolean => battle.sides.some(side => side.pokemon.some(body => !body.fainted
  && [...body.moveSlots, ...body.baseMoveSlots].some(slot => !!(battle.dex.moves.get(slot.id) as { slotCondition?: string }).slotCondition)));

/**
 * The reads of every entry on the board (the bench too). A fainted body's entries count only where a revive is possible (`mayRevive`):
 * VGC boards keep their fallen bodies in the team, and one fallen body with Encore would keep the PP of every standing body a fact.
 */
export function readsOfBoard(battle: Battle): DelayReads {
  const revive = mayRevive(battle);
  const entries = battle.sides.flatMap(side => [
    ...side.pokemon.filter(body => revive || !body.fainted).flatMap(bodyEntries),
    ...[...Object.keys(side.sideConditions), ...side.slotConditions.flatMap(slot => Object.keys(slot))].map((id): [EntryKind, string] => ['condition', id]),
  ]);
  const field = [battle.field.weather, battle.field.terrain, ...Object.keys(battle.field.pseudoWeather)].filter(Boolean);
  entries.push(...field.map((id): [EntryKind, string] => ['condition', id]));
  const all = { ...NONE };
  for (const [kind, id] of entries) {
    if (!id) continue;
    const reads = readsOfEntry(battle.dex, kind, id);
    for (const name of Object.keys(all) as (keyof DelayReads)[]) all[name] ||= reads[name];
  }
  return all;
}

/**
 * A replacer that writes every object with its keys in order: a board copied by the simulator (`EVAL_SIM_FAST=0`) lists its keys
 * in another order, and the caller compares strings.
 */
const sortedKeys = (_key: string, value: unknown): unknown =>
  value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : value;

/** The serialized position without the stripped fields (the memo key's reading of a board). */
function serialized(battle: Battle): Json & { sides: { pokemon: Json[] }[] } {
  const state = State.serializeBattle(battle) as unknown as Json & { sides: { pokemon: Json[] }[] };
  for (const field of STRIPPED_FIELDS) delete state[field];
  return state;
}

const slotsOf = (body: Json): Json[] => [...((body['moveSlots'] ?? []) as Json[]), ...((body['baseMoveSlots'] ?? []) as Json[])];

/**
 * One body of the delay facts, for a body of the foe's side or the other. Drops: the foe's `stall` volatile (its counter and duration are
 * the chain's own state), the PP of every slot (`stallMargin` bounds it) and its `used` flag unless a handler reads them, the last-move
 * group, the turn's bookkeeping, and the entry counters clamped to 0 or 1.
 */
function trimBody(body: Json, reads: DelayReads, foe: boolean, keepBookkeeping: boolean): void {
  const keeps = (read: boolean): boolean => read || reads.calls;
  if (!keepBookkeeping) for (const key of BOOKKEEPING_KEYS) delete body[key];
  if (!keeps(reads.last)) for (const key of LAST_FIELDS) delete body[key];
  if (foe) delete (body['volatiles'] as Json | undefined)?.[STALL_VOLATILE];
  for (const slot of slotsOf(body)) {
    if (!keeps(reads.pp)) delete slot['pp'];
    if (!keeps(reads.used)) delete slot['used'];
  }
  for (const [key, exact] of [['activeTurns', reads.turns], ['activeMoveActions', reads.actions]] as const) {
    if (typeof body[key] === 'number' && !keeps(exact)) body[key] = Math.min(1, body[key]);
  }
}

/**
 * The delay facts of a position: equal facts mean the same board for everything a later turn reads, up to the foe's stall counter
 * and the PP the stall margin covers; `foe` is the repeater's side.
 */
export function delayFacts(battle: Battle, foe: SideId): string {
  if (battle.ended) return `ended|${battle.winner}`;
  const state = serialized(battle);
  const reads = readsOfBoard(battle);
  // the first turn keeps the bookkeeping flags (the simulator skips their reset there, `board-facts.ts`); no repeat is held that early
  const keepBookkeeping = battle.turn <= 1;
  if (!keepBookkeeping) for (const field of BOOKKEEPING_FIELDS) delete state[field];
  delete state['speedOrder']; // written right before the one event that reads it
  delete state['debugMode'];
  if (!reads.last && !reads.calls) delete state['lastMove'];
  state.sides.forEach((side, index) => side.pokemon.forEach(body => trimBody(body, reads, index === sideIndex(foe), keepBookkeeping)));
  return JSON.stringify(state, sortedKeys);
}

const sameBody = (a: Pokemon, b: Pokemon): boolean => a.set.name === b.set.name && a.set.species === b.set.species && a.position === b.position;

/**
 * Whether a repeated stall held in the turn from `parent` to `child`: a foe body that carries the stall volatile in the parent still
 * carries it in the child. The volatile lasts two turns, so only a stalling move that held (`onRestart`) keeps it; the counter cannot tell (Gens 3 and 4 stop it at 8).
 */
export function heldStall(parent: Battle, child: Battle, foe: SideId): boolean {
  const before = parent.sides[sideIndex(foe)].pokemon;
  const after = child.sides[sideIndex(foe)].pokemon;
  return before.some((body, index) => !!body.volatiles[STALL_VOLATILE] && !!after[index]?.volatiles[STALL_VOLATILE] && sameBody(body, after[index]));
}

/** The PP a foe body has left on the moves whose success rolls against the stall counter. */
const stallPP = (battle: Battle, body: Pokemon): number =>
  body.moveSlots.filter(slot => rollsStall(battle.dex, battle.dex.moves.get(slot.id))).reduce((sum, slot) => sum + slot.pp, 0);

/**
 * The PP margin of a repeated stall: whether every move the side's choice clicks keeps more PP than the foe's stall PP can spend. The
 * chain of held repeats ends with the stall PP of the foe's living bodies in play (each held turn spends one); each turn costs the side one PP per
 * clicked move, and one more per foe body whose ability has an `onDeductPP` handler (Pressure). `choice` is a combined choice of the cell.
 */
export function stallMargin(battle: Battle, side: SideId, choice: string): boolean {
  const own = sideIndex(side);
  const foes = battle.sides[1 - own].active.filter((body): body is Pokemon => !!body && !body.fainted);
  const spendable = foes.reduce((sum, body) => sum + stallPP(battle, body), 0);
  if (spendable === 0) return true;
  const actions = parsePairChoice(battle, own, choice);
  if (!actions) return false;
  const perTurn = 1 + foes.filter(body => typeof (battle.dex.abilities.get(body.ability) as { onDeductPP?: unknown }).onDeductPP === 'function').length;
  return actions.every(action => {
    if (action.kind !== 'move') return true;
    const slot = battle.sides[own].active[action.slot]?.moveSlots.find(candidate => candidate.id === action.moveId);
    return !slot || slot.pp > spendable * perTurn;
  });
}
