import { describe, expect, test } from 'vitest';
import { Generations, Move, Pokemon, calculate } from '@smogon/calc';
import type { PokemonSet } from '@pkmn/sim';
import { inferSpreads } from '../src/spread-inference';
import { buildTeamsFromReplay, solveReplaySpreads } from '../src/team-builder';
import { parseReplayLogWithObservations } from '../src/protocol-parser';
import type { SmogonSetAssumptions } from '../src/smogon/sets-lookup';
import type { SmogonUsageStats } from '../src/smogon/stats-types';
import { calcGenerationFor } from '../src/calc-gen';
import { buildCalcPokemon } from '../src/calc-build';
import type { SpeedKnowledge } from '../src/spreads/scarf';
import type { PokemonEvs, SpeedOrderObservation } from '../src/types';

/**
 * Round 69 (T132 point 2, spec decision 12): a published Speed IV below 31 belongs to a Trick Room set. An order the
 * log shows with no Trick Room contradicts it, so the IV does not apply: the mon plays IV 31 before the solver buys a
 * Speed EV (2663093831 Sinistcha: published IV 0, Quiet, moved before Incineroar on turn 8; the solver bought
 * Quiet 252/0/0/0/136/120). The IV the log refutes goes first, the EVs and the nature stay, and the other published
 * IVs (Attack 0) stay too. A Champions body has no IVs to restore.
 */
const gen = Generations.get(9);
const evs = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number): PokemonEvs => ({ hp, atk, def, spa, spd, spe });
const set = (species: string, nature: string, spread: PokemonEvs, ivs: Partial<PokemonEvs> = {}, level = 100): PokemonSet => ({
  name: species, species, item: '', ability: '', moves: ['Protect'], nature, evs: spread,
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31, ...ivs }, level, gender: '',
});
const knowledge = (spreadKnown: boolean): Map<string, SpeedKnowledge> =>
  new Map([['p2:incineroar', { itemKnown: true, scarfRuledOut: true, spreadKnown, spreads: [] }]]);
const order = (turn = 8): SpeedOrderObservation => ({ firstSide: 'p1', firstSpecies: 'Sinistcha', secondSide: 'p2', secondSpecies: 'Incineroar', turn });
const speedOf = (species: string, nature: string, spread: PokemonEvs, ivs: Partial<PokemonEvs>) =>
  new Pokemon(gen, species, { level: 100, nature, evs: spread, ivs }).stats.spe;

