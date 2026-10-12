import { describe, expect, test } from 'vitest';
import { Generations, Move, Pokemon, calculate } from '@smogon/calc';
import type { PokemonSet } from '@pkmn/sim';
import { inferSpreads } from '../src/spread-inference';
import { solveReplaySpreads } from '../src/team-builder';
import { parseReplayLogWithObservations } from '../src/protocol-parser';
import { toId } from '../src/ids';
import type { DamageObservation, PokemonEvs, SpeedOrderObservation } from '../src/types';

/**
 * Round 69 (T69, spec decision 13): every solved spread says where it comes from. Damage lines carry a fit, a proven
 * move order carries a Speed repair, the log's maximum HP sets the HP EVs inside the guess, and a decision that
 * solved no spread (an item, an IV) carries the guess untouched. A mon the full solve discards (misfit damage)
 * comes back from the pre-solve with the pre-solve's origin, so a guess that only a move order checked never reads
 * as fitted from damage (gen9ou-2658659909: 10 of 12 bodies carried the stamp without a damage line behind it).
 * Singles and doubles run one solver, so both formats go through every scene.
 */
const gen = Generations.get(9);
const evs = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number): PokemonEvs => ({ hp, atk, def, spa, spd, spe });
const set = (species: string, spread: PokemonEvs, level = 100, moves = ['Protect']): PokemonSet => ({
  name: species, species, item: '', ability: '', moves, nature: 'Hardy', evs: spread,
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level, gender: '',
});

/** A mid-roll hit computed forward with the true spreads. */
function observe(attacker: string, defender: string, moveName: string, defEvs: Partial<PokemonEvs>, attackerSide: 'p1' | 'p2'): DamageObservation {
  const hit = new Pokemon(gen, attacker, { level: 100, nature: 'Hardy', evs: evs(0, 252, 0, 252, 0, 0) });
  const target = new Pokemon(gen, defender, { level: 100, nature: 'Hardy', evs: defEvs });
  const result = calculate(gen, hit, target, new Move(gen, moveName));
  const rolls = (Array.isArray(result.damage) ? (result.damage as number[]).flat() : [Number(result.damage)]).map(Number);
  return {
    attackerSpecies: attacker, defenderSpecies: defender, attackerSide, moveId: toId(moveName),
    observedFraction: rolls[Math.floor(rolls.length / 2)] / target.maxHP(), lethal: false,
    attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '',
  };
}

for (const formatid of ['gen9ou', 'gen9doublesou']) {
  describe(`the origin of a solved spread (${formatid})`, () => {
    test('damage lines carry the fit: origin damage', () => {
      const sets = { p1: [set('Uxie', evs(0, 0, 0, 0, 0, 0))], p2: [set('Landorus-Therian', evs(0, 252, 0, 0, 4, 0), 100, ['U-turn', 'Knock Off'])] };
      const observations = [
        observe('Landorus-Therian', 'Uxie', 'U-turn', { hp: 252, def: 252 }, 'p2'),
        observe('Landorus-Therian', 'Uxie', 'Knock Off', { hp: 252, def: 252 }, 'p2'),
      ];
      expect(inferSpreads(observations, sets, formatid).get('p1:uxie')?.origin).toBe('damage');
    });

    test('a proven move order alone decides the spread: origin order', () => {
      const sets = { p1: [set('Noivern', evs(0, 0, 0, 252, 4, 0))], p2: [set('Iron Valiant', evs(0, 0, 0, 252, 4, 252))] };
      const order: SpeedOrderObservation = { firstSide: 'p1', firstSpecies: 'Noivern', secondSide: 'p2', secondSpecies: 'Iron Valiant', turn: 5 };
      const solved = inferSpreads([], sets, formatid, [order]);
      expect(solved.get('p1:noivern')?.origin).toBe('order');
    });

    test('the log\'s maximum HP sets the HP inside the guess: origin hp', () => {
      // Garchomp switched in at 409/409: base 108, IV 31 at level 100 is 208 HP EVs.
      const sets = { p2: [set('Garchomp', evs(0, 252, 0, 0, 4, 252), 100, ['Earthquake'])], p1: [] as PokemonSet[] };
      const solved = inferSpreads([], sets, formatid, [], new Map(), new Map([['p2:garchomp', { maxhp: 409, level: 100 }]])).get('p2:garchomp');
      expect(solved?.evs.hp).toBe(208);
      expect(solved?.origin).toBe('hp');
    });
  });
}

describe('a mon the full solve discards keeps the pre-solve\'s origin', () => {
  /** Two readings of one pairing no spread satisfies at once: the full solve forfeits both mons. */
  const contradictory = (attackerSpecies: string, defenderSpecies: string, moveId: string): DamageObservation[] =>
    [0.10, 0.60].map(observedFraction => ({
      attackerSpecies, defenderSpecies, attackerSide: 'p1' as const, moveId, observedFraction, lethal: false,
      attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '',
    }));
  const singles = [
    '|player|p1|Alice|', '|player|p2|Bob|', '|gen|9', '|tier|[Gen 9] OU',
    '|poke|p1|Garchomp, M|', '|poke|p2|Gliscor, M|',
    '|start', '|switch|p1a: Garchomp|Garchomp, M|100/100', '|switch|p2a: Gliscor|Gliscor, M|100/100', '|turn|1',
    '|move|p2a: Gliscor|Knock Off|p1a: Garchomp', '|-damage|p1a: Garchomp|80/100',
    '|move|p1a: Garchomp|Dragon Claw|p2a: Gliscor', '|-damage|p2a: Gliscor|60/100', '|turn|2',
  ];
  const doubles = [
    '|player|p1|Alice|', '|player|p2|Bob|', '|gen|9', '|gametype|doubles', '|tier|[Gen 9] Doubles OU',
    '|poke|p1|Garchomp, M|', '|poke|p1|Amoonguss, M|', '|poke|p2|Gliscor, M|', '|poke|p2|Dondozo, M|',
    '|start',
    '|switch|p1a: Garchomp|Garchomp, M|100/100', '|switch|p1b: Amoonguss|Amoonguss, M|100/100',
    '|switch|p2a: Gliscor|Gliscor, M|100/100', '|switch|p2b: Dondozo|Dondozo, M|100/100', '|turn|1',
    '|move|p2a: Gliscor|Knock Off|p1a: Garchomp', '|-damage|p1a: Garchomp|80/100',
    '|move|p1a: Garchomp|Dragon Claw|p2a: Gliscor', '|-damage|p2a: Gliscor|60/100', '|turn|2',
  ];

  for (const [label, lines] of [['singles', singles], ['doubles', doubles]] as const) {
    test(`${label}: the order-repaired Gliscor comes back as origin order, not damage`, () => {
      const log = lines.join('\n');
      const { speedOrders } = parseReplayLogWithObservations(log);
      expect(speedOrders).toHaveLength(1);
      const solved = solveReplaySpreads(log, contradictory('Garchomp', 'Gliscor', 'dragonclaw'), { speedOrders });
      expect(solved.get('p2:gliscor')?.origin).toBe('order');
    });
  }
});
