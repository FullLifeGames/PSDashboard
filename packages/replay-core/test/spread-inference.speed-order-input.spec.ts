import './champions-mod';
import { describe, expect, test } from 'vitest';
import { Generations, Pokemon, Move, calculate } from '@smogon/calc';
import type { PokemonSet } from '@pkmn/sim';
import { parseReplayLogWithObservations } from '../src/protocol-parser';
import { inferSpreads } from '../src/spread-inference';
import type { SpeedKnowledge } from '../src/spreads/scarf';
import type { SpeedOrderObservation, DamageObservation, PokemonEvs } from '../src/types';
import { buildSolveContext, observationError } from '../src/spreads/fit';
import { toId } from '../src/ids';
import { solveReplaySpreads } from '../src/team-builder';
import { buildCalcPokemon } from '../src/calc-build';
import { calcGenerationFor } from '../src/calc-gen';

/**
 * What the solver reads from a move order. A race ran with the Choice Scarf the mover held that turn, and a Scarf that came or went
 * by Trick, Switcheroo or Knock Off is read at the races around it instead of voiding them (the build keeps the set's original
 * item, so a race won with a tricked Scarf is no claim on the set's Speed alone).
 */

const header = (gametype: 'singles' | 'doubles') => [
  '|player|p1|Alice|', '|player|p2|Bob|', '|gen|9', `|gametype|${gametype}`,
  gametype === 'singles' ? '|tier|[Gen 9] OU' : '|tier|[Gen 9] Doubles OU', '|start',
];
const annotated = (log: string) => parseReplayLogWithObservations(log).speedOrders
  .map(o => `t${o.turn} ${o.firstSpecies}${o.firstScarf === undefined ? '' : o.firstScarf ? '+S' : '-S'}>` +
    `${o.secondSpecies}${o.secondScarf === undefined ? '' : o.secondScarf ? '+S' : '-S'}`);

describe('a race is read with the Choice Scarf the mover held that turn', () => {
  const singles = (body: string[]) => [
    ...header('singles'),
    '|switch|p1a: A|Kingambit, F|100/100', '|switch|p2a: B|Gholdengo|100/100',
    '|turn|1', ...body,
  ].join('\n');
  const race = (turn: number) => [
    '|move|p1a: A|Iron Head|p2a: B', '|-damage|p2a: B|90/100', '|move|p2a: B|Shadow Ball|p1a: A', '|-damage|p1a: A|90/100',
    `|turn|${turn + 1}`,
  ];

  test('singles: a Scarf tricked onto the mover is read at the races it ran (2663108091 t21)', () => {
    expect(annotated(singles([
      ...race(1),
      '|move|p2a: B|Trick|p1a: A', '|-activate|p2a: B|move: Trick|[of] p1a: A',
      '|-item|p1a: A|Choice Scarf|[from] move: Trick', '|-enditem|p2a: B|Choice Scarf|[silent]|[from] move: Trick',
      '|move|p1a: A|Iron Head|p2a: B', '|-damage|p2a: B|80/100', '|turn|3',
      ...race(3),
    ]))).toEqual(['t1 Kingambit-S>Gholdengo+S', 't3 Kingambit+S>Gholdengo-S']);
  });

  test('singles: a Trick that swaps two items names the giver of the Scarf (751512 t14)', () => {
    // Both held an item, so no |-enditem|: the Scarf's arrival names its giver.
    expect(annotated(singles([
      ...race(1),
      '|move|p2a: B|Trick|p1a: A', '|-activate|p2a: B|move: Trick|[of] p1a: A',
      '|-item|p1a: A|Choice Scarf|[from] move: Trick', '|-item|p2a: B|Leftovers|[from] move: Trick', '|turn|3',
      ...race(3),
    ]))).toEqual(['t1 Kingambit-S>Gholdengo+S', 't3 Kingambit+S>Gholdengo-S']);
  });

  test('singles: the races after a Knock Off stand without the Scarf', () => {
    expect(annotated(singles([
      '|move|p2a: B|Shadow Ball|p1a: A', '|-damage|p1a: A|90/100', '|move|p1a: A|Iron Head|p2a: B', '|-damage|p2a: B|90/100',
      '|turn|2',
      '|move|p1a: A|Knock Off|p2a: B', '|-damage|p2a: B|70/100', '|-enditem|p2a: B|Choice Scarf|[from] move: Knock Off|[of] p1a: A',
      '|move|p2a: B|Shadow Ball|p1a: A', '|-damage|p1a: A|80/100', '|turn|3',
      ...race(3),
    ]))).toEqual(['t1 Gholdengo+S>Kingambit', 't3 Kingambit>Gholdengo-S']);
  });

  test('doubles: a Switcheroo between p1b and p2a annotates both slots', () => {
    const log = [
      ...header('doubles'),
      '|switch|p1a: A|Kingambit, F|100/100', '|switch|p1b: C|Lopunny, F|100/100',
      '|switch|p2a: B|Latias, F|100/100', '|switch|p2b: D|Amoonguss, M|100/100',
      '|turn|1',
      '|move|p1b: C|Switcheroo|p2a: B', '|-activate|p1b: C|move: Trick|[of] p2a: B',
      '|-item|p2a: B|Choice Scarf|[from] move: Switcheroo', '|-item|p1b: C|Sitrus Berry|[from] move: Switcheroo',
      '|turn|2',
      '|move|p2a: B|Draco Meteor|p1a: A', '|-damage|p1a: A|90/100',
      '|move|p1b: C|Fake Tears|p2b: D',
      '|move|p2b: D|Spore|p1a: A',
      '|turn|3',
    ].join('\n');
    expect(annotated(log)).toEqual(['t2 Latias+S>Lopunny-S', 't2 Lopunny-S>Amoonguss']);
  });
});

