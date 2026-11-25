import type { Battle, Pokemon } from '@pkmn/sim';
import { copyOf, FixedDice } from './copy.ts';
import { askCheckOn, AskLeak, guarded } from './guard.ts';

export interface ActionAsk {
  pokemon: Pokemon;
  moveId: string;
}

// Read only by `actionsTie`, on a reader battle that is never written; the dev check throws `AskLeak` on a change.
// `queuePlace` and `actionPriority` never read it: the live battle moves on, so a speed read in one turn goes stale.
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

const PRIORITY_EVENTS = ['ModifyPriority', 'FractionalPriority'] as const;

const handlerFree = new WeakMap<Battle, Map<Pokemon, boolean>>();

// The queue runs the events with the move's target as source (`onSource`): discovery asks with every body on the field.
function readFreeOfPriorityHandlers(battle: Battle, pokemon: Pokemon): boolean {
  const sources = [null, ...battle.getAllActive(true)];
  return PRIORITY_EVENTS.every(event => sources.every(source => battle.findEventHandlers(pokemon, event, source).length === 0));
}

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

function plainPriority(battle: Battle, moveId: string): number | null {
  const move = battle.dex.moves.get(moveId) as unknown as { exists: boolean; priority: number; onModifyPriority?: unknown };
  return move.exists && move.onModifyPriority === undefined ? move.priority : null;
}

const ANSWERS = [false, true] as const;

const onCopy = (copy: Battle, live: Pokemon): Pokemon => copy.sides[live.side.n].pokemon[live.side.pokemon.indexOf(live)];

// The action the way `Battle.makeChoices` queues it.
function moveAction(copy: Battle, ask: ActionAsk) {
  const actions = copy.queue.resolveAction({ choice: 'move', pokemon: onCopy(copy, ask.pokemon), moveid: ask.moveId, targetLoc: 1 } as never);
  const action = actions.find(candidate => candidate.choice === 'move');
  if (!action) throw new Error(`the queue built no move action for ${ask.moveId}`);
  return action;
}

/** Whether the queue can tie two move actions (`speedSort` flips a coin at equal priority and speed). */
export function actionsTie(battle: Battle, first: ActionAsk, second: ActionAsk): boolean {
  return guarded(battle, [], () => {
    // Gens 4 and below swap in `-getStat('spe')` for a negative fractional priority (equal priority, equal fraction).
    if (speedOf(battle, first.pokemon) !== speedOf(battle, second.pokemon)) return false;
    const [one, other] = [plainPriority(battle, first.moveId), plainPriority(battle, second.moveId)];
    if (one !== null && other !== null && freeOfPriorityHandlers(battle, first.pokemon) && freeOfPriorityHandlers(battle, second.pokemon)) return one === other;
    return queueTie(battle, first, second);
  });
}

// Resolving an action has effects (Quick Claw and Quick Draw draw from the PRNG, Custap Berry eats the item).
function queueTie(battle: Battle, first: ActionAsk, second: ActionAsk): boolean {
  return ANSWERS.some(chance => {
    const copy = copyOf(battle);
    copy.prng = new FixedDice({ chance });
    return copy.comparePriority(moveAction(copy, first) as never, moveAction(copy, second) as never) === 0;
  });
}

/** A move's queue priority and speed on a copy; the Dex priority alone misses Prankster, Stall or Quick Claw. */
export interface QueuePlace {
  priority: number;
  speed: number;
}

// The priority the queue's own `Custap` event (Generation 4: Quick Claw, Custap Berry) gives an activated holder.
const CUSTAP_EVENT_GAIN = 0.1;

function hasCustapEvent(battle: Battle, pokemon: Pokemon): boolean {
  const item = battle.dex.items.get(pokemon.item) as unknown as { exists: boolean; onCustap?: unknown };
  return item.exists && item.onCustap !== undefined;
}

export function queuePlace(battle: Battle, pokemon: Pokemon, moveId: string, chance: boolean): QueuePlace {
  return guarded(battle, [], () => {
    // Generation 3's Quick Claw sits in `getActionSpeed` (`quickClawRoll`, set on the copy); from Generation 4 on,
    // Quick Claw and Custap Berry queue an event at the action's priority plus 0.1 (`onBeforeTurn`).
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

export function actionPriority(battle: Battle, pokemon: Pokemon, moveId: string, chance: boolean): number {
  return queuePlace(battle, pokemon, moveId, chance).priority;
}

/** Whether the turn's `-activate` lines show an item or ability of this body that the queue reads for the order. */
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
