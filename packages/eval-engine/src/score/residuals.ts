import { PRNG, type Battle, type Pokemon } from '@pkmn/sim';
import { AskLeak, playOnCopy } from '../sim-ask/index.ts';
import { Interner, residualKey } from './memo-keys.ts';

// Played on a copy at 3/4 HP, clocks set to lasting, dice fixed; only actives read (the sim ignores benched items).

/** Turns played and averaged, the race horizon (BITE_TURNS): toxic ramps, a Flame Orb burns one turn late. */
export const RESIDUAL_TURNS = 3;

const MID_HP = 3 / 4;

const MEMO_LIMIT = 20_000;

export const residualStats = { plays: 0, hits: 0 };

/** The loss per turn of an active, or undefined for a body with no reading (benched, fainted, or the play failed). */
export type Residuals = (pokemon: Pokemon) => number | undefined;

const memo = new Map<string, readonly number[] | null>();
const interner = new Interner();

/** @public A probe hook that no spec or source calls; docs/perf/probes read it (knip skips it by this tag). */
export function residualMemoSize(): { entries: number; keyChars: number; interned: number; internedChars: number } {
  let keyChars = 0;
  for (const key of memo.keys()) keyChars += key.length;
  const { entries, chars } = interner.held();
  return { entries: memo.size, keyChars, interned: entries, internedChars: chars };
}

export function resetResidualMemo(): void {
  memo.clear();
  interner.reset();
}

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
  // Generations 1 and 2 take status damage after the body's move, not at the turn's end: no reading, the table stays.
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

/** The mean loss per turn of `bodies` over the played end-of-turns, on `copy` itself: the play spends it. */
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

function play(battle: Battle): readonly number[] | null {
  try {
    return playOnCopy(battle, new PRNG('1,2,3,4'), copy => playResiduals(copy, slotsOf(copy)));
  } catch (error) {
    if (error instanceof AskLeak) throw error;
    return null;
  }
}