describe('the solver reads a race with the Scarf the order names', () => {
  const gen = Generations.get(9);
  const set = (species: string, item: string): PokemonSet => ({
    name: species, species, item, ability: '', moves: ['Iron Head'],
    nature: 'Adamant', evs: { hp: 0, atk: 252, def: 4, spa: 0, spd: 0, spe: 252 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100, gender: '',
  });
  const known = (entries: string[]): Map<string, SpeedKnowledge> => new Map(entries.map(key => [key, {
    itemKnown: true, scarfRuledOut: false, spreadKnown: false, spreads: [],
  }]));

  for (const formatid of ['gen9ou', 'gen9doublesou']) {
    test(`a tricked Scarf carries its holder's race (2663108091 t25, ${formatid})`, () => {
      // Kingambit (199, its set keeps the Air Balloon it started with) raced
      // Dragonite (259) with Gholdengo's Scarf: 298 outruns it, Dragonite
      // keeps its Speed. Read without the Scarf, the order slowed Dragonite to 196.
      const sets = { p1: [set('Dragonite', 'Heavy-Duty Boots')], p2: [set('Kingambit', 'Air Balloon')] };
      const order: SpeedOrderObservation = {
        firstSide: 'p2', firstSpecies: 'Kingambit', secondSide: 'p1', secondSpecies: 'Dragonite', turn: 25, firstScarf: true,
      };
      const solved = inferSpreads([], sets, formatid, [order], known(['p1:dragonite', 'p2:kingambit']));
      const dragonite = solved.get('p1:dragonite') ?? sets.p1[0];
      expect(new Pokemon(gen, 'Dragonite', { nature: dragonite.nature, evs: dragonite.evs }).stats.spe).toBe(259);
      expect(solved.get('p2:kingambit')?.item).toBeUndefined();
    });
  }
});

describe('a knock-out order says the victim fell before acting', () => {
  // Its chosen move, and with it the move's priority, never shows: a Trick Room or a Roar the victim clicked would have moved last
  // at any Speed (such an order is weak evidence).
  test('singles', () => {
    const log = [
      ...header('singles'), '|switch|p1a: A|Sylveon, F|100/100', '|switch|p2a: B|Cresselia, F|100/100', '|turn|1',
      '|move|p1a: A|Hyper Voice|p2a: B', '|-damage|p2a: B|0 fnt', '|faint|p2a: B', '|turn|2',
    ].join('\n');
    expect(parseReplayLogWithObservations(log).speedOrders.map(o => [o.firstSpecies, o.secondSpecies, o.knockOut]))
      .toEqual([['Sylveon', 'Cresselia', true]]);
  });

  test('doubles', () => {
    const log = [
      ...header('doubles'),
      '|switch|p1a: A|Dragonite, M|100/100', '|switch|p1b: C|Cresselia, F|100/100',
      '|switch|p2a: B|Scizor, M|100/100', '|switch|p2b: D|Sylveon, F|100/100',
      '|turn|1',
      '|move|p1a: A|Iron Head|p2b: D', '|-damage|p2b: D|60/100',
      '|move|p2b: D|Hyper Voice|p1b: C|[spread] p1a,p1b', '|-damage|p1a: A|70/100', '|-damage|p1b: C|0 fnt', '|faint|p1b: C',
      '|turn|2',
    ].join('\n');
    expect(parseReplayLogWithObservations(log).speedOrders.map(o => [o.firstSpecies, o.secondSpecies, o.knockOut]))
      .toEqual([['Sylveon', 'Cresselia', true], ['Dragonite', 'Sylveon', undefined]]);
  });
});

const gen = Generations.get(9);
type Mon = { species: string; side: 'p1' | 'p2'; nature: string; evs: PokemonEvs };
const evs = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number): PokemonEvs => ({ hp, atk, def, spa, spd, spe });
const asSet = (m: Mon, moves: string[]): PokemonSet => ({
  name: m.species, species: m.species, item: '', ability: '', moves, nature: m.nature, evs: m.evs,
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100, gender: '',
});
function hit(attacker: Mon, defender: Mon, moveName: string): DamageObservation {
  const a = new Pokemon(gen, attacker.species, { level: 100, nature: attacker.nature, evs: attacker.evs });
  const d = new Pokemon(gen, defender.species, { level: 100, nature: defender.nature, evs: defender.evs });
  const rolls = (calculate(gen, a, d, new Move(gen, moveName)).damage as number[]).flat().map(Number);
  return {
    attackerSpecies: attacker.species, defenderSpecies: defender.species, attackerSide: attacker.side,
    moveId: toId(moveName), observedFraction: rolls[8] / d.maxHP(), lethal: false,
    attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '',
  };
}
const total = (spread: PokemonEvs) => Object.values(spread).reduce((sum, value) => sum + value, 0);

