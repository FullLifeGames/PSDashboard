import { PRNG, type Battle, type Pokemon } from '@pkmn/sim';
import { serializeBattleStable, deserializeBattleExact } from '../forward/serialize.ts';
import { copyBattle } from '../forward/sim-fast/index.ts';

/**
 * 13.10.2026 (the Swords Dance report on gen9draft-2058494320): the HP a body in
 * a race gains or loses at the end of every turn, read from the simulator and
 * not from a list of effects. The table of the races knows burn, poison and
 * toxic; Leech Seed (the seeded body loses, the active of the seeder's side
 * gains the same HP), Leftovers and Black Sludge, the weather, the terrain and
 * the abilities of the weather are missing from it, and each of them kills or
 * saves a body the race says stands. Their fractions live in the simulator's
 * code (data/conditions.js, items.js, abilities.js, moves.js), not in its
 * data, so the answer is played: the end of the turn (`fieldEvent('Residual')`,
 * the call the simulator's own residual action makes) runs on a copy of the
 * battle and the HP of every active is read before and after.
 *
 * Three turns are played and the mean is read, the length of the race horizon
 * (BITE_TURNS of score/boost-race.ts): toxic ramps (1/16, 2/16, 3/16 on a fresh
 * toxic, the 1/8 that races.ts prices) and a Flame Orb burns one turn late. The
 * actives' HP is set to 3/4 before each turn, so that neither the cap of a
 * heal nor the cap of a hit on the HP left bends the reading, and the
 * durations of the weather, the terrain, the side conditions and the volatiles
 * are set to lasting (a weather on its last turn is read as the weather that
 * stands, not as the one that ends before it hurts). The dice are fixed: an
 * end-of-turn effect that rolls (Shed Skin) is read on one seed.
 *
 * A reading is the loss per turn as a fraction of the body's own max HP,
 * positive when the body loses HP and negative when it gains. It is kept in a
 * memo under a signature of everything the end of the turn reads (the format,
 * the field, the side conditions, and per active the types, the status, the
 * item, the ability, the volatiles and their state, the max HP), not under the
 * battle, so a search that visits thousands of leaves of one board plays it
 * once. Only the actives have a reading: the sim ignores the item and the
 * ability of a benched body, and the races read the table for it. Generations
 * 1 and 2 have none either: their status damage comes after the body's own
 * move (burn, poison), so the end of the turn plays nothing for it.
 */

/** Turns played, the length of the race horizon. */
export const RESIDUAL_TURNS = 3;

/** HP fraction the actives are set to before each played turn. */
const MID_HP = 3 / 4;

/** The memo is a tool of one process; a long session starts over when it has grown past this many boards. */
const MEMO_LIMIT = 20_000;

/** For tests: the boards played and the readings answered from the memo. */
export const residualStats = { plays: 0, hits: 0 };

/** The loss per turn of an active, or undefined for a body that has no reading (benched, fainted, or the play failed). */
export type Residuals = (pokemon: Pokemon) => number | undefined;

const memo = new Map<string, readonly number[] | null>();

/** For tests and probes: forget the memo, so that the next reading plays its board again. */
export function resetResidualMemo(): void {
  memo.clear();
}

/** The reading function of one battle: the end of the turn is played when the first reading is asked for. */
export function residualReader(battle: Battle): Residuals {
  let table: Map<Pokemon, number> | null | undefined;
  return pokemon => {
    if (!pokemon.isActive) return undefined;
    if (table === undefined) table = tableOf(battle);
    return table?.get(pokemon);
  };
}

/** Every active of the battle in a fixed order (side, slot), null for an empty or fainted slot. */
export const slotsOf = (battle: Battle): (Pokemon | null)[] =>
  battle.sides.flatMap(side => side.active.map(pokemon => (pokemon && !pokemon.fainted && pokemon.hp > 0 ? pokemon : null)));

