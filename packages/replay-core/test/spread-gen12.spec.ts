import { describe, expect, test } from 'vitest';
import { Battle, TeamValidator, type PokemonSet } from '@pkmn/sim';
import { Move, calculate } from '@smogon/calc';
import { inferSpreads } from '../src/spread-inference';
import { buildSolveContext, calcPokemon, keyOf, observationError, speedStat, spreadFor } from '../src/spreads/fit';
import { buildCalcPokemon } from '../src/calc-build';
import { calcGenerationFor } from '../src/calc-gen';
import { evTotal } from '../src/spreads/ev-budget';
import { toId } from '../src/ids';
import type { DamageObservation, PokemonEvs } from '../src/types';

/**
 * Round 69 (T192): the spread solver in Gens 1 and 2. The server fills a set without EVs with 252 in every stat there
 * (no EV limit, TeamValidator.validateSet), and the Special stat is one: Gen 1 copies Special Attack to Special Defense,
 * Gen 2 refuses a set that differs. The calculator throws on such a set, and observationError read the throw as "this
 * observation cannot judge" and returned 0, so a spread with Special Attack not equal to Special Defense was skipped
 * silently. The oracle is the simulator: a set validated by the server and played in a real battle. Gens 1 and 2 have
 * no doubles format, so these tests are singles only; no bank or feedback game plays them.
 */
const FORMATS = [{ formatid: 'gen1ou', num: 1 }, { formatid: 'gen2ou', num: 2 }];
const ZERO: PokemonEvs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

type Sheet = Pick<PokemonSet, 'species' | 'moves'> & { evs?: PokemonEvs };
const setOf = (sheet: Sheet): PokemonSet => ({
  name: sheet.species, species: sheet.species, item: '', ability: '', moves: sheet.moves, nature: '', evs: sheet.evs as PokemonEvs,
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100, gender: '',
});

/** The set as the server plays it: validated (fills the EVs, couples Special), then a real battle's stored stats. */
function simBody(formatid: string, set: PokemonSet) {
  const played = JSON.parse(JSON.stringify(set)) as PokemonSet;
  new TeamValidator(formatid).validateSet(played, {});
  const battle = new Battle({
    formatid: formatid as never, seed: [1, 2, 3, 4], p1: { team: [played] }, p2: { team: [{ species: 'Snorlax', moves: ['tackle'] } as PokemonSet] },
  } as never);
  const mon = battle.p1.pokemon[0];
  return { stats: mon.storedStats, maxHp: mon.maxhp, evs: played.evs };
}

const STATS = ['atk', 'def', 'spa', 'spd', 'spe'] as const;
const hitBy = (attackerSpecies: string, defenderSpecies: string, moveId: string, observedFraction: number): DamageObservation => ({
  attackerSpecies, defenderSpecies, attackerSide: 'p1', moveId, observedFraction, lethal: false,
  attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '',
});