describe('a solve spends the budget the damage lines leave open (T122 point 7)', () => {
  // The real Rillaboom runs a small offense and a little HP; the usage prior (Adamant 252 Atk / 252 Spe)
  // hits too hard, so the fit takes the 0-offense rung, and the bulk rung beside it is uninvested.
  const truth: Mon = { species: 'Rillaboom', side: 'p1', nature: 'Hardy', evs: evs(100, 60, 0, 0, 0, 252) };
  const prior: Mon = { ...truth, nature: 'Adamant', evs: evs(0, 252, 4, 0, 0, 252) };
  const garchomp: Mon = { species: 'Garchomp', side: 'p2', nature: 'Jolly', evs: evs(0, 252, 4, 0, 0, 252) };
  const dragonite: Mon = { species: 'Dragonite', side: 'p2', nature: 'Adamant', evs: evs(0, 252, 4, 0, 0, 252) };
  const observations = [hit(truth, garchomp, 'Wood Hammer'), hit(dragonite, truth, 'Extreme Speed')];
  const sets = { p1: [asSet(prior, ['Wood Hammer'])], p2: [asSet(garchomp, ['Earthquake']), asSet(dragonite, ['Extreme Speed'])] };

  for (const formatid of ['gen9ou', 'gen9doublesou']) {
    test(`a rung that zeroes offense and bulk keeps the EVs its damage lines allow (${formatid})`, () => {
      const solved = inferSpreads(observations, sets, formatid)!.get('p1:rillaboom')!;
      expect(total(solved.evs)).toBeGreaterThan(440);
      expect(solved.evs.spe).toBe(252);
      // The filled spread still fits both lines.
      const ctx = buildSolveContext(observations, sets, formatid, []);
      for (const obs of observations) expect(observationError(ctx, obs, 'p1:rillaboom', solved)).toBeLessThan(1e-12);
    });
  }
});

