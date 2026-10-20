import type { Battle, Pokemon } from '@pkmn/sim';
import { NO_COST, type HitCost, type StatusCost } from './contact-cost.ts';
import { playHit } from './contact-play.ts';
import { factsOf, mayCost, moveOf } from './contact-filter.ts';

export { NO_COST };
export type { HitCost, StatusCost };

/**
 * 13.10.2026 (the Swords Dance report on gen9draft-2058494320: Cobalion's contact moves into Talonflame meet Flame
 * Body, and the races of boostsBiting did not know it): what one hit of a move costs the attacker, read from the
 * simulator (score/contact-play.ts plays the hit on copies of the board) and memoized under everything the hit reads, so
 * that a search which visits thousands of leaves of one board plays each pair once. The cost is the HP the hit takes
 * from the attacker (the foe's item and ability on a contact hit, the move's recoil, the attacker's own item) and
 * the chance of each status it leaves.
 *
 * A hit is played only where something could cost: score/contact-filter.ts says so from the Dex (a handler for the hit on
 * the foe's item or ability, one for the attacker's own move on its item or ability, a move that costs its user), and
 * test/contact-prefilter.spec.ts holds that rule to the simulator over the whole Dex. What the simulator does with the
 * pair (contact at all, Protective Pads, Magic Guard, immunities) is left to the played hit.
 *
 * Not priced, and open: stat drops a contact hit gives (Gooey, Tangling Hair, Cotton Down), the turns a sleep or a
 * paralysis takes, the halved Speed of a paralysis, a Perish Song, an ability swapped by Mummy or Wandering Spirit, the
 * Aftermath of a foe the hit KOs, and what the move does to the stats of its own user (Close Combat).
 */

/** For tests: the pairs played, the readings answered from the memo, the copies played, the pairs that could not cost, the moves probed for a cost of their own. */
export const hitStats = { plays: 0, hits: 0, runs: 0, free: 0, probes: 0 };

/** The memo is a tool of one process; a long session starts over when it has grown past this many pairs. */
const MEMO_LIMIT = 20_000;
const memo = new Map<string, HitCost>();

/** For tests and probes: forget the memo, so that the next reading plays its pair again. */
export function resetHitMemo(): void {
  memo.clear();
}

const onProbe = (): void => { hitStats.probes++; };

/** For tests: whether anything in the pair could cost the attacker when it uses the move (the rule of score/contact-filter.ts). */
export function hitMayCost(battle: Battle, attacker: Pokemon, defender: Pokemon, moveId: string): boolean {
  const known = factsOf(battle);
  return mayCost(known, battle, attacker, defender, moveOf(known, battle, moveId), onProbe);
}

/** For tests: the cost of one hit as the simulator plays it, with no filter and no memo. */
export function playedHit(battle: Battle, attacker: Pokemon, defender: Pokemon, moveId: string): HitCost {
  return playHit(battle, attacker, defender, moveId);
}

/**
 * Everything the played hit reads of one body: its species and level (the stats follow), item, ability, status, types, Tera
 * type, max HP, the stored stats, the stages that decide a damage roll, and the volatiles that stand (a Substitute stops
 * the hit). Its HP is not part of it: both bodies are played at full HP.
 */
function bodyKey(pokemon: Pokemon): string {
  const stats = pokemon.storedStats;
  const stages = pokemon.boosts;
  return `${pokemon.species.id}~${pokemon.level}~${pokemon.item}~${pokemon.ability}~${pokemon.status}~${pokemon.types.join('/')}~` +
    `${pokemon.terastallized ?? ''}~${pokemon.maxhp}~${stats.atk}/${stats.def}/${stats.spa}/${stats.spd}/${stats.spe}~` +
    `${stages.atk}/${stages.def}/${stages.spa}/${stages.spd}~${Object.keys(pokemon.volatiles).join(',')}`;
}

/** The format, the weather, the terrain, the room effects and the side conditions: what the field adds to a hit. */
function fieldKey(battle: Battle): string {
  const { field } = battle;
  return `${battle.format.id}|${field.weather}|${field.terrain}|${Object.keys(field.pseudoWeather).join(',')}|` +
    battle.sides.map(side => Object.keys(side.sideConditions).join(',')).join('|');
}

/** Where a body stands. */
const placeKey = (pokemon: Pokemon): string => `${pokemon.side.id}${pokemon.position}:`;

/** The other actives (allies and foes of the pair): a Ruin ability, Friend Guard, Helping Hand and the like reach the hit. */
function sceneKey(battle: Battle, attacker: Pokemon, defender: Pokemon, keyOf: (pokemon: Pokemon) => string): string {
  return battle.sides.flatMap(side => side.active.map(p => (p && p !== attacker && p !== defender ? `${placeKey(p)}${keyOf(p)}` : '-'))).join('|');
}

/** The reading function of one battle: the cost of a hit of `moveId` from `attacker` on `defender` (null where the body has no damaging move). */
export type HitReader = (attacker: Pokemon, defender: Pokemon, moveId: string | null) => HitCost;

/** A reader for one evaluation: it keeps the keys of the bodies it has seen, the memo is the process's. */
export function hitReader(battle: Battle): HitReader {
  const bodies = new Map<Pokemon, string>();
  const known = factsOf(battle);
  let field: string | undefined;
  const keyOf = (pokemon: Pokemon): string => {
    let key = bodies.get(pokemon);
    if (key === undefined) bodies.set(pokemon, key = bodyKey(pokemon));
    return key;
  };
  return (attacker, defender, moveId) => {
    if (!moveId) return NO_COST;
    if (!mayCost(known, battle, attacker, defender, moveOf(known, battle, moveId), onProbe)) {
      hitStats.free++;
      return NO_COST;
    }
    field ??= fieldKey(battle);
    const key = `${field}#${moveId}#${placeKey(attacker)}${keyOf(attacker)}>${placeKey(defender)}${keyOf(defender)}#${sceneKey(battle, attacker, defender, keyOf)}`;
    let cost = memo.get(key);
    if (cost !== undefined) {
      hitStats.hits++;
      return cost;
    }
    if (memo.size >= MEMO_LIMIT) memo.clear();
    cost = playHit(battle, attacker, defender, moveId, () => { hitStats.runs++; });
    memo.set(key, cost);
    hitStats.plays++;
    return cost;
  };
}
