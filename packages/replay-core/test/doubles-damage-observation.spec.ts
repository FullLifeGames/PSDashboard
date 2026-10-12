import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseReplayLogWithObservations } from '../src/protocol-parser';
import type { DamageObservation } from '../src/types';

/**
 * Round 69 (T31, spec decision 6): the parser records the damage observations of doubles too, one per target of the move.
 * An observation says which game type it came from, whether the move line named `[spread]` (the simulator's 0.75 cut) and the side
 * of its defender (a spread move hits the attacker's partner as well). Singles logs keep their observations; the two stored
 * singles logs were parsed by the unchanged parser of 006b33c and their observations are compared field for field.
 */

const header = (gametype: string, tier: string) => [
  '|player|p1|Alice|', '|player|p2|Bob|', `|gametype|${gametype}`, '|gen|9', `|tier|${tier}`, '|start',
  '|switch|p1a: Lax|Snorlax, M|100/100',
  '|switch|p1b: Zippy|Blissey, F|100/100',
  '|switch|p2a: Chomp|Garchomp, F|100/100',
  '|switch|p2b: Gyro|Gyarados, M|100/100',
  '|turn|1',
];
const DOUBLES = header('doubles', '[Gen 9] Doubles OU');
const observe = (...lines: string[]): DamageObservation[] =>
  parseReplayLogWithObservations([...DOUBLES, ...lines, '|turn|2'].join('\n')).observations;

describe('doubles damage observations (T31)', () => {
  test('doubles log, single-target move: one observation', () => {
    const observations = observe('|move|p1a: Lax|Tackle|p2a: Chomp', '|-damage|p2a: Chomp|76/100');
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      attackerSpecies: 'Snorlax', defenderSpecies: 'Garchomp', attackerSide: 'p1', moveId: 'tackle',
      doubles: true, spread: false, defenderSide: 'p2',
    });
    expect(observations[0].observedFraction).toBeCloseTo(0.24, 5);
  });

  test('a spread move with two targets: one observation per target, spread true', () => {
    const observations = observe(
      '|move|p1a: Lax|Rock Slide|p2a: Chomp|[spread] p2a,p2b',
      '|-damage|p2a: Chomp|70/100', '|-damage|p2b: Gyro|60/100',
    );
    expect(observations.map(obs => obs.defenderSpecies)).toEqual(['Garchomp', 'Gyarados']);
    for (const obs of observations) expect(obs).toMatchObject({ doubles: true, spread: true, defenderSide: 'p2' });
  });

  test('a spread move that only one target takes still reads spread: the simulator cut the damage', () => {
    // Gyarados protected: the simulator keeps spreadHit (two targets at the start) and names the one slot that was hit.
    const observations = observe('|move|p1a: Lax|Rock Slide|p2a: Chomp|[spread] p2a', '|-damage|p2a: Chomp|70/100');
    expect(observations).toHaveLength(1);
    expect(observations[0].spread).toBe(true);
  });

  test('a hit on the partner counts, on the attacker\'s own side', () => {
    const observations = observe(
      '|move|p1a: Lax|Earthquake|p2a: Chomp|[spread] p1b,p2a,p2b',
      '|-damage|p1b: Zippy|80/100', '|-damage|p2a: Chomp|50/100', '|-damage|p2b: Gyro|40/100',
    );
    expect(observations.map(obs => [obs.defenderSpecies, obs.defenderSide])).toEqual([
      ['Blissey', 'p1'], ['Garchomp', 'p2'], ['Gyarados', 'p2'],
    ]);
    for (const obs of observations) expect(obs.attackerSide).toBe('p1');
  });

  test('a spread move with an immune target keeps the damage of the others', () => {
    const observations = observe(
      '|move|p1a: Lax|Earthquake|p2a: Chomp|[spread] p1b,p2a',
      '|-immune|p2b: Gyro', '|-damage|p1b: Zippy|80/100', '|-damage|p2a: Chomp|50/100',
    );
    expect(observations.map(obs => obs.defenderSpecies)).toEqual(['Blissey', 'Garchomp']);
  });

  test('a spread move still ends at the other boundaries: a Substitute breaking or a switch makes later damage lines nobody\'s', () => {
    const lines = ['|move|p1a: Lax|Rock Slide|p2a: Chomp|[spread] p2a,p2b', '|-damage|p2a: Chomp|70/100'];
    expect(observe(...lines, '|-end|p2b: Gyro|Substitute', '|-damage|p2b: Gyro|60/100').map(obs => obs.defenderSpecies)).toEqual(['Garchomp']);
    expect(observe(...lines, '|switch|p2b: Gyro|Gyarados, M|100/100', '|-damage|p2b: Gyro|60/100').map(obs => obs.defenderSpecies)).toEqual(['Garchomp']);
  });

  test('a single-target move that a target is immune to ends the move as before', () => {
    // The -immune line ends a single-target action: a confusion self-hit that follows belongs to nobody.
    expect(observe('|move|p1a: Lax|Earthquake|p2b: Gyro', '|-immune|p2b: Gyro', '|-damage|p2b: Gyro|90/100')).toEqual([]);
  });

  test('a crit on one target of a spread move drops that target only', () => {
    const observations = observe(
      '|move|p1a: Lax|Rock Slide|p2a: Chomp|[spread] p2a,p2b',
      '|-crit|p2a: Chomp', '|-damage|p2a: Chomp|40/100', '|-damage|p2b: Gyro|60/100',
    );
    expect(observations.map(obs => obs.defenderSpecies)).toEqual(['Gyarados']);
  });

  test('a second damage line on one target drops that target\'s observation only', () => {
    // Dragon Darts hit one target twice: no reading. Synthetic mix: the other target keeps its single hit, whichever line came first.
    expect(observe('|move|p1a: Lax|Dragon Darts|p2a: Chomp', '|-damage|p2a: Chomp|80/100', '|-damage|p2a: Chomp|60/100')).toEqual([]);
    const split = observe('|move|p1a: Lax|Dragon Darts|p2a: Chomp', '|-damage|p2a: Chomp|80/100', '|-damage|p2b: Gyro|70/100');
    expect(split.map(obs => obs.defenderSpecies)).toEqual(['Garchomp', 'Gyarados']);
    const mixed = observe(
      '|move|p1a: Lax|Dragon Darts|p2a: Chomp', '|-damage|p2a: Chomp|80/100', '|-damage|p2b: Gyro|70/100', '|-damage|p2a: Chomp|60/100',
    );
    expect(mixed.map(obs => obs.defenderSpecies)).toEqual(['Gyarados']);
  });

  test('a hit boosted by Helping Hand is an observation that names the Helping Hand (T86 prices it)', () => {
    const helped = observe(
      '|move|p1b: Zippy|Helping Hand|p1a: Lax', '|-singleturn|p1a: Lax|Helping Hand|[of] p1b: Zippy',
      '|move|p1a: Lax|Tackle|p2a: Chomp', '|-damage|p2a: Chomp|70/100',
    );
    expect(helped).toHaveLength(1);
    expect(helped[0].fieldFacts).toEqual(['helpinghand']);
  });

  test('the game type comes from the gametype line, not from the format name', () => {
    const lines = ['|move|p1a: Lax|Tackle|p2a: Chomp', '|-damage|p2a: Chomp|76/100', '|turn|2'];
    const read = (tier: string, gametype: string) =>
      parseReplayLogWithObservations([...header(gametype, tier), ...lines].join('\n')).observations;
    for (const tier of ['[Gen 9] VGC 2026 Reg F', '[Gen 9 Champions] VGC 2026 Reg M-B', '[Gen 9 Champions] Doubles Custom Game']) {
      expect(read(tier, 'doubles')).toHaveLength(1);
      expect(read(tier, 'doubles')[0]).toMatchObject({ doubles: true, spread: false, defenderSide: 'p2' });
    }
    // A singles game under a doubles-sounding name is still singles.
    expect(read('[Gen 9] Doubles OU', 'singles')[0]).toMatchObject({ doubles: false, spread: false, defenderSide: 'p2' });
  });
});