describe('the open budget refills toward the prior first (T122 point 7, round 64 h2)', () => {
  // 573756 shape: the fit takes the physically defensive rung (252 HP / 252 Def) over the specially
  // defensive prior (Calm 252 HP / 252 SpD), which zeroes SpD and leaves 4 EVs open. The lines cannot tell where those
  // 4 go; the prior put its EVs in SpD, so they go there, not into an Attack no line asks for.
  const truth: Mon = { species: 'Toxapex', side: 'p1', nature: 'Bold', evs: evs(252, 0, 252, 0, 4, 0) };
  const prior: Mon = { ...truth, nature: 'Calm', evs: evs(252, 0, 4, 0, 252, 0) };
  const garchomp: Mon = { species: 'Garchomp', side: 'p2', nature: 'Jolly', evs: evs(0, 252, 4, 0, 0, 252) };
  const bolt: Mon = { species: 'Raging Bolt', side: 'p2', nature: 'Modest', evs: evs(0, 0, 4, 252, 0, 252) };
  const observations = [hit(garchomp, truth, 'Earthquake'), hit(bolt, truth, 'Thunderbolt'), hit(truth, garchomp, 'Knock Off')];
  const sets = {
    p1: [asSet(prior, ['Knock Off', 'Recover'])],
    p2: [asSet(garchomp, ['Earthquake']), asSet(bolt, ['Thunderbolt'])],
  };

  for (const formatid of ['gen9ou', 'gen9doublesou']) {
    test(`the 4 EVs the bulk rung leaves open land in SpD as in the prior, not in Attack (${formatid})`, () => {
      const solved = inferSpreads(observations, sets, formatid)!.get('p1:toxapex')!;
      expect(solved.evs).toEqual(evs(252, 0, 252, 0, 4, 0));
    });
  }
});