for (const { formatid, num } of FORMATS) {
  const starmie = (evs?: PokemonEvs) => setOf({ species: 'Starmie', moves: ['Psychic'], evs });
  const snorlax = (evs?: PokemonEvs) => setOf({ species: 'Snorlax', moves: ['Body Slam'], evs });

  describe(`Gen ${num} bodies equal the simulator's (${formatid}, singles only)`, () => {
    test('a set without EVs starts from the EVs the server gives, not from zero', () => {
      const sets = { p1: [starmie()], p2: [snorlax()] };
      const ctx = buildSolveContext([], sets, formatid, []);
      const oracle = simBody(formatid, sets.p1[0]);
      expect(oracle.evs.atk).toBeGreaterThan(0);
      const body = calcPokemon(ctx, 'p1', 'Starmie', spreadFor(ctx, 'p1', 'Starmie'));
      expect(body.maxHP()).toBe(oracle.maxHp);
      for (const stat of STATS) expect(body.stats[stat], stat).toBe(oracle.stats[stat]);
    });

    test('Special Attack apart from Special Defense reads as the server plays it: one Special', () => {
      // Gen 1's validator copies Special Attack to Special Defense and Gen 2's refuses the set, so the oracle is the copy.
      const apart = { ...ZERO, hp: 252, spa: 252, spd: 0 };
      const sets = { p1: [starmie(apart)], p2: [snorlax()] };
      const ctx = buildSolveContext([], sets, formatid, []);
      const oracle = simBody(formatid, starmie({ ...apart, spd: apart.spa }));
      const spread = spreadFor(ctx, 'p1', 'Starmie');
      const body = calcPokemon(ctx, 'p1', 'Starmie', spread);
      expect(body.maxHP()).toBe(oracle.maxHp);
      for (const stat of STATS) expect(body.stats[stat], stat).toBe(oracle.stats[stat]);
      expect(speedStat(ctx, 'p1', 'Starmie', spread)).toBe(oracle.stats.spe);
    });
  });

  describe(`a spread with Special Attack not equal to Special Defense is not skipped (${formatid})`, () => {
    // The hit of the true body (Special 252), then an observation far above it: any body that is not skipped has error.
    const sets = { p1: [starmie({ ...ZERO, hp: 252, spa: 252, spd: 252 })], p2: [snorlax({ ...ZERO, hp: 252, def: 252, spa: 252, spd: 252 })] };
    const ctx = buildSolveContext([], sets, formatid, []);
    const trueFraction = (() => {
      const gen = calcGenerationFor(num);
      const make = (species: string) => buildCalcPokemon(gen, species, { level: 100, evs: { hp: 252, atk: 0, def: 252, spa: 252, spd: 252, spe: 0 } });
      const defender = make('Snorlax');
      const rolls = (calculate(gen, make('Starmie'), defender, new Move(gen, 'Psychic')).damage as number[]).map(Number);
      return Math.max(...rolls) / defender.maxHP();
    })();
    const observation = (fraction: number) => hitBy('Starmie', 'Snorlax', toId('Psychic'), fraction);
    const candidate = (evs: Partial<PokemonEvs>) => ({ evs: { ...ZERO, ...evs }, nature: '' });

    test('the coupled body explains the true hit and misses a far one', () => {
      const coupled = candidate({ hp: 252, spa: 252, spd: 252 });
      expect(observationError(ctx, observation(trueFraction), keyOf('p1', 'Starmie'), coupled)).toBe(0);
      expect(observationError(ctx, observation(Math.min(1, trueFraction + 0.4)), keyOf('p1', 'Starmie'), coupled)).toBeGreaterThan(0);
    });

    test('an apart spread is priced, not skipped as an observation that cannot judge', () => {
      const far = observation(Math.min(1, trueFraction + 0.4));
      const error = (evs: Partial<PokemonEvs>) => observationError(ctx, far, keyOf('p1', 'Starmie'), candidate(evs));
      const coupled = error({ hp: 252, spa: 252, spd: 252 });
      expect(coupled).toBeGreaterThan(0);
      // The server copies Special Attack to Special Defense: the apart spread plays as the Special Attack it names.
      expect(error({ hp: 252, spa: 252, spd: 0 })).toBe(coupled);
      expect(error({ hp: 252, spa: 0, spd: 252 })).toBeGreaterThan(coupled);
    });

    test('the solver answers one Special for a mon whose lines claim both, and keeps the server start where nothing measures', () => {
      // Sets without EVs: the server plays 252 in every stat; a Speed no order measures keeps it, and the total is no limit.
      const unspread = { p1: [starmie()], p2: [snorlax()] };
      const lines = [0.2, 0.22, 0.21].map(fraction => observation(fraction));
      const solved = inferSpreads(lines, unspread, formatid, []);
      expect(solved.size).toBeGreaterThan(0);
      for (const [key, spread] of solved) {
        expect(spread.evs.spa, key).toBe(spread.evs.spd);
        expect(spread.evs.spe, key).toBe(252);
        expect(evTotal(spread.evs), key).toBeGreaterThan(508);
      }
    });
  });
}
