import { Dex } from '@pkmn/sim';
import { Protocol } from '@pkmn/protocol';
import type { InferrerState } from './inferrer-state.ts';
import { possibleAbilities, ruleOutUnknown } from './item-evidence.ts';
import { arg, hasKw, identOf, keyOf, namesEffect, type LogLine } from './log-line.ts';
import { toId } from '../ids.ts';

/**
 * Four more items the protocol rules out by a trigger it shows without the
 * item's line (round 69, T168, decision 34), in the shape of trigger-evidence.ts:
 * the action opens a window, the next action boundary closes it, and an item
 * whose own handler would have fired shows no line.
 *  - Lum Berry eats on a status or a confusion (onUpdate, onAfterSetStatus);
 *  - Sitrus Berry eats at half HP (onUpdate) unless Heal Block stops the heal
 *    (onTryEatItem);
 *  - Eject Button switches its holder out after a damaging hit of another
 *    Pokémon (onAfterMoveSecondary) while a teammate can come in;
 *  - Red Card sends the hit's attacker away (onAfterMoveSecondary) while the
 *    attacker's side can switch.
 * Each condition is read by running the item's own handler on a stand-in
 * holder: the half-HP line, the status and confusion test, the switch and
 * the Commander guards are the simulator's, not typed here. The gates are the
 * simulator's too: a Pokémon ignores its item under Embargo, Magic Room or Klutz;
 * a foe with an ability that has onFoeTryEatItem (Unnerve, As One) stops a
 * berry; Sheer Force removes a move's secondary effects and with them
 * onAfterMoveSecondary; one spread move sends only the first Eject Button or
 * Red Card away. Every fact runs through @pkmn/sim in item-triggers.spec.ts.
 * Only items still unknown and never swapped are ruled out, and a team that
 * may hold an Illusion user is not judged (ruleOutUnknown, item-evidence.ts).
 */

type ItemHandler = (this: never, ...args: never[]) => unknown;
type Rule = 'lumberry' | 'sitrusberry' | 'ejectbutton' | 'redcard';

/** What opens a rule: a status, a confusion, a shown HP, or a damaging hit by another Pokémon. */
interface Trigger {
  rule: Rule;
  holder: string;
  ident: string;
  /** The hit's attacker and move (Eject Button, Red Card). */
  hit?: { attacker: string; attackerIdent: string; move: string };
  /** What the status or confusion stand-in carries (Lum Berry). */
  kind?: 'status' | 'confusion';
}

export interface ItemTriggerWatch {
  /** The Pokémon on each field position of both sides ("p1a"): its ident as the entry line wrote it. */
  slots: Map<string, string>;
  fainted: Set<string>;
  /** The latest HP text of each opponent Pokémon, by side and nickname. */
  hp: Map<string, string>;
  healBlocked: Set<string>;
  /** The move resolving now, with its attacker; a spread move's immune target does not end it. */
  move: { attacker: string; move: string } | null;
  /** The triggers of the action since the last boundary. */
  pending: Trigger[];
  /** An Eject Button, Red Card or Eject Pack spent itself inside the window: no hit is judged (one spread move sends once). */
  doubt: boolean;
  /** The log names an ability that stops a foe's berry (Unnerve may arrive by Trace or Skill Swap). */
  unnerveNamed: boolean;
  /** The team size of each side, read once. */
  sizes: Map<string, number>;
}

/** The field and the conditions that trigger-evidence.ts already tracks for the opponent. */
export interface TriggerGates {
  magicRoom: boolean;
  embargoed: ReadonlySet<string>;
  commanding: ReadonlySet<string>;
}

const BOUNDARIES = new Set(['move', 'cant', 'switch', 'drag', 'turn']);
// oracle: packages/replay-core/test/senders-oracle.spec.ts
export const SENDERS = new Set(['ejectbutton', 'redcard', 'ejectpack']);

const stoppersByGen = new Map<number, { ids: Set<string>; names: string[] }>();

/** The abilities of the generation that stop a foe's berry: those with onFoeTryEatItem (Unnerve, As One). */
function stoppersOf(gen: number) {
  let found = stoppersByGen.get(gen);
  if (!found) {
    const abilities = Dex.forGen(gen).abilities.all().filter(ability => (ability as unknown as Record<string, unknown>).onFoeTryEatItem);
    found = { ids: new Set(abilities.map(ability => ability.id)), names: abilities.map(ability => ability.name) };
    stoppersByGen.set(gen, found);
  }
  return found;
}