describe('spread-ladder-release', () => {
  const gen = Generations.get(9);
  type Side = { species: string; side: 'p1' | 'p2'; nature: string; evs: PokemonSet['evs'] };
  const mon = (species: string, side: 'p1' | 'p2', nature: string, evs: PokemonSet['evs']): Side => ({ species, side, nature, evs });
  const asSet = (m: Side, moves: string[]): PokemonSet => ({
    name: m.species, species: m.species, item: '', ability: '', moves, nature: m.nature, evs: m.evs,
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100, gender: '',
  });
  function hit(attacker: Side, defender: Side, moveName: string, lethal = false, rollIndex = 8): DamageObservation {
    const a = new Pokemon(gen, attacker.species, { level: 100, nature: attacker.nature, evs: attacker.evs });
    const d = new Pokemon(gen, defender.species, { level: 100, nature: defender.nature, evs: defender.evs });
    const result = calculate(gen, a, d, new Move(gen, moveName));
    const rolls = (Array.isArray(result.damage) ? (result.damage as number[]).flat() : [Number(result.damage)]).map(Number);
    return {
      attackerSpecies: attacker.species, defenderSpecies: defender.species, attackerSide: attacker.side,
      moveId: toId(moveName), observedFraction: rolls[Math.min(rollIndex, rolls.length - 1)] / d.maxHP(), lethal,
      attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '',
    };
  }
  const evTotal = (evs: Record<string, number> | undefined) => Object.values(evs ?? {}).reduce((sum, value) => sum + value, 0);

  const offensive = { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 };
  const bulkyAttacker = { hp: 252, atk: 252, def: 0, spa: 0, spd: 0, spe: 4 };
  const garchomp = mon('Garchomp', 'p2', 'Jolly', offensive);
  const clefable = mon('Clefable', 'p1', 'Bold', { hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0 });
  const toxapex = mon('Toxapex', 'p1', 'Bold', { hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0 });
  const beforeClefable = { firstSide: 'p2' as const, firstSpecies: 'Garchomp', secondSide: 'p1' as const, secondSpecies: 'Clefable', turn: 3 };
  const maxHp420 = new Map([['p2:garchomp', { maxhp: 420, level: 100 }]]);

  describe('a kept Speed gives way to a measured offense (round 41)', () => {
    const truth = { ...garchomp, nature: 'Adamant', evs: bulkyAttacker };
    const sets = {
      p1: [asSet(clefable, ['Moonblast']), asSet(toxapex, ['Scald'])],
      p2: [asSet(garchomp, ['Earthquake', 'Swords Dance'])],
    };
    // Two clean Earthquakes from the real Adamant 252 Atk body; the top roll
    // on Toxapex puts the line above what a Hardy body can deal.
    const observations = [hit(truth, clefable, 'Earthquake'), hit(truth, toxapex, 'Earthquake', false, 15)];

    for (const formatid of ['gen9ou', 'gen9doublesou']) {
      test(`a measured offense outlasts a kept Speed beside the log's HP (${formatid})`, () => {
        // Prior Jolly 252 Atk / 252 Spe, the log says 420 HP (252 HP EVs), the order Garchomp-before-Clefable is satisfied by the prior
        // (Speed kept), the Earthquakes measure 252 Atk. Dropping every offense rung the budget cannot express beside the kept Speed solves
        // Jolly 252/0/0/0/4/252 (sim Earthquake 75% of the hit).
        const solved = inferSpreads(observations, sets, formatid, [beforeClefable], new Map(), maxHp420).get('p2:garchomp');
        expect(solved?.evs.hp).toBe(252);
        expect(solved?.evs.atk).toBe(252);
        expect(solved?.evs.spe ?? 0).toBeLessThanOrEqual(4);
        expect(evTotal(solved?.evs)).toBeLessThanOrEqual(508);
        expect(solved?.nature).toBe('Adamant');
      });
    }

    test('without the HP reading the EVs stand, without the order the fit was already right', () => {
      const noHp = inferSpreads(observations, sets, 'gen9ou', [beforeClefable]).get('p2:garchomp');
      expect(noHp?.evs ?? offensive).toEqual(offensive);
      // The kept Speed does not block the offense nature: holding Jolly here costs 10 % of the lines (the top roll on Toxapex lies above
      // what a Jolly body deals); the order still holds at Adamant.
      expect(noHp?.nature).toBe('Adamant');
      // Without the order nothing measures the prior's 252 Spe, so the log's HP and the offense claim do not take its room. A prior whose
      // Speed is the truth's 4 still solves the bulky attacker.
      const noOrder = inferSpreads(observations, sets, 'gen9ou', [], new Map(), maxHp420).get('p2:garchomp');
      expect(noOrder?.evs.spe).toBe(252);
      expect(noOrder?.evs.hp).toBe(252);
      expect(evTotal(noOrder?.evs)).toBeLessThanOrEqual(508);
      const slowPrior = { p1: sets.p1, p2: [asSet({ ...garchomp, evs: { ...offensive, spe: 4 } }, ['Earthquake', 'Swords Dance'])] };
      const slow = inferSpreads(observations, slowPrior, 'gen9ou', [], new Map(), maxHp420).get('p2:garchomp');
      expect(slow?.evs).toEqual(bulkyAttacker);
    });

    test('a bulk claim beside an expressed offense claim does not release the kept Speed', () => {
      // No HP reading: the offense rung fits beside the kept Speed (the prior itself), only the 252-HP claim riding with it is shaved.
      // Speed is released for the offense claim's own room, never for a bulk claim (573756 t73: a bulk rung stripped the Speed).
      const defenderLines = [hit(clefable, truth, 'Moonblast'), hit(toxapex, truth, 'Scald')];
      const solved = inferSpreads([...observations, ...defenderLines], sets, 'gen9ou', [beforeClefable]).get('p2:garchomp');
      expect(solved?.evs.spe ?? 252).toBe(252);
      // The Speed EVs stay (a bulk claim releases nothing); the offense nature of the seen lines opens.
      expect(solved?.nature).toBe('Adamant');
    });

    test('the released Speed must still satisfy the observed orders', () => {
      // Garchomp moved before a Jolly 252 Spe Lucario (306): the prior's 333
      // satisfies it, the released bodies (241 Hardy, 265 Jolly) do not. The
      // order is proof, the damage only a bound: Speed stays, the offense goes.
      const lucario = mon('Lucario', 'p1', 'Jolly', { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 });
      const withLucario = { p1: [...sets.p1, asSet(lucario, ['Close Combat'])], p2: sets.p2 };
      const beforeLucario = { ...beforeClefable, secondSpecies: 'Lucario' };
      const solved = inferSpreads(observations, withLucario, 'gen9ou', [beforeLucario], new Map(), maxHp420).get('p2:garchomp');
      expect(solved?.evs.spe).toBe(252);
      expect(solved?.nature).toBe('Jolly');
      expect(solved?.evs.atk).toBe(0);
    });
  });

  describe('two kept stats over the budget (round 41)', () => {
    const sets = {
      p1: [asSet(clefable, ['Moonblast'])],
      p2: [asSet(garchomp, ['Earthquake', 'Swords Dance'])],
    };
    const shaved = { ...garchomp, evs: { hp: 252, atk: 4, def: 0, spa: 0, spd: 0, spe: 252 } };
    const full = { ...garchomp, nature: 'Hardy', evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 0, spe: 4 } };
    const maxRoll = (attacker: Side) => hit(attacker, clefable, 'Earthquake', true, 15).observedFraction;

    test('a knock-out the shaved offense cannot reach frees the kept Speed', () => {
      // Knock-out-only offense (kept), the log's 420 HP (fixed), a satisfied order (Speed kept): 252 + 252 + 252 do not fit. The kept order
      // must not shave the kept Atk to 4 (Jolly 252/4/0/0/0/252) with nothing measuring it: a knock-out that a 4-Atk body cannot deal picks
      // the body that can (knock-out lines are lower bounds).
      expect(maxRoll(full)).toBeGreaterThan(maxRoll(shaved) + 0.04);
      const ko = (maxRoll(shaved) + 0.02 + maxRoll(full)) / 2;
      const observations = [
        { ...hit(garchomp, clefable, 'Earthquake', true), observedFraction: ko },
        hit(clefable, full, 'Moonblast'),
      ];
      const solved = inferSpreads(observations, sets, 'gen9ou', [beforeClefable], new Map(), maxHp420).get('p2:garchomp');
      expect(solved?.evs).toEqual(full.evs);
      expect(solved?.nature).toBe('Hardy');
    });

    test('a knock-out both bodies reach keeps the round-40 body (the prior nature breaks the tie)', () => {
      const observations = [
        { ...hit(garchomp, clefable, 'Earthquake', true), observedFraction: maxRoll(shaved) - 0.05 },
        hit(clefable, full, 'Moonblast'),
      ];
      const solved = inferSpreads(observations, sets, 'gen9ou', [beforeClefable], new Map(), maxHp420).get('p2:garchomp');
      expect(solved?.evs).toEqual(shaved.evs);
      expect(solved?.nature).toBe('Jolly');
    });
  });
});

