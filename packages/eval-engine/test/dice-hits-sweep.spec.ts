import { writeFileSync } from 'node:fs';
import { afterAll, describe, expect, test } from 'vitest';
import { loadSimMods } from '../src/forward/sim-mods';
import type { DieReport, ForcedDie } from '../src/dice/types';
import { playClicks, type Mode, type Rules } from './dice-fixtures';
import {
  clicksAccepted, dexOfRules, dieOf, explained, forcedOn, isCharge, missesOf, newTally, outfitBoard, SWEEP_CASES, sweepBoard, sweepClicks, sweepMoves,
  type DexMove, type Tally,
} from './dice-sweep-support';

// Round 82 (forced dice), lane A3a: the hit count sweep. Every move that hits more than once, singles and doubles. A move with
// a range of hits (Fury Attack, Double Slap, Triple Kick in Gen 2) takes every count of its range forced, the accuracy forced
// to hit, and the report is held against the protocol's `|-hitcount|` line. A move with a fixed count (Double Kick) and Skill
// Link draw no count: the report says no-draw with the fixed number. A move whose every hit rolls its own accuracy (Triple
// Axel, Population Bomb) takes the accuracy die for every hit: yes gives every hit, no a miss before the first. Loaded Dice
// makes a count of two or three unreachable (no-chance) and a count from four reachable, by a second draw the learner finds.
await loadSimMods('gen9championsou');

const FAST = 'Pikachu';
const multihitOf = (move: DexMove): number | number[] | undefined => (move as unknown as { multihit?: number | number[] }).multihit;
const hitsRange = (move: DexMove): [number, number] | null => {
  const hits = multihitOf(move);
  return Array.isArray(hits) ? [hits[0], hits[1]] : null;
};
const multiAccuracy = (move: DexMove): boolean => !!(move as unknown as { multiaccuracy?: boolean }).multiaccuracy;
const why = (report: DieReport): string => report.reason ?? 'no reason';

const logPath = process.env.DICE_SWEEP_LOG;
const summaries: string[] = [];
afterAll(() => {
  if (logPath) writeFileSync(logPath, summaries.join('\n') + '\n', 'utf8');
});

const hit = (move: string, slot = 'p2a'): ForcedDie => ({ name: dieOf(move, slot, 'accuracy'), result: { happens: true } });
const countDie = (move: string, hits: number): ForcedDie => ({ name: { slot: 'p1a', moveId: move, kind: 'hit-count' }, result: { hits } });

/** The numbers of the `|-hitcount|` lines of the forced turn. */
const hitcounts = (lines: string[]): number[] => lines.filter(line => line.startsWith('|-hitcount|')).map(line => Number(line.split('|')[3]));
const countsOf = (battle: Parameters<typeof missesOf>[0], start: number): number[] => hitcounts(battle.log.slice(start));

/** The first click the move needs: a charge move plays its first turn plain. */
function readyBoard(rules: Rules, mode: Mode, move: DexMove, species = FAST) {
  const board = sweepBoard(rules, move.id, mode, '1,2,3,4', false, species);
  let clicks = sweepClicks(mode, move.target);
  if (isCharge(move)) {
    playClicks(board, clicks);
    clicks = sweepClicks(mode, move.target, true);
  }
  return { board, clicks };
}

function conclude(name: string, moves: DexMove[], tally: Tally): void {
  summaries.push(`${name}: ${moves.length} moves ${JSON.stringify({ ...tally, bad: undefined, unexercised: tally.unexercised.join(',') })}`);
  expect(tally.unexercised.length, `clicks refused: ${tally.unexercised}`).toBeLessThan(moves.length * 0.05 + 1);
  expect(tally.applied).toBeGreaterThan(0);
}