export function newItemTriggerWatch(state: InferrerState): ItemTriggerWatch {
  const { names } = stoppersOf(state.gen);
  // The raw text rules out almost every line before the effect parser reads it.
  const heads = names.map(name => name.replace(/ \(.*\)$/, ''));
  return {
    slots: new Map(), fainted: new Set(), hp: new Map(), healBlocked: new Set(), move: null, pending: [], doubt: false, sizes: new Map(),
    unnerveNamed: state.lines.some(line => heads.some(head => line.raw.includes(head)) && names.some(name => namesEffect(line, name))),
  };
}

/** How many Pokémon a side brought: the `|teamsize|` the log prints last (VGC brings 4 of 6), else the preview, else the entries. */
export function teamSizeOf(state: InferrerState, side: string): number {
  const sizes = state.lines.filter(line => line.cmd === 'teamsize' && arg(line, 1) === side).map(line => Number(arg(line, 2)));
  if (sizes.length > 0 && sizes[sizes.length - 1] > 0) return sizes[sizes.length - 1];
  const preview = state.lines.filter(line => line.cmd === 'poke' && arg(line, 1) === side).length;
  if (preview > 0) return preview;
  return new Set(state.lines
    .filter(line => (line.cmd === 'switch' || line.cmd === 'drag') && identOf(arg(line, 1))?.side === side)
    .map(line => keyOf(arg(line, 1)))).size;
}

/** One handler of the item as the replay's generation has it (undefined when the item does not exist there yet). */
function handlerOf(state: InferrerState, itemId: string, name: string): ItemHandler | undefined {
  const item = Dex.forGen(state.gen).items.get(itemId) as unknown as Record<string, unknown> & { exists: boolean; gen: number };
  return item.exists && item.gen <= state.gen ? item[name] as ItemHandler | undefined : undefined;
}

/** Whether the item's handler eats the berry when the holder looks like this. */
function eats(handler: ItemHandler | undefined, holder: object): boolean {
  if (!handler) return false;
  let ate = false;
  try {
    handler.call({} as never, { ...holder, eatItem: () => { ate = true; return true; } } as never);
  } catch {
    return false;
  }
  return ate;
}

/**
 * Whether Sitrus Berry would have been eaten at the HP the log shows. The
 * display rounds (a percentage up, the Champions mod down, pixels down), and
 * every form puts the real ratio below one display unit above what it shows,
 * so the berry is judged at that bound: a shown 49/100 eats, 50/100 does not
 * (item-triggers.spec.ts holds the bound against the simulator's displays).
 */
export function sitrusEatsAt(gen: number, shown: string): boolean {
  const health = Protocol.parseHealth(shown as Protocol.PokemonHPStatus);
  if (!health || health.fainted || !health.hp) return false;
  const item = Dex.forGen(gen).items.get('sitrusberry') as unknown as { exists: boolean; gen: number; onUpdate?: ItemHandler };
  return item.exists && item.gen <= gen && eats(item.onUpdate, { hp: health.hp + 1, maxhp: health.maxhp });
}

const sideOf = (key: string) => key.slice(0, 2);
const activeKeys = (watch: ItemTriggerWatch) => new Set([...watch.slots.values()].map(keyOf));

/** Whether the side has a Pokémon that could come in: the team it brought, less its field and its faints. */
function benchOf(state: InferrerState, watch: ItemTriggerWatch, side: string): number {
  const fielded = [...watch.slots.values()].filter(ident => identOf(ident)?.side === side).length;
  const fainted = [...watch.fainted].filter(key => sideOf(key) === side).length;
  if (!watch.sizes.has(side)) watch.sizes.set(side, teamSizeOf(state, side));
  return (watch.sizes.get(side) ?? 0) - fielded - fainted;
}

/** An Eject Button or Red Card handler run on stand-ins, with the board the log shows. */
function sends(state: InferrerState, watch: ItemTriggerWatch, gates: TriggerGates, trigger: Trigger): boolean {
  const handler = handlerOf(state, trigger.rule, 'onAfterMoveSecondary');
  const hit = trigger.hit;
  if (!handler || !hit) return false;
  const move = Dex.forGen(state.gen).moves.get(hit.move);
  const sides = { holder: sideOf(trigger.holder), attacker: sideOf(hit.attacker) };
  let used = false;
  const target = {
    hp: 1, side: sides.holder, forceSwitchFlag: false, beingCalledBack: false, switchFlag: false, isSkyDropped: () => false,
    volatiles: gates.commanding.has(trigger.holder) ? { commanding: {} } : {},
    useItem: () => { used = true; return true; },
  };
  const source = { hp: 1, isActive: true, side: sides.attacker, forceSwitchFlag: false, switchFlag: false };
  const battle = {
    canSwitch: (side: string) => (benchOf(state, watch, side) > 0 ? 1 : 0),
    getAllActive: () => [target, source], runEvent: () => true,
  };
  try {
    (handler as unknown as (this: object, ...args: object[]) => void).call(battle, target, source, { category: move.category, flags: { ...move.flags } });
  } catch {
    return false;
  }
  return used;
}

