import { describe, expect, test } from 'vitest';
import { advancePositionWithLog } from '../src/forward-model';
import { createMatchupCache } from '../src/eval-function';
import { drawPair } from '../src/pair/draw';
import type { AccuracyRecord, RollRecord } from '../src/pair/prng';
import { anchorRoot, doublesRoot, pairSet, PLAYED, QUIET, SPREAD } from './pair-battles';

/** Protocol lines without the wall-clock `|t:|` stamps two draws may straddle (as adopt-runtime.spec.ts). */
const withoutTimestamps = (log: string[]) => log.filter(line => !line.startsWith('|t:|'));

const rolls = (records: readonly { kind: string }[]) =>
  records.filter((record): record is RollRecord => record.kind === 'roll').map(record => record.key);

describe('the recording dice (round 56)', () => {
  test('without scripts a draw is the plain advance: same log, same child', () => {
    const root = anchorRoot();
    const cache = createMatchupCache();
    for (const [p1, p2] of [PLAYED, SPREAD, QUIET]) {
      for (const seed of ['1,2,3,4', '5,6,7,8'] as const) {
        const plain = advancePositionWithLog(root, p1, p2, seed);
        const drawn = drawPair(root, p1, p2, seed, new Map(), cache);
        expect(withoutTimestamps(drawn.log)).toEqual(withoutTimestamps(plain.log));
        expect(drawn.child.serialized).toBe(plain.child.serialized);
      }
    }
  });

  test('the played cell writes down the Play Rough miss with its threshold and both bodies', () => {
    const drawn = drawPair(anchorRoot(), ...PLAYED, '1,2,3,4', new Map(), createMatchupCache());
    const miss = drawn.records.find(record => record.kind === 'accuracy' && record.key === 'p1b:playrough>p2b') as AccuracyRecord;
    expect(miss).toMatchObject({ numerator: 90, hit: false });
    expect(miss.snapshot?.attacker.species).toBe('Mawile-Mega');
    expect(miss.snapshot?.defender.species).toBe('Incineroar');
    expect(drawn.log).toContain('|-miss|p1b: Mawile|p2b: Incineroar');
  });

  test('a script answers one target of a spread move and leaves the other to the seed', () => {
    const root = anchorRoot();
    const cache = createMatchupCache();
    const natural = drawPair(root, ...SPREAD, '1,2,3,4', new Map(), cache);
    expect(rolls(natural.records)).toEqual(['p2a:matchagotcha>p1a', 'p2a:matchagotcha>p1b']);
    const scripted = drawPair(root, ...SPREAD, '1,2,3,4', new Map([['p2a:matchagotcha>p1a', { hit: false }]]), cache);
    expect(scripted.log).toContain('|-miss|p2a: Sinistcha|p1a: Sinistcha');
    expect(rolls(scripted.records)).toEqual(['p2a:matchagotcha>p1b']);
  });

  test('an answered roll still consumes its draw: repeating the seed\'s own answer changes nothing', () => {
    const root = anchorRoot();
    const cache = createMatchupCache();
    const natural = drawPair(root, ...PLAYED, '1,2,3,4', new Map(), cache);
    const repeated = drawPair(root, ...PLAYED, '1,2,3,4', new Map([['p1b:playrough>p2b', { hit: false }]]), cache);
    expect(withoutTimestamps(repeated.log)).toEqual(withoutTimestamps(natural.log));
    expect(repeated.child.serialized).toBe(natural.child.serialized);
  });

  test('a scripted roll sets the damage: the top roll hits harder than the bottom one', () => {
    const root = anchorRoot();
    const cache = createMatchupCache();
    const hpAfter = (roll: number) => {
      const drawn = drawPair(root, ...SPREAD, '1,2,3,4', new Map([['p2a:matchagotcha>p1b', { hit: true, crit: false, roll }]]), cache);
      const line = drawn.log.find(entry => /^\|-damage\|p1b: Mawile\|\d+\/125$/.test(entry))!;
      return Number(line.split('|')[3].split('/')[0]);
    };
    expect(hpAfter(0)).toBeLessThan(hpAfter(15));
  });

  test('the roll record carries the drawn roll, the crit flag and the defender\'s live HP at the hit', () => {
    const drawn = drawPair(anchorRoot(), ...SPREAD, '1,2,3,4', new Map(), createMatchupCache());
    const mawile = drawn.records.find((record): record is RollRecord => record.kind === 'roll' && record.key === 'p2a:matchagotcha>p1b')!;
    expect(mawile.roll).toBeGreaterThanOrEqual(0);
    expect(mawile.roll).toBeLessThanOrEqual(15);
    expect(typeof mawile.crit).toBe('boolean');
    // Mawile stands at 84/125 on the root; Life Dew heals a quarter (31) before Matcha Gotcha lands.
    expect(mawile.snapshot.defender.hp).toBe(115);
    expect(mawile.snapshot.spreadHit).toBe(true);
    // The roll falls inside its move's window: the last |move| line before it is p2a's Matcha Gotcha
    // (the first target's |-resisted| line already stands between them).
    const moveLine = drawn.log.slice(0, mawile.logIndex).reverse().find(line => line.startsWith('|move|'));
    expect(moveLine).toMatch(/^\|move\|p2a: Sinistcha\|Matcha Gotcha\|/);
  });

  test('a speed tie among move actions is written down', () => {
    const pika = (name: string) => pairSet(name, 'Pikachu', ['Thunderbolt', 'Protect'], {
      nature: 'Timid', evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 },
    });
    const blissey = (name: string) => pairSet(name, 'Blissey', ['Soft-Boiled', 'Protect']);
    const root = doublesRoot([pika('A'), blissey('B')], [pika('C'), blissey('D')]);
    const drawn = drawPair(root, 'move thunderbolt 1, move softboiled', 'move thunderbolt 1, move softboiled', '1,2,3,4', new Map(), createMatchupCache());
    expect(drawn.records.some(record => record.kind === 'tie')).toBe(true);
  });
});