for (const formatid of ['gen9ou', 'gen9doublesou']) {
  describe(`a seen order that refutes a published Speed IV (${formatid})`, () => {
    const trickRoom = { atk: 0, spe: 0 };
    const sinistcha = set('Sinistcha', 'Quiet', evs(252, 0, 4, 252, 0, 0), trickRoom);
    const solve = (incineroar: PokemonSet, orders = [order()]) => {
      const sets = { p1: [sinistcha], p2: [incineroar] };
      return inferSpreads([], sets, formatid, orders, knowledge(true)).get('p1:sinistcha');
    };

    test('the IV goes to 31 and no Speed EV is bought', () => {
      const incineroar = set('Incineroar', 'Careful', evs(252, 0, 4, 0, 252, 0));
      // The scene: the published body (130) is slower than Incineroar (156), IV 31 alone (158) is faster.
      const rival = speedOf('Incineroar', 'Careful', incineroar.evs, incineroar.ivs!);
      expect(speedOf('Sinistcha', 'Quiet', sinistcha.evs, sinistcha.ivs!)).toBeLessThan(rival);
      expect(speedOf('Sinistcha', 'Quiet', sinistcha.evs, { ...sinistcha.ivs, spe: 31 })).toBeGreaterThan(rival);
      const solved = solve(incineroar);
      expect(solved?.ivs?.spe).toBe(31);
      expect(solved?.ivs?.atk).toBe(0);
      expect(solved?.evs.spe).toBe(0);
      expect(solved?.nature).toBe('Quiet');
    });

    test('a rival IV 31 cannot beat still plays IV 31, with the fewest Speed EVs', () => {
      const incineroar = set('Incineroar', 'Jolly', evs(0, 252, 0, 0, 4, 40));
      const rival = speedOf('Incineroar', 'Jolly', incineroar.evs, incineroar.ivs!);
      expect(speedOf('Sinistcha', 'Quiet', sinistcha.evs, { ...sinistcha.ivs, spe: 31 })).toBeLessThan(rival);
      const solved = solve(incineroar);
      expect(solved?.ivs?.spe).toBe(31);
      const body = solved!;
      expect(speedOf('Sinistcha', body.nature, body.evs, body.ivs!)).toBeGreaterThan(rival);
      // The fewest Speed EVs that beat the rival at IV 31 in the solved nature, and more of them at the published IV 0.
      const fewest = (ivs: Partial<PokemonEvs>) => Array.from({ length: 64 }, (_, i) => i * 4)
        .find(spe => speedOf('Sinistcha', body.nature, { ...body.evs, spe }, ivs) > rival) ?? 252;
      expect(body.evs.spe).toBe(fewest(body.ivs!));
      expect(fewest(sinistcha.ivs!)).toBeGreaterThan(body.evs.spe);
    });

    test('an order the published body already keeps leaves the IV alone', () => {
      const incineroar = set('Incineroar', 'Careful', evs(252, 0, 4, 0, 252, 0));
      const slowLast: SpeedOrderObservation = { firstSide: 'p2', firstSpecies: 'Incineroar', secondSide: 'p1', secondSpecies: 'Sinistcha', turn: 8 };
      const solved = solve(incineroar, [slowLast]);
      expect(solved?.ivs?.spe ?? 0).toBe(0);
      expect(solved?.evs?.spe ?? 0).toBe(0);
    });
  });
}

describe('a Champions body has no IV to restore', () => {
  test('the order is settled on Stat Points and the IVs stay as published', () => {
    const level = 50;
    const slow = set('Garchomp', 'Quiet', evs(32, 0, 0, 0, 0, 0), { spe: 0 }, level);
    const fast = set('Lucario', 'Jolly', evs(0, 32, 0, 0, 0, 32), {}, level);
    const solved = inferSpreads([], { p1: [slow], p2: [fast] }, 'gen9championsou', [
      { firstSide: 'p1', firstSpecies: 'Garchomp', secondSide: 'p2', secondSpecies: 'Lucario', turn: 4 },
    ], new Map([['p2:lucario', { itemKnown: true, scarfRuledOut: true, spreadKnown: true, spreads: [] }]])).get('p1:garchomp');
    expect(solved?.ivs).toBeUndefined();
    const body = buildCalcPokemon(calcGenerationFor(0), 'Garchomp', { level, nature: solved?.nature ?? 'Quiet', evs: solved?.evs ?? slow.evs });
    const rival = buildCalcPokemon(calcGenerationFor(0), 'Lucario', { level, nature: 'Jolly', evs: fast.evs });
    expect(body.stats.spe).toBeGreaterThan(rival.stats.spe);
  });
});

