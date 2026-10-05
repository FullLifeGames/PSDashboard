import { describe, expect, test } from 'vitest';
import { Generations, Pokemon } from '@smogon/calc';
import type { PokemonSet } from '@pkmn/sim';
import { parseReplayLogWithObservations } from '../src/protocol-parser';
import { inferSpreads } from '../src/spread-inference';
import type { SpeedKnowledge } from '../src/spreads/scarf';
import type { SpeedOrderObservation } from '../src/types';

/**
 * Round 63 (T117): what the solver reads from a move order. A race ran with
 * the Choice Scarf the mover held that turn, and a Scarf that came or went
 * by Trick, Switcheroo or Knock Off is read at the races around it instead
 * of voiding them (the build keeps the set's original item, so a race won
 * with a tricked Scarf is no claim on the set's Speed alone).
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