describe('singles logs give the observations they gave before (T31)', () => {
  const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf-8');
  // T31 added the first three fields, T191 the four item fields, T167 the two paradox readings (the logs hold a Protosynthesis
  // mon), T86 the move name, terrain, HP, Tera, ability and field-fact fields; all are stripped before the comparison with 006b33c.
  const NEW_FIELDS = [
    'doubles', 'spread', 'defenderSide', 'attackerItem', 'defenderItem', 'attackerItemChanged', 'defenderItemChanged',
    'attackerParadox', 'defenderParadox', 'moveName', 'terrain', 'attackerHp', 'defenderHp', 'attackerAbility', 'defenderAbility',
    'attackerTera', 'defenderTera', 'attackerFallen', 'attackerSuppressed', 'defenderSuppressed', 'attackerAbilityOn', 'fieldFacts',
  ] as const;

  for (const name of ['singles-1', 'singles-2']) {
    test(`${name}: every field of 006b33c is unchanged, the new fields read singles`, () => {
      const observations = parseReplayLogWithObservations(fixture(`${name}.log`)).observations;
      const before = JSON.parse(fixture(`${name}.json`)) as DamageObservation[];
      expect(observations.length).toBeGreaterThan(10);
      const stripped = observations.map(obs => {
        const rest: Record<string, unknown> = { ...obs };
        for (const field of NEW_FIELDS) delete rest[field];
        return rest;
      });
      expect(stripped).toEqual(before);
      for (const obs of observations) {
        expect(obs.doubles).toBe(false);
        expect(obs.spread).toBe(false);
        expect(obs.defenderSide).toBe(obs.attackerSide === 'p1' ? 'p2' : 'p1');
      }
    });
  }
});
