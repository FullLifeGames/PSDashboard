import type { Battle, Pokemon } from '@pkmn/sim';
import { copyOf, FixedDice } from './copy.ts';
import { guarded } from './guard.ts';

/**
 * Round 72 (T196): do two move actions tie in the simulator's queue? `speedSort` flips a coin between actions that
 * `battle.comparePriority` calls equal, and the actions come from `queue.resolveAction`: the move's priority after its
 * ModifyPriority events, plus the fractional priority of FractionalPriority events (Stall, Lagging Tail, Quick Claw,
 * Custap Berry), against the speed of `getActionSpeed` (Trick Room, Tailwind, paralysis, Scarf and the generation's own
 * rules inside it). Resolving an action is not free of effects: Quick Claw and Quick Draw draw from the PRNG and write
 * the log, Custap Berry eats the item. The question therefore runs on a copy with fixed dice: once with every chance
 * answering no and once with every chance answering yes, and a tie under either answer is a possible tie.
 */

export interface ActionAsk {
  /** The acting body of the live battle. */
  pokemon: Pokemon;
  moveId: string;
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
  return guarded(battle, [], () => ANSWERS.some(chance => {
    const copy = copyOf(battle);
    copy.prng = new FixedDice({ chance });
    return copy.comparePriority(moveAction(copy, first) as never, moveAction(copy, second) as never) === 0;
  }));
}
