import type { Battle, Pokemon } from '@pkmn/sim';
import { copyOf, FixedDice } from './copy.ts';
import { askCheckOn, AskLeak, guarded } from './guard.ts';

// Questions about the simulator's action queue: do two move actions tie, and where does one stand.

export interface ActionAsk {
  /** The acting body of the live battle. */
  pokemon: Pokemon;
  moveId: string;
}

/**
 * The action speed of each body, per battle object (only `actionsTie` reads it, on a reader battle). A reader battle is never written,
 * so a number read once stays true; with the development check on, a hit is read again and a changed battle throws `AskLeak`.
 * `queuePlace` and `actionPriority` never read it: the rebuild asks on its LIVE battle and plays it turn after turn, so a speed read
 * in one turn is stale in the next (Trick Room, Tailwind, paralysis, a stat stage, a switch, an item knocked off).
 */
const speeds = new WeakMap<Battle, Map<Pokemon, number>>();

function speedOf(battle: Battle, pokemon: Pokemon): number {
  let held = speeds.get(battle);
  if (!held) speeds.set(battle, held = new Map());
  const known = held.get(pokemon);
  if (known === undefined) {
    const speed = pokemon.getActionSpeed();
    held.set(pokemon, speed);
    return speed;
  }
  if (askCheckOn() && pokemon.getActionSpeed() !== known) throw new AskLeak('a battle changed after its action speed was asked');
  return known;
}

/** The events that move an action's priority, with the handlers the queue's `resolveAction` and `getActionSpeed` run. */
const PRIORITY_EVENTS = ['ModifyPriority', 'FractionalPriority'] as const;

const handlerFree = new WeakMap<Battle, Map<Pokemon, boolean>>();

/**
 * No handler of a priority event reaches this body. The queue runs the events with the body as target and the move's
 * target as source (`onSource` handlers), so the discovery asks with no source and with every body on the field.
 */
function readFreeOfPriorityHandlers(battle: Battle, pokemon: Pokemon): boolean {
  const sources = [null, ...battle.getAllActive(true)];
  return PRIORITY_EVENTS.every(event => sources.every(source => battle.findEventHandlers(pokemon, event, source).length === 0));
}

/** `readFreeOfPriorityHandlers` once per body of a reader battle (`actionsTie`'s). */
function freeOfPriorityHandlers(battle: Battle, pokemon: Pokemon): boolean {
  let held = handlerFree.get(battle);
  if (!held) handlerFree.set(battle, held = new Map());
  const read = () => readFreeOfPriorityHandlers(battle, pokemon);
  const known = held.get(pokemon);
  if (known === undefined) {
    const free = read();
    held.set(pokemon, free);
    return free;
  }
  if (askCheckOn() && read() !== known) throw new AskLeak('a battle changed after its priority handlers were asked');
  return known;
}

/** The Dex priority of a move whose action priority is its Dex priority; null when the move has a handler of its own or is unknown. */
function plainPriority(battle: Battle, moveId: string): number | null {
  const move = battle.dex.moves.get(moveId) as unknown as { exists: boolean; priority: number; onModifyPriority?: unknown };
  return move.exists && move.onModifyPriority === undefined ? move.priority : null;
}

/** The dice the two plays of a question use. */
const ANSWERS = [false, true] as const;

/** The same body on a copy of its battle. */
const onCopy = (copy: Battle, live: Pokemon): Pokemon => copy.sides[live.side.n].pokemon[live.side.pokemon.indexOf(live)];

/** The move action the queue builds for a body, the way `Battle.makeChoices` queues it. */
function moveAction(copy: Battle, ask: ActionAsk) {
  const actions = copy.queue.resolveAction({ choice: 'move', pokemon: onCopy(copy, ask.pokemon), moveid: ask.moveId, targetLoc: 1 } as never);
  const action = actions.find(candidate => candidate.choice === 'move');
  if (!action) throw new Error(`the queue built no move action for ${ask.moveId}`);
  return action;
}

/**
 * Can the simulator's queue meet these two move actions at equal order, priority and speed? `speedSort` flips a coin between actions
 * that `comparePriority` calls equal. The prefilters are exact: different action speeds never tie (generations 4 and below swap in
 * `-getStat('spe')` for a negative fractional priority, but equal priorities mean equal fractional parts); at equal speed, with no
 * handler of either priority event for either body and no ModifyPriority of the move, the queue returns the Dex priority for both.
 * Any handler sends the pair to the copy.
 */
export function actionsTie(battle: Battle, first: ActionAsk, second: ActionAsk): boolean {
  return guarded(battle, [], () => {
    if (speedOf(battle, first.pokemon) !== speedOf(battle, second.pokemon)) return false;
    const [one, other] = [plainPriority(battle, first.moveId), plainPriority(battle, second.moveId)];
    if (one !== null && other !== null && freeOfPriorityHandlers(battle, first.pokemon) && freeOfPriorityHandlers(battle, second.pokemon)) return one === other;
    return queueTie(battle, first, second);
  });
}