const set = (species: string, spread: PokemonEvs, level = 100, moves = ['Protect']): PokemonSet => ({
  name: species, species, item: '', ability: '', moves, nature: 'Hardy', evs: spread,
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level, gender: '',
});

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

describe('spread-tempo-kept', () => {
  const WORLDS = [
    { name: 'gen9ou', formatid: 'gen9ou', gen: calcGenerationFor(9), level: 100, max: 252, low: 4 },
    { name: 'gen9doublesou', formatid: 'gen9doublesou', gen: calcGenerationFor(9), level: 100, max: 252, low: 4 },
    { name: 'Champions singles', formatid: 'gen9championsou', gen: calcGenerationFor(0), level: 50, max: 32, low: 2 },
    { name: 'Champions doubles', formatid: 'gen9championsvgc2026regma', gen: calcGenerationFor(0), level: 50, max: 32, low: 2 },
  ];
  type World = (typeof WORLDS)[number];
  type Mon = { species: string; side: 'p1' | 'p2'; nature: string; evs: PokemonEvs };

  const evs = (spread: Partial<PokemonEvs>): PokemonEvs => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...spread });
  const asSet = (m: Mon, level: number, moves: string[]): PokemonSet => ({
    name: m.species, species: m.species, item: '', ability: '', moves, nature: m.nature, evs: m.evs,
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level, gender: '',
  });
  function hit(world: World, attacker: Mon, defender: Mon, moveName: string, rollIndex = 8): DamageObservation {
    const body = (m: Mon) => buildCalcPokemon(world.gen, m.species, { level: world.level, nature: m.nature, evs: m.evs });
    const result = calculate(world.gen, body(attacker), body(defender), new Move(world.gen, moveName));
    const rolls = (Array.isArray(result.damage) ? (result.damage as number[]).flat() : [Number(result.damage)]).map(Number);
    return {
      attackerSpecies: attacker.species, defenderSpecies: defender.species, attackerSide: attacker.side,
      moveId: toId(moveName), observedFraction: rolls[Math.min(rollIndex, rolls.length - 1)] / body(defender).maxHP(), lethal: false,
      attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '',
    };
  }
  const speedOf = (world: World, m: Mon) => buildCalcPokemon(world.gen, m.species, { level: world.level, nature: m.nature, evs: m.evs }).stats.spe;

  for (const world of WORLDS) {
    const { max, low } = world;
    const clefable: Mon = { species: 'Clefable', side: 'p1', nature: 'Bold', evs: evs({ hp: max, def: max }) };
    const toxapex: Mon = { species: 'Toxapex', side: 'p1', nature: 'Bold', evs: evs({ hp: max, def: max }) };
    const lucario: Mon = { species: 'Lucario', side: 'p1', nature: 'Jolly', evs: evs({ atk: max, spe: max }) };
    const prior: Mon = { species: 'Garchomp', side: 'p2', nature: 'Jolly', evs: evs({ atk: max, spe: max }) };
    const bulkyAttacker: Mon = { ...prior, evs: evs({ hp: max, atk: max, spe: low }) };
    const specialWall: Mon = { ...prior, nature: 'Calm', evs: evs({ hp: max, spd: max, spe: low }) };
    const sets = {
      p1: [asSet(clefable, world.level, ['Moonblast']), asSet(toxapex, world.level, ['Scald']), asSet(lucario, world.level, ['Close Combat'])],
      p2: [asSet(prior, world.level, ['Earthquake', 'Swords Dance'])],
    };
    const solve = (observations: DamageObservation[], orders: Parameters<typeof inferSpreads>[3] = []) =>
      inferSpreads(observations, sets, world.formatid, orders).get('p2:garchomp');

    describe(`an unmeasured Speed keeps the prior (${world.name})`, () => {
      test('lines that ask for HP beside the offense leave the Speed alone', () => {
        // Two clean Earthquakes (the top roll on Toxapex) and two Moonblasts from the bulky attacker: the fit wants
        // 252 HP and 252 Atk, and the budget holds them only if the Speed the prior carries goes. No order measured it.
        const observations = [
          hit(world, bulkyAttacker, clefable, 'Earthquake'), hit(world, bulkyAttacker, toxapex, 'Earthquake', 15),
          hit(world, clefable, bulkyAttacker, 'Moonblast'), hit(world, toxapex, bulkyAttacker, 'Scald'),
        ];
        const solved = solve(observations);
        expect(solved?.evs.spe ?? max).toBe(max);
        expect(solved?.nature ?? 'Jolly').toBe('Jolly');
      });

      test('lines that ask for special bulk leave the Speed alone', () => {
        const observations = [
          hit(world, clefable, specialWall, 'Moonblast'), hit(world, clefable, specialWall, 'Moonblast'),
          hit(world, toxapex, specialWall, 'Scald'), hit(world, toxapex, specialWall, 'Scald'),
        ];
        const solved = solve(observations);
        expect(solved?.evs.spe ?? max).toBe(max);
        expect(solved?.nature ?? 'Jolly').toBe('Jolly');
      });

      test('an order the prior breaks still measures the Speed', () => {
        // Garchomp moved after a Jolly Lucario (the scene: the prior outspeeds it). The order refutes the Speed and a
        // lower one repairs it, so the rule does not hold the prior here.
        expect(speedOf(world, prior)).toBeGreaterThan(speedOf(world, lucario));
        const observations = [hit(world, bulkyAttacker, clefable, 'Earthquake'), hit(world, clefable, bulkyAttacker, 'Moonblast')];
        const order = { firstSide: 'p1' as const, firstSpecies: 'Lucario', secondSide: 'p2' as const, secondSpecies: 'Garchomp', turn: 3 };
        // Lucario's spread and item are known, so the Speed the order refutes can only be Garchomp's.
        const known = new Map([['p1:lucario', { itemKnown: true, scarfRuledOut: true, spreadKnown: true, spreads: [] }]]);
        const solved = inferSpreads(observations, sets, world.formatid, [order], known).get('p2:garchomp');
        expect(solved?.evs.spe ?? max).toBeLessThan(max);
      });

      test('the solved body keeps the prior unless the lines move it: the fit error never rises above the prior\'s', () => {
        const observations = [
          hit(world, bulkyAttacker, clefable, 'Earthquake'), hit(world, bulkyAttacker, toxapex, 'Earthquake', 15),
          hit(world, clefable, bulkyAttacker, 'Moonblast'),
        ];
        const solved = solve(observations);
        const ctx = buildSolveContext(observations, sets, world.formatid, []);
        const total = (spread: { evs: PokemonEvs; nature: string }) =>
          observations.reduce((sum, obs) => sum + observationError(ctx, obs, 'p2:garchomp', spread), 0);
        expect(total(solved ?? prior)).toBeLessThanOrEqual(total(prior) + 1e-12);
      });
    });
  }
});
