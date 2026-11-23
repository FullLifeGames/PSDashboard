import { PRNG, type Battle, type Pokemon } from '@pkmn/sim';
import { AskLeak, playOnCopy } from '../sim-ask/index.ts';
import { Interner, residualKey } from './memo-keys.ts';

// The HP a body in a race gains or loses at the end of every turn, read from the simulator by playing the turn on a copy of the battle.

// Leech Seed, Leftovers, Black Sludge, the weather, the terrain and the abilities of the weather are missing from the races' table, and
// their fractions live in the simulator's code, not its data: the end of the turn (`fieldEvent('Residual')`, the call the simulator's
// own residual action makes) runs on a copy and the HP of every active is read before and after. The HP is set to 3/4 before each turn,
// so that neither the cap of a heal nor the cap of a hit bends the reading; the durations of the weather, the terrain, the side
// conditions and the volatiles are set to lasting (a weather on its last turn reads as the weather that stands). The dice are fixed: an
// end-of-turn effect that rolls (Shed Skin) is read on one seed. A reading is the loss per turn as a fraction of the body's own max HP,
// positive when the body loses HP. It is memoized under the board key of score/board-key.ts, not under the battle. Only the actives have
// a reading: the sim ignores the item and the ability of a benched body (the races read the table for it). Generations 1 and 2 have none:
// their status damage comes after the body's own move, so the end of the turn plays nothing for it.

/** Turns played and averaged, the length of the race horizon (BITE_TURNS of score/boost-race.ts): toxic ramps and a Flame Orb burns one turn late. */
export const RESIDUAL_TURNS = 3;

/** HP fraction the actives are set to before each played turn. */
const MID_HP = 3 / 4;

/** A long session starts the memo over when it has grown past this many boards. */
const MEMO_LIMIT = 20_000;

/** For tests: the boards played and the readings answered from the memo. */
export const residualStats = { plays: 0, hits: 0 };

/** The loss per turn of an active, or undefined for a body that has no reading (benched, fainted, or the play failed). */
export type Residuals = (pokemon: Pokemon) => number | undefined;

const memo = new Map<string, readonly number[] | null>();
/** The numbers the memo's keys hold for the keys of the boards and bodies (score/memo-keys.ts); it starts over with the memo. */
const interner = new Interner();

/**
 * For probes: what the memo and the interner of this process hold (entries and characters of the memo's keys, the interned texts).
 * @public A probe hook that no spec and no source file calls; the memory probes under docs/perf/probes read it (knip skips it by this tag).
 */
export function residualMemoSize(): { entries: number; keyChars: number; interned: number; internedChars: number } {
  let keyChars = 0;
  for (const key of memo.keys()) keyChars += key.length;
  const { entries, chars } = interner.held();
  return { entries: memo.size, keyChars, interned: entries, internedChars: chars };
}

/** For tests and probes: forget the memo. */
export function resetResidualMemo(): void {
  memo.clear();
  interner.reset();
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
  let key = residualKey(battle, slots, interner);
  let rates = memo.get(key);
  if (rates === undefined) {
    if (memo.size >= MEMO_LIMIT) {
      resetResidualMemo();
      key = residualKey(battle, slots, interner);
    }
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
 * The mean loss per turn of `bodies` over the played end-of-turns, on `copy` itself (the play spends it): the clocks of the weather,
 * the terrain, the side conditions and the volatiles set to lasting, the dice fixed. score/contact.ts prices the status a hit left with it.
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
    return playOnCopy(battle, new PRNG('1,2,3,4'), copy => playResiduals(copy, slotsOf(copy)));
  } catch (error) {
    if (error instanceof AskLeak) throw error;
    return null;
  }
}