describe('the IV the pre-solve restored reaches the build (two-stage solve)', () => {
  // 2663093831 in small: a published Trick Room Sinistcha (Quiet, Speed and Attack IV 0) moves before Incineroar twice, and
  // its damage lines keep the full solve from forfeiting the mon. The restored IV rides on the pre-solve's entry; the
  // full solve's answer for the same mon has none, so the carry has to bring it along.
  const published: SmogonSetAssumptions = {
    format: 'test', source: 's',
    pokemon: {
      sinistcha: {
        species: 'Sinistcha', sourceDetail: 's', item: { value: 'Sitrus Berry', sourceDetail: 's' },
        moves: ['Matcha Gotcha', 'Rage Powder', 'Trick Room', 'Shadow Ball'].map(value => ({ value, sourceDetail: 's' })),
        spread: { value: 'Quiet:252/0/76/8/172/0', nature: 'Quiet', evs: { hp: 252, atk: 0, def: 76, spa: 8, spd: 172, spe: 0 }, sourceDetail: 's' },
        ivs: { atk: 0, spe: 0 },
      },
    },
  };
  const usageStats: SmogonUsageStats = {
    format: 'test', month: 'm', source: 's',
    pokemon: { sinistcha: { species: 'Sinistcha', rawCount: 1000, abilities: [], spreads: [], items: [], moves: ['Matcha Gotcha', 'Rage Powder', 'Trick Room', 'Shadow Ball'].map(value => ({ value, probability: 0.9, sourceDetail: 'u' })) } },
  };
  // The damage lines come from the real body: Relaxed 252 HP / 252 Def, Speed IV 31 (the pre-solve's repair), Attack IV 0.
  const truth = new Pokemon(gen, 'Sinistcha', { level: 100, nature: 'Relaxed', evs: { hp: 252, def: 252, spa: 4 }, ivs: { atk: 0, spe: 31 } });
  const incineroar = new Pokemon(gen, 'Incineroar', { level: 100, nature: 'Hardy', evs: { hp: 252, atk: 252, spd: 4 } });
  const mid = (attacker: Pokemon, defender: Pokemon, move: string) => {
    const rolls = calculate(gen, attacker, defender, new Move(gen, move)).damage as number[];
    return rolls[Math.floor(rolls.length / 2)] / defender.maxHP();
  };
  const shadowBall = Math.round(100 * mid(truth, incineroar, 'Shadow Ball'));
  const knockOff = Math.round(100 * mid(incineroar, truth, 'Knock Off'));
  const turns = [1, 2].flatMap(turn => [
    `|turn|${turn}`,
    '|move|p2a: Sinistcha|Shadow Ball|p1a: Incineroar', `|-damage|p1a: Incineroar|${100 - shadowBall * turn}/100`,
    '|move|p1a: Incineroar|Knock Off|p2a: Sinistcha', `|-damage|p2a: Sinistcha|${100 - knockOff * turn}/100`,
  ]);
  const log = (doubles: boolean) => [
    '|player|p1|Alice|', '|player|p2|Bob|', ...(doubles ? ['|gametype|doubles'] : []), '|gen|9', `|tier|[Gen 9] ${doubles ? 'Doubles ' : ''}OU`,
    '|poke|p1|Incineroar, M|', ...(doubles ? ['|poke|p1|Amoonguss, M|'] : []), '|poke|p2|Sinistcha|', ...(doubles ? ['|poke|p2|Whimsicott, M|'] : []), '|start',
    '|switch|p1a: Incineroar|Incineroar, M|100/100', ...(doubles ? ['|switch|p1b: Amoonguss|Amoonguss, M|100/100'] : []),
    '|switch|p2a: Sinistcha|Sinistcha|100/100', ...(doubles ? ['|switch|p2b: Whimsicott|Whimsicott, M|100/100'] : []),
    ...turns,
  ].join(String.fromCharCode(10));

  for (const doubles of [false, true]) {
    test(`${doubles ? 'doubles' : 'singles'}: the built Sinistcha plays IV 31 in Speed and keeps Attack 0, no Speed EV`, () => {
      const text = log(doubles);
      const { observations, speedOrders } = parseReplayLogWithObservations(text);
      expect(speedOrders.length).toBeGreaterThan(0);
      const options = { speedOrders, usageStats, setAssumptions: published };
      const solved = solveReplaySpreads(text, observations, options);
      const built = buildTeamsFromReplay(text, { inferredSpreads: solved, usageStats, setAssumptions: published });
      const mon = built.p2Team.find(set => set.species === 'Sinistcha')!;
      const rival = built.p1Team.find(set => set.species === 'Incineroar')!;
      expect(mon.ivs?.spe).toBe(31);
      expect(mon.ivs?.atk).toBe(0);
      expect(mon.evs.spe).toBe(0);
      const speed = (set: PokemonSet) => new Pokemon(gen, set.species, { level: set.level, nature: set.nature, evs: set.evs, ivs: set.ivs }).stats.spe;
      expect(speed(mon)).toBeGreaterThan(speed(rival));
    });
  }
});