/** Sheer Force turns a move's secondary effects off, and the simulator skips onAfterMoveSecondary with them. */
function sheerForced(state: InferrerState, trigger: Trigger): boolean {
  const hit = trigger.hit;
  if (!hit) return false;
  const dex = Dex.forGen(state.gen);
  const ability = dex.abilities.get('sheerforce') as unknown as { onModifyMove?: (this: object, move: object, pokemon: object) => void };
  const abilities = possibleAbilities(state, hit.attackerIdent);
  if (abilities && !abilities.has('sheerforce')) return false;
  const move = { ...dex.moves.get(hit.move) } as { hasSheerForce?: boolean };
  try {
    ability.onModifyMove?.call({}, move, {});
  } catch {
    return true;
  }
  return !!move.hasSheerForce || !ability.onModifyMove;
}

/** Whether a foe of the holder may have an ability that stops its berry (a foe of unknown species may). */
function foeStopsBerry(state: InferrerState, watch: ItemTriggerWatch, holder: string): boolean {
  if (watch.unnerveNamed) return true;
  const stoppers = stoppersOf(state.gen).ids;
  return [...watch.slots.values()].some(ident => {
    if (identOf(ident)?.side === sideOf(holder)) return false;
    const abilities = possibleAbilities(state, ident);
    return !abilities || [...abilities].some(ability => stoppers.has(ability));
  });
}

/** The holder ignores its item: Magic Room, Embargo, or an ability it may have (Klutz). */
function ignoresItem(state: InferrerState, gates: TriggerGates, trigger: Trigger): boolean {
  return gates.magicRoom || gates.embargoed.has(trigger.holder) || possibleAbilities(state, trigger.ident)?.has('klutz') !== false;
}

/** Whether the item's handler would have fired for this trigger, and the log shows no line. */
function wouldShow(state: InferrerState, watch: ItemTriggerWatch, gates: TriggerGates, trigger: Trigger): boolean {
  if (trigger.rule === 'lumberry') {
    const holder = trigger.kind === 'confusion' ? { status: '', volatiles: { confusion: {} } } : { status: 'psn', volatiles: {} };
    return !foeStopsBerry(state, watch, trigger.holder) && eats(handlerOf(state, 'lumberry', 'onUpdate'), holder);
  }
  if (trigger.rule === 'sitrusberry') {
    const shown = watch.hp.get(trigger.holder) ?? '';
    return !foeStopsBerry(state, watch, trigger.holder) && !watch.healBlocked.has(trigger.holder) && sitrusEatsAt(state.gen, shown);
  }
  const attacker = trigger.hit?.attacker ?? '';
  return !watch.fainted.has(attacker) && !sheerForced(state, trigger) && sends(state, watch, gates, trigger);
}

/** The window's close: a trigger whose item would have fired and whose holder is still on the field rules the item out. */
function judge(state: InferrerState, watch: ItemTriggerWatch, gates: TriggerGates) {
  const pending = watch.pending;
  const doubt = watch.doubt;
  watch.pending = [];
  watch.doubt = false;
  const active = activeKeys(watch);
  for (const trigger of pending) {
    if (!active.has(trigger.holder) || (doubt && trigger.hit) || ignoresItem(state, gates, trigger)) continue;
    if (wouldShow(state, watch, gates, trigger)) ruleOutUnknown(state, trigger.holder, trigger.rule);
  }
}

function open(watch: ItemTriggerWatch, trigger: Trigger) {
  if (!watch.pending.some(other => other.holder === trigger.holder && other.rule === trigger.rule)) watch.pending.push(trigger);
}

/** A Pokémon entered a position: whoever stood there left and judges nothing, and the newcomer's HP opens Sitrus Berry. */
function onEntry(state: InferrerState, watch: ItemTriggerWatch, line: LogLine, key: string) {
  const position = arg(line, 1).slice(0, 3);
  watch.slots.set(position, arg(line, 1));
  watch.healBlocked.delete(key);
  noteHp(state, watch, arg(line, 1), key, arg(line, 3));
}

/** An HP text of an opponent Pokémon: kept, and Sitrus Berry watches it. */
function noteHp(state: InferrerState, watch: ItemTriggerWatch, ident: string, key: string, text: string) {
  if (!key.startsWith(state.opponentSide) || !text) return;
  watch.hp.set(key, text);
  open(watch, { rule: 'sitrusberry', holder: key, ident });
}

