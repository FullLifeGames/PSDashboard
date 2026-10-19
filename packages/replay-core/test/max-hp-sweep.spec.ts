import { describe, expect, test } from 'vitest';
import { Battle, Dex, Teams } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import * as championsMod from '@pkmn/mods/champions';
import { hpEvsForMaxHp } from '../src/spreads/max-hp.ts';
import { calcEvs, evBudget, evStep, ZERO_EVS, type EvBudget } from '../src/spreads/ev-budget.ts';

/**
 * Round 72, T241 step 1c: `hpEvsForMaxHp` computes a maximum HP with the library (`gen.stats.calc` of @pkmn/data)
 * and not with its own copy of the formula. Two holds:
 *  - the simulator is the oracle: for every species of generations 3 to 9 (and every Champions species on the Stat Point
 *    scale), at the levels a replay plays and at 1 and 5, a Pokémon built with chosen HP EVs reports its `maxhp`, and the
 *    inverse, asked for that maxhp with the chosen EVs as its prior, answers the chosen EVs (the prior is nearest to
 *    itself, so a level that leaves several candidates still has one answer). Shedinja, whose HP is 1 whatever the
 *    spread, measures nothing: `undefined`.
 *  - the hand formula the function used until round 72 (`legacyHpEvsForMaxHp`) and the library agree on every base HP
 *    1 to 255, at the levels below, with IVs 31, 30 and 0, from either end of the prior, on both budgets, for every HP the
 *    formula can print and for the ones next to them.
 * Singles and doubles do not part here (the formula reads no game type); the Champions budget is the second table.
 */

function legacyHpEvsForMaxHp(
  baseHp: number, level: number, maxhp: number, priorHp: number, iv = 31, budget: EvBudget = evBudget(''),
): number | undefined {
  let best: number | undefined;
  for (let value = 0; value <= budget.perStat; value += evStep(budget)) {
    const ev = calcEvs({ ...ZERO_EVS, hp: value }, budget).hp;
    const hp = Math.floor((2 * baseHp + iv + Math.floor(ev / 4)) * level / 100) + level + 10;
    if (hp !== maxhp) continue;
    if (best === undefined || Math.abs(value - priorHp) < Math.abs(best - priorHp)) best = value;
  }
  return best;
}

Dex.mod('champions', championsMod as unknown as NonNullable<Parameters<typeof Dex.mod>[1]>);
Dex.formats.extend(championsMod.Formats);

const LEVELS = [1, 2, 5, 10, 50, 99, 100];
const BUDGETS: Array<[string, EvBudget]> = [['EVs', evBudget('gen9ou')], ['Stat Points', evBudget('gen9championsou')]];

/** The HP the hand formula prints for a count of EVs (or Stat Points) on a budget. */
const printedHp = (baseHp: number, level: number, iv: number, value: number, budget: EvBudget): number =>
  Math.floor((2 * baseHp + iv + Math.floor(calcEvs({ ...ZERO_EVS, hp: value }, budget).hp / 4)) * level / 100) + level + 10;

describe('the library formula equals the hand formula it replaced', () => {
  test.each(BUDGETS)('%s: base HP 2 to 255, levels, IVs, priors, every printable maxhp and its neighbours', (_name, budget) => {
    let asked = 0;
    const differing: string[] = [];
    for (let baseHp = 2; baseHp <= 255; baseHp++) {
      for (const level of LEVELS) {
        for (const iv of [31, 30, 0]) {
          const asks = new Set<number>();
          for (let value = 0; value <= budget.perStat; value += evStep(budget)) {
            const hp = printedHp(baseHp, level, iv, value, budget);
            asks.add(hp - 1); asks.add(hp); asks.add(hp + 1);
          }
          for (const maxhp of asks) {
            for (const prior of [0, budget.perStat]) {
              asked++;
              const now = hpEvsForMaxHp(baseHp, level, maxhp, prior, iv, budget);
              const old = legacyHpEvsForMaxHp(baseHp, level, maxhp, prior, iv, budget);
              if (now !== old && differing.length < 5) differing.push(`base ${baseHp} L${level} iv ${iv} maxhp ${maxhp} prior ${prior}: ${now} against ${old}`);
            }
          }
        }
      }
    }
    expect(differing).toEqual([]);
    expect(asked).toBeGreaterThan(100_000);
  });

  test('a base HP of 1 measures nothing: the 1 HP the log prints says nothing about the spread', () => {
    for (const level of LEVELS) {
      expect(hpEvsForMaxHp(1, level, 1, 0)).toBeUndefined();
      expect(hpEvsForMaxHp(1, level, 1, 0, 31, evBudget('gen9championsou'))).toBeUndefined();
    }
  });

  test('Shedinja is the only species of any generation with a base HP of 1', () => {
    const names = new Set<string>();
    for (let generation = 3; generation <= 9; generation++) {
      for (const entry of Dex.forGen(generation).species.all()) if (entry.exists && entry.baseStats.hp === 1) names.add(entry.name);
    }
    expect([...names]).toEqual(['Shedinja']);
  });
});

