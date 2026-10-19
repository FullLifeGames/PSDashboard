import type { Battle, Pokemon } from '@pkmn/sim';
import { copyOf, FixedDice } from './copy.ts';
import { askCheckOn, AskLeak, guarded } from './guard.ts';

/**
 * Round 72 (T196): do two move actions tie in the simulator's queue? `speedSort` flips a coin between actions that
 * `battle.comparePriority` calls equal, and the actions come from `queue.resolveAction`: the move's priority after its
 * ModifyPriority events, plus the fractional priority of FractionalPriority events (Stall, Lagging Tail, Quick Claw,
 * Custap Berry), against the speed of `getActionSpeed` (Trick Room, Tailwind, paralysis, Scarf and the generation's own
 * rules inside it). Resolving an action is not free of effects: Quick Claw and Quick Draw draw from the PRNG and write
 * the log, Custap Berry eats the item. The question therefore runs on a copy with fixed dice: once with every chance
 * answering no and once with every chance answering yes, and a tie under either answer is a possible tie.
 *
 * The copy is the last rung of a ladder of exact prefilters, each read from the simulator's own numbers. A tie needs
 * equal order, priority and speed (`comparePriority` reads those, then `subOrder` and `effectOrder`, which only event
 * handlers carry); a move action's order is 200 for both. The speed of a move action is the body's
 * `getActionSpeed()` (the generations 4 and below swap in `-getStat('spe')` for a negative fractional priority, and
 * equal priorities mean equal fractional parts, so both bodies take the same branch). Two different action speeds
 * therefore mean no tie, whatever handlers either body holds. At equal speed the priority is the Dex priority plus the
 * FractionalPriority event, after the move's own ModifyPriority and the ModifyPriority event; when the simulator's own
 * handler discovery (`findEventHandlers`, the call `runEvent` makes) finds no handler of either event for either body,
 * and the move carries no ModifyPriority of its own, the queue would return the Dex priority for both and the pair ties
 * exactly when the Dex priorities are equal. Any handler sends the pair to the copy.
 */

export interface ActionAsk {
  /** The acting body of the live battle. */
  pokemon: Pokemon;
  moveId: string;
}

/**
 * What a position's questions share, per battle object: the action speed of each body. A position's reader battle is
 * never written after it is built, so a number read once stays true; with the development check on, a hit is read
 * again and a battle that changed since its first question throws `AskLeak`.
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
function freeOfPriorityHandlers(battle: Battle, pokemon: Pokemon): boolean {
  let held = handlerFree.get(battle);
  if (!held) handlerFree.set(battle, held = new Map());
  const read = () => {
    const sources = [null, ...battle.getAllActive(true)];
    return PRIORITY_EVENTS.every(event => sources.every(source => battle.findEventHandlers(pokemon, event, source).length === 0));
  };
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

/** Can the simulator's queue meet these two move actions at equal order, priority and speed? */
export function actionsTie(battle: Battle, first: ActionAsk, second: ActionAsk): boolean {
  return guarded(battle, [], () => {
    if (speedOf(battle, first.pokemon) !== speedOf(battle, second.pokemon)) return false;
    const [one, other] = [plainPriority(battle, first.moveId), plainPriority(battle, second.moveId)];
    if (one !== null && other !== null && freeOfPriorityHandlers(battle, first.pokemon) && freeOfPriorityHandlers(battle, second.pokemon)) return one === other;
    return queueTie(battle, first, second);
  });
}

/** The plain answer: both move actions resolved by the queue on a copy, once per answer of the dice. */
function queueTie(battle: Battle, first: ActionAsk, second: ActionAsk): boolean {
  return ANSWERS.some(chance => {
    const copy = copyOf(battle);
    copy.prng = new FixedDice({ chance });
    return copy.comparePriority(moveAction(copy, first) as never, moveAction(copy, second) as never) === 0;
  });
}
