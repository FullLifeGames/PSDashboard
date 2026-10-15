import type { Battle, ID, Pokemon } from '@pkmn/sim';
import { hurtsItsUser } from './contact-play.ts';

/**
 * Whether anything in a pair could cost the attacker when it uses a move (13.10.2026, the contact punishments of
 * boostsBiting): the filter in front of the played hit of score/contact.ts, so that the pairs where nothing reacts cost a
 * few map lookups and not a copy of the board. It is a rule over the Dex, never a name:
 *
 * - the foe's item or ability has a handler for a hit it takes (`onDamagingHit`: Rocky Helmet, Rough Skin, Iron Barbs,
 *   Flame Body, Static, Poison Point, Effect Spore, and the like; `onHit`: the Sticky Barb that moves to the attacker);
 * - the attacker's own item or ability has a handler for the move it just used (`onAfterMoveSecondarySelf`: Life Orb);
 * - the move costs its user by itself (recoil, a crash, a self-destruct): the Dex's recoil fields say it, and a move the
 *   simulator treats in code and not in data (Chloroblast) is found by playing it once on a bare pair.
 *
 * test/contact-prefilter.spec.ts holds the rule to the simulator over the whole Dex of generation 9: wherever the played
 * hit costs the attacker HP or a status, the rule said so. A later version of the simulator that adds an effect the rule
 * does not see fails there.
 */

/** The events of the foe's item or ability that a hit on the foe can set off, and of the attacker's own when its move is done. */
const FOE_EVENTS = ['onDamagingHit', 'onHit'] as const;
const OWN_EVENTS = ['onAfterMoveSecondarySelf'] as const;

type DexMove = ReturnType<Battle['dex']['moves']['getByID']>;

/** What is known of a Dex, found once: its moves, which items and abilities have which handlers, which moves cost their user. */
export interface DexFacts {
  moves: Map<string, DexMove>;
  ownItems: Map<string, boolean>;
  ownAbilities: Map<string, boolean>;
  foeItems: Map<string, boolean>;
  foeAbilities: Map<string, boolean>;
  hurting: Map<string, boolean>;
}

const facts = new WeakMap<object, DexFacts>();

export function factsOf(battle: Battle): DexFacts {
  let known = facts.get(battle.dex);
  if (!known) {
    known = { moves: new Map(), ownItems: new Map(), ownAbilities: new Map(), foeItems: new Map(), foeAbilities: new Map(), hurting: new Map() };
    facts.set(battle.dex, known);
  }
  return known;
}

export function moveOf(known: DexFacts, battle: Battle, moveId: string): DexMove {
  let move = known.moves.get(moveId);
  if (!move) known.moves.set(moveId, move = battle.dex.moves.getByID(moveId as ID));
  return move;
}

/** Whether the item or ability has a handler for one of the events. */
function reacts(known: Map<string, boolean>, battle: Battle, kind: 'items' | 'abilities', id: string, events: readonly string[]): boolean {
  let answer = known.get(id);
  if (answer === undefined) {
    const effect = (kind === 'items' ? battle.dex.items : battle.dex.abilities).getByID(id as ID) as unknown as Record<string, unknown>;
    answer = !!id && !!effect.exists && events.some(name => typeof effect[name] === 'function');
    known.set(id, answer);
  }
  return answer;
}

/** Whether the move costs its user HP by itself. */
function moveHurts(known: DexFacts, battle: Battle, attacker: Pokemon, defender: Pokemon, move: DexMove, onProbe: () => void): boolean {
  if (move.recoil || move.struggleRecoil || move.mindBlownRecoil || move.selfdestruct) return true;
  let answer = known.hurting.get(move.id);
  if (answer === undefined) {
    onProbe();
    known.hurting.set(move.id, answer = hurtsItsUser(battle, attacker, defender, move.id));
  }
  return answer;
}

/** Whether anything in the pair could cost the attacker when it uses the move; `onProbe` is told of a move played on a bare pair. */
export function mayCost(known: DexFacts, battle: Battle, attacker: Pokemon, defender: Pokemon, move: DexMove, onProbe: () => void): boolean {
  if (!move.exists || move.category === 'Status') return false;
  return reacts(known.ownItems, battle, 'items', attacker.item, OWN_EVENTS)
    || reacts(known.ownAbilities, battle, 'abilities', attacker.ability, OWN_EVENTS)
    || reacts(known.foeItems, battle, 'items', defender.item, FOE_EVENTS)
    || reacts(known.foeAbilities, battle, 'abilities', defender.ability, FOE_EVENTS)
    || moveHurts(known, battle, attacker, defender, move, onProbe);
}