/** Teams of six built from `mons`, battle by battle, so one Battle reports twelve maximum HPs. */
function maxHpsOf(format: string, mons: Array<{ species: string; level: number; ev: number }>): number[] {
  const out: number[] = [];
  for (let i = 0; i < mons.length; i += 12) {
    const real = mons.slice(i, i + 12);
    // A side with no Pokémon asks the (absent) team generator: the last battle is filled up with a filler whose HP is dropped.
    const chunk = [...real, ...Array.from({ length: 12 - real.length }, () => ({ species: 'Pikachu', level: 50, ev: 0 }))];
    const sets = (part: typeof chunk): PokemonSet[] => part.map(mon => ({
      name: mon.species, species: mon.species, item: '', ability: 'No Ability', moves: ['tackle'], nature: 'Hardy', gender: '',
      evs: { hp: mon.ev, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: mon.level,
    }));
    const battle = new Battle({
      formatid: format as never,
      seed: [1, 2, 3, 4],
      p1: { name: 'a', team: Teams.pack(sets(chunk.slice(0, 6))) },
      p2: { name: 'b', team: Teams.pack(sets(chunk.slice(6))) },
    });
    out.push(...[...battle.p1.pokemon, ...battle.p2.pokemon].slice(0, real.length).map(pokemon => pokemon.maxhp));
  }
  return out;
}

describe('the simulator is the oracle: every species, the maxhp it reports comes back as the EVs that made it', () => {
  test.each([3, 4, 5, 6, 7, 8, 9])('generation %i, levels 1, 5, 50 and 100', (generation) => {
    const dex = Dex.forGen(generation);
    const species = dex.species.all().filter(entry => entry.exists && entry.gen <= generation);
    expect(species.length).toBeGreaterThan(100);
    const mons = species.flatMap((entry, index) => [1, 5, 50, 100].map(level => ({
      species: entry.name, level, ev: ((index * 7 + level) % 64) * 4, baseHp: entry.baseStats.hp,
    })));
    const reported = maxHpsOf(`gen${generation}customgame`, mons);
    expect(reported.length).toBe(mons.length);
    // The oracle reads real numbers: Shedinja reports 1 HP.
    expect(reported[mons.findIndex(mon => mon.species === 'Shedinja')]).toBe(1);
    const wrong: string[] = [];
    mons.forEach((mon, index) => {
      const answer = hpEvsForMaxHp(mon.baseHp, mon.level, reported[index], mon.ev);
      const expected = mon.baseHp === 1 ? undefined : mon.ev;
      if (answer !== expected) wrong.push(`${mon.species} L${mon.level} ev ${mon.ev} maxhp ${reported[index]}: ${answer}`);
    });
    expect(wrong.slice(0, 5)).toEqual([]);
  }, 120_000);
});

describe('the simulator is the oracle on the Stat Point scale: every species of the Champions mod, singles and doubles formats', () => {
  test.each(['gen9championsou', 'gen9championsdoublescustomgame'])('%s, level 50, 0 to 32 Stat Points', (format) => {
    const species = Dex.dexes.champions.species.all().filter(entry => entry.exists && entry.gen <= 9);
    expect(species.length).toBeGreaterThan(100);
    const mons = species.map((entry, index) => ({ species: entry.name, level: 50, ev: (index * 5) % 33, baseHp: entry.baseStats.hp }));
    const reported = maxHpsOf(format, mons);
    expect(reported.length).toBe(mons.length);
    const wrong: string[] = [];
    mons.forEach((mon, index) => {
      const answer = hpEvsForMaxHp(mon.baseHp, mon.level, reported[index], mon.ev, 31, evBudget(format));
      const expected = mon.baseHp === 1 ? undefined : mon.ev;
      if (answer !== expected) wrong.push(`${mon.species} SP ${mon.ev} maxhp ${reported[index]}: ${answer}`);
    });
    expect(wrong.slice(0, 5)).toEqual([]);
  }, 120_000);
});