/**
 * Both move actions resolved by the queue on a copy, once per answer of the dice; a tie under either answer is a possible tie.
 * Resolving an action has effects (Quick Claw and Quick Draw draw from the PRNG and write the log, Custap Berry eats the item).
 */
function queueTie(battle: Battle, first: ActionAsk, second: ActionAsk): boolean {
  return ANSWERS.some(chance => {
    const copy = copyOf(battle);
    copy.prng = new FixedDice({ chance });
    return copy.comparePriority(moveAction(copy, first) as never, moveAction(copy, second) as never) === 0;
  });
}

/**
 * Where a move action stands in the queue for the body that uses it: the queue's own priority (Dex priority after the move's
 * ModifyPriority, the ModifyPriority event and the FractionalPriority event) and the action speed, resolved on a copy with fixed dice.
 * The Dex priority alone misses Prankster, Gale Wings, Triage, Grassy Glide (ModifyPriority) and Stall, Lagging Tail, Full Incense,
 * Custap Berry, Quick Claw, Quick Draw, Mycelium Might (FractionalPriority). `chance` answers every chance of the question.
 */
export interface QueuePlace {
  priority: number;
  speed: number;
}

/** The priority the queue's own `Custap` event (Generation 4: Quick Claw, Custap Berry) gives an activated holder over its action. */
const CUSTAP_EVENT_GAIN = 0.1;

function hasCustapEvent(battle: Battle, pokemon: Pokemon): boolean {
  const item = battle.dex.items.get(pokemon.item) as unknown as { exists: boolean; onCustap?: unknown };
  return item.exists && item.onCustap !== undefined;
}

/** Read fresh on every call: the battle is the rebuild's live one, played between two questions (see `speeds`). */
export function queuePlace(battle: Battle, pokemon: Pokemon, moveId: string, chance: boolean): QueuePlace {
  return guarded(battle, [], () => {
    // A body and move free of every handler keep their Dex priority without a copy, from Generation 4 on: Generation 3's Quick Claw
    // sits in `getActionSpeed` through `quickClawRoll`, which the copy sets. A Generation 4 Quick Claw or Custap Berry holds no
    // priority handler: its `onBeforeTurn` queues an event at the action's priority plus 0.1, so an activated holder stands there.
    const gain = chance && hasCustapEvent(battle, pokemon) ? CUSTAP_EVENT_GAIN : 0;
    const plain = plainPriority(battle, moveId);
    if (plain !== null && battle.gen > 3 && readFreeOfPriorityHandlers(battle, pokemon)) {
      return { priority: plain + gain, speed: pokemon.getActionSpeed() };
    }
    const copy = copyOf(battle);
    copy.prng = new FixedDice({ chance });
    if (copy.gen === 3) copy.quickClawRoll = chance;
    const action = moveAction(copy, { pokemon, moveId });
    return { priority: action.priority + gain, speed: action.speed };
  });
}

/** `queuePlace`'s priority alone. */
export function actionPriority(battle: Battle, pokemon: Pokemon, moveId: string, chance: boolean): number {
  return queuePlace(battle, pokemon, moveId, chance).priority;
}

/**
 * The chance answer of a body's action in one turn: yes when the turn's lines show an activation of this body (`|-activate|p1a: Name|item: X`
 * or `|ability: X`) whose item or ability the queue reads for the order (a FractionalPriority or Custap handler in the Dex entry; Generation
 * 3's Quick Claw has none and moves the action speed, which the copy shows as a difference between the two answers). Else no.
 */
export function activated(battle: Battle, pokemon: Pokemon, lines: readonly string[]): boolean {
  const slot = pokemon.getSlot();
  const names = lines.flatMap(line => {
    const parts = line.split('|');
    const effect = /^(item|ability): (.+)$/.exec(parts[3] ?? '');
    return parts[1] === '-activate' && (parts[2] ?? '').startsWith(`${slot}:`) && effect ? [{ kind: effect[1], name: effect[2] }] : [];
  });
  return names.some(({ kind, name }) => {
    const entry = (kind === 'item' ? battle.dex.items.get(name) : battle.dex.abilities.get(name)) as unknown as
      { exists: boolean; id: string; onFractionalPriority?: unknown; onCustap?: unknown };
    if (!entry.exists || (kind === 'item' ? pokemon.item : pokemon.ability) !== entry.id) return false;
    if (entry.onFractionalPriority !== undefined || entry.onCustap !== undefined) return true;
    return battle.gen === 3 && kind === 'item' && speedRollMoves(battle, pokemon);
  });
}

/** Does the battle's own speed roll move this body's action speed (Generation 3's Quick Claw)? */
function speedRollMoves(battle: Battle, pokemon: Pokemon): boolean {
  return guarded(battle, [], () => {
    const speeds = ANSWERS.map(roll => {
      const copy = copyOf(battle);
      copy.quickClawRoll = roll;
      return onCopy(copy, pokemon).getActionSpeed();
    });
    return speeds[0] !== speeds[1];
  });
}