/** A damaging hit of another Pokémon into an opponent Pokémon that stays up: Eject Button and Red Card watch it. */
function onHit(state: InferrerState, watch: ItemTriggerWatch, line: LogLine, key: string) {
  const pending = watch.move;
  if (!pending || hasKw(line, 'from') || keyOf(pending.attacker) === key) return;
  if (!Dex.forGen(state.gen).moves.get(pending.move).exists) return;
  const hit = { attacker: keyOf(pending.attacker), attackerIdent: pending.attacker, move: pending.move };
  for (const rule of ['ejectbutton', 'redcard'] as const) open(watch, { rule, holder: key, ident: arg(line, 1), hit });
}

/** A status or a confusion on an opponent Pokémon. */
function onStatus(watch: ItemTriggerWatch, line: LogLine, key: string, kind: 'status' | 'confusion') {
  open(watch, { rule: 'lumberry', holder: key, ident: arg(line, 1), kind });
}

/** Lines about an opponent Pokémon. */
function onOpponentLine(state: InferrerState, watch: ItemTriggerWatch, line: LogLine, key: string) {
  const tag = line.cmd;
  if (tag === '-status') onStatus(watch, line, key, 'status');
  else if (tag === '-start' && toId(Protocol.parseEffect(arg(line, 2)).name) === 'confusion') onStatus(watch, line, key, 'confusion');
  else if (tag === '-damage' || tag === '-heal' || tag === '-sethp') {
    noteHp(state, watch, arg(line, 1), key, arg(line, 2));
    if (tag === '-damage') onHit(state, watch, line, key);
  } else if (tag === '-enditem') watch.pending = watch.pending.filter(trigger => trigger.holder !== key);
}

/** Heal Block on a Pokémon, and an item that sent a Pokémon out in this window (it spent the switch the others would need). */
function noteDoubt(watch: ItemTriggerWatch, line: LogLine, key: string) {
  const tag = line.cmd;
  if (tag === '-enditem' && SENDERS.has(toId(arg(line, 2)))) watch.doubt = true;
  if ((tag === '-start' || tag === '-end') && toId(Protocol.parseEffect(arg(line, 2)).name) === 'healblock') watch.healBlocked[tag === '-start' ? 'add' : 'delete'](key);
}

/** Ally Switch: the Pokémon leaves its position for the numbered one and the one there takes its place. */
function onSwap(watch: ItemTriggerWatch, line: LogLine) {
  const from = arg(line, 1).slice(0, 3);
  const to = `${from.slice(0, 2)}${'abcd'[Number(arg(line, 2))] ?? ''}`;
  const moved = watch.slots.get(from);
  if (!moved || to === from) return;
  const other = watch.slots.get(to);
  watch.slots.set(to, moved);
  if (other) watch.slots.set(from, other);
  else watch.slots.delete(from);
}

function onFaint(watch: ItemTriggerWatch, key: string) {
  watch.fainted.add(key);
  watch.pending = watch.pending.filter(trigger => trigger.holder !== key);
  for (const [position, ident] of watch.slots) if (keyOf(ident) === key) watch.slots.delete(position);
}

/**
 * The line handler: closes the window at each action boundary and judges its
 * triggers, then reads the line (the HP, the status, the hit) into the next
 * window. The residual phase's `upkeep` is no boundary: the simulator's last
 * update, and so a berry's line, comes after it.
 */
export function watchItemTriggers(state: InferrerState, watch: ItemTriggerWatch, gates: TriggerGates, line: LogLine) {
  const tag = line.cmd;
  const key = keyOf(arg(line, 1));
  if (BOUNDARIES.has(tag)) {
    if (tag === 'switch' || tag === 'drag') {
      const left = watch.slots.get(arg(line, 1).slice(0, 3));
      if (left) watch.pending = watch.pending.filter(trigger => trigger.holder !== keyOf(left));
    }
    judge(state, watch, gates);
  }
  if (tag === 'move') watch.move = { attacker: arg(line, 1), move: arg(line, 2) };
  else if (BOUNDARIES.has(tag) || tag === 'done' || tag === 'upkeep') watch.move = null;
  if (tag === 'switch' || tag === 'drag') onEntry(state, watch, line, key);
  else if (tag === 'faint') onFaint(watch, key);
  else if (tag === 'swap') onSwap(watch, line);
  noteDoubt(watch, line, key);
  if (key.startsWith(state.opponentSide)) onOpponentLine(state, watch, line, key);
}