describe.each(SWEEP_CASES)('the hit count sweep: $name', ({ rules, mode, name }) => {
  const { moves } = sweepMoves(rules, move => multihitOf(move) !== undefined && move.category !== 'Status');
  const tally: Tally = newTally();

  test('a move with a range of hits takes every count of its range: the report and the |-hitcount| line agree', () => {
    for (const move of moves.filter(candidate => hitsRange(candidate) && !multiAccuracy(candidate))) {
      const [low, high] = hitsRange(move)!;
      const { board, clicks } = readyBoard(rules, mode, move);
      if (!clicksAccepted(board, clicks)) {
        tally.unexercised.push(move.id);
        continue;
      }
      for (let hits = low; hits <= high; hits++) {
        const { report, battle, start } = forcedOn(board, clicks, [hit(move.id), countDie(move.id, hits)]);
        const forced = report.forced[1];
        tally.cases++;
        expect(forced.took, `${move.id} ${hits}: ${why(forced)}`).toBe('applied');
        expect(countsOf(battle, start), `${move.id} ${hits}`).toEqual([hits]);
        tally.applied++;
      }
      // a count outside the range cannot be given
      const { report } = forcedOn(board, clicks, [hit(move.id), countDie(move.id, high + 1)]);
      expect(report.forced[1].took, `${move.id} ${high + 1}`).toBe('no-chance');
      tally.cases++;
      tally.noChance++;
    }
    expect(moves.some(candidate => hitsRange(candidate)) ? tally.applied : 1).toBeGreaterThan(0);
  });

  test('a move with a fixed count draws none: no draw, with the number', () => {
    let played = 0;
    for (const move of moves.filter(candidate => typeof multihitOf(candidate) === 'number' && !multiAccuracy(candidate))) {
      const { board, clicks } = readyBoard(rules, mode, move);
      if (!clicksAccepted(board, clicks)) continue;
      const { report, battle, start } = forcedOn(board, clicks, [hit(move.id), countDie(move.id, 3)]);
      if (missesOf(battle, start, 'p2a') > 0 || countsOf(battle, start).length === 0) continue;
      expect(report.forced[1].took, `${move.id}: ${why(report.forced[1])}`).toBe('no-draw');
      expect(explained(report.forced[1].reason), `${move.id}: ${why(report.forced[1])}`).toBe(true);
      played++;
      tally.noDraw++;
      tally.cases++;
    }
    expect(played > 0 || !moves.some(candidate => typeof multihitOf(candidate) === 'number')).toBe(true);
  });

  test('a move whose every hit rolls its accuracy: yes gives every hit, no a miss before the first', () => {
    let played = 0;
    for (const move of moves.filter(multiAccuracy)) {
      const { board, clicks } = readyBoard(rules, mode, move);
      if (!clicksAccepted(board, clicks)) continue;
      const all = typeof multihitOf(move) === 'number' ? multihitOf(move) as number : 0;
      const yes = forcedOn(board, clicks, [{ name: dieOf(move.id, 'p2a', 'accuracy'), result: { happens: true } }]);
      expect(countsOf(yes.battle, yes.start), `${move.id} yes`).toEqual([all]);
      expect(yes.report.forced[0].took, `${move.id} yes: ${why(yes.report.forced[0])}`).toBe('applied');
      const no = forcedOn(board, clicks, [{ name: dieOf(move.id, 'p2a', 'accuracy'), result: { happens: false } }]);
      expect(countsOf(no.battle, no.start), `${move.id} no`).toEqual([]);
      expect(missesOf(no.battle, no.start, 'p2a'), `${move.id} no`).toBeGreaterThan(0);
      expect(no.report.forced[0].took, `${move.id} no: ${why(no.report.forced[0])}`).toBe('applied');
      played++;
      tally.cases += 2;
      tally.applied += 2;
    }
    expect(played > 0 || !moves.some(multiAccuracy)).toBe(true);
  });

  test('the sweep exercised the moves', () => conclude(name, moves, tally));
});

/** Whether the rule set has the ability or item (the Dex of the game decides). */
const has = (rules: Rules, kind: 'items' | 'abilities', id: string): boolean => {
  const dex = dexOfRules(rules);
  const entry = dex[kind].get(id);
  return entry.exists && entry.gen <= dex.gen && !entry.isNonstandard;
};

const played = new Map<string, number>();
const play = (row: string): void => void played.set(row, (played.get(row) ?? 0) + 1);

describe.each(SWEEP_CASES)('the hit count rules: $name', ({ rules, mode }) => {
  /** A forced turn of one move on an outfitted board. */
  function turn(move: string, outfit: { item?: string; ability?: string }, forced: ForcedDie[]) {
    const board = outfitBoard(rules, mode, { species: FAST, moves: [move], ...outfit }, { species: 'Vaporeon' });
    return forcedOn(board, sweepClicks(mode, 'normal'), forced);
  }

  test('Skill Link fixes the count: no draw, with the number', () => {
    if (!has(rules, 'abilities', 'skilllink')) return;
    play('skilllink');
    const { report, battle, start } = turn('furyattack', { ability: 'Skill Link' }, [hit('furyattack'), countDie('furyattack', 3)]);
    if (missesOf(battle, start, 'p2a') > 0) return;
    expect(report.forced[1].took, why(report.forced[1])).toBe('no-draw');
    expect(report.forced[1].reason).toMatch(/fixed hit count \(5\)/);
    expect(countsOf(battle, start)).toEqual([5]);
  });

  test('Loaded Dice: a count of four or five is reached, a count of two or three is no chance', () => {
    if (!has(rules, 'items', 'loadeddice')) return;
    play('loadeddice');
    for (const hits of [2, 3, 4, 5]) {
      const { report, battle, start } = turn('furyattack', { item: 'Loaded Dice' }, [hit('furyattack'), countDie('furyattack', hits)]);
      if (missesOf(battle, start, 'p2a') > 0) continue;
      const forced = report.forced[1];
      if (hits >= 4) {
        expect(forced.took, `${hits}: ${why(forced)}`).toBe('applied');
        expect(countsOf(battle, start), `${hits}`).toEqual([hits]);
      } else {
        expect(forced.took, `${hits}: ${why(forced)}`).toBe('no-chance');
      }
    }
  });

  test('Loaded Dice on a move with a fixed top count: every count from four to the top is reached', () => {
    if (!has(rules, 'items', 'loadeddice') || !dexOfRules(rules).moves.get('populationbomb').exists) return;
    play('populationbomb');
    for (let hits = 4; hits <= 10; hits++) {
      const accuracy: ForcedDie = { name: dieOf('populationbomb', 'p2a', 'accuracy'), result: { happens: true } };
      const { report, battle, start } = turn('populationbomb', { item: 'Loaded Dice' }, [accuracy, countDie('populationbomb', hits)]);
      expect(report.forced[1].took, `${hits}: ${why(report.forced[1])}`).toBe('applied');
      expect(countsOf(battle, start), `${hits}`).toEqual([hits]);
    }
  });
});

describe('the hit count rule rows played', () => {
  test.each(['skilllink', 'loadeddice', 'populationbomb'])('%s', row => {
    expect(played.get(row) ?? 0, row).toBeGreaterThan(0);
  });
});