function tableOf(battle: Battle): Map<Pokemon, number> | null {
  // Generations 1 and 2 take their status damage after the body's move, not in the end-of-turn event: no reading, the table stays.
  if (battle.gen <= 2) return null;
  const slots = slotsOf(battle);
  if (slots.every(pokemon => pokemon === null)) return null;
  const key = signature(battle, slots);
  let rates = memo.get(key);
  if (rates === undefined) {
    if (memo.size >= MEMO_LIMIT) memo.clear();
    rates = play(battle);
    memo.set(key, rates);
    residualStats.plays++;
  } else {
    residualStats.hits++;
  }
  if (!rates) return null;
  const table = new Map<Pokemon, number>();
  slots.forEach((pokemon, index) => { if (pokemon) table.set(pokemon, rates[index]); });
  return table;
}

/** The numbers, strings and flags of an effect's state, without its clocks and its references to other bodies. */
function stateKey(state: object | undefined): string {
  if (!state) return '';
  let key = '';
  for (const [name, value] of Object.entries(state)) {
    if (name === 'duration' || name === 'time' || name === 'startTime') continue;
    if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') key += `${name}=${value};`;
  }
  return key;
}

/** Everything the end of the turn reads of the field, the sides and the actives; HP is not part of it. */
function signature(battle: Battle, slots: (Pokemon | null)[]): string {
  const { field } = battle;
  const parts: string[] = [battle.format.id, `${field.weather}|${field.terrain}|${Object.keys(field.pseudoWeather).join(',')}`];
  for (const side of battle.sides) parts.push(Object.keys(side.sideConditions).join(','));
  for (const pokemon of slots) {
    if (!pokemon) { parts.push('-'); continue; }
    const volatiles = Object.entries(pokemon.volatiles).map(([id, state]) => `${id}:${stateKey(state as object)}`).join(',');
    parts.push([
      pokemon.species.id, pokemon.types.join('/'), pokemon.terastallized ?? '', pokemon.maxhp, pokemon.baseMaxhp,
      pokemon.status, stateKey(pokemon.statusState), pokemon.item, stateKey(pokemon.itemState),
      pokemon.ability, stateKey(pokemon.abilityState), volatiles,
    ].join('~'));
  }
  return parts.join('||');
}

/** A throw-away copy: the speed layer's when it is on, else a round trip through the stable serialization. */
export const copyOf = (battle: Battle): Battle => copyBattle(battle) ?? deserializeBattleExact(serializeBattleStable(battle));

/** An effect state's clock set to lasting, so that nothing ends or fires during the played turns. */
function lasting(state: unknown): void {
  const clock = state as { duration?: unknown } | null | undefined;
  if (clock && typeof clock.duration === 'number') clock.duration = Infinity;
}

function playedTurns(copy: Battle, bodies: (Pokemon | null)[]): number[] {
  const lost = bodies.map(() => 0);
  for (let turn = 0; turn < RESIDUAL_TURNS; turn++) {
    const before = bodies.map(pokemon => {
      if (!pokemon) return 0;
      pokemon.hp = Math.max(1, Math.floor(pokemon.maxhp * MID_HP));
      return pokemon.hp;
    });
    copy.fieldEvent('Residual');
    bodies.forEach((pokemon, index) => { if (pokemon) lost[index] += (before[index] - pokemon.hp) / pokemon.maxhp; });
  }
  return lost.map(sum => sum / RESIDUAL_TURNS);
}

/**
 * The mean loss per turn of `bodies` over the played end-of-turns, on `copy` itself (the play spends it): the clocks of
 * the weather, the terrain, the side conditions and the volatiles set to lasting, the dice fixed. The contact reads of
 * score/contact.ts use it on the copy of a hit to price the status the hit left.
 */
export function playResiduals(copy: Battle, bodies: (Pokemon | null)[]): number[] {
  lasting(copy.field.weatherState);
  lasting(copy.field.terrainState);
  for (const state of Object.values(copy.field.pseudoWeather)) lasting(state);
  for (const side of copy.sides) {
    for (const state of Object.values(side.sideConditions)) lasting(state);
    for (const pokemon of side.active) {
      if (pokemon) for (const state of Object.values(pokemon.volatiles)) lasting(state);
    }
  }
  copy.prng = new PRNG('1,2,3,4');
  return playedTurns(copy, bodies);
}

/** The mean loss per turn of every slot over the played end-of-turns, or null where the copy or the play fails. */
function play(battle: Battle): readonly number[] | null {
  try {
    const copy = copyOf(battle);
    return playResiduals(copy, slotsOf(copy));
  } catch {
    return null;
  }
}
