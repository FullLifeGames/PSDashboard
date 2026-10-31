import { writeFileSync } from 'node:fs';
import { afterAll, describe, expect, test } from 'vitest';
import { loadSimMods } from '../src/forward/sim-mods';
import { strengthMix } from '../src/calc/fickle';
import type { DieReport, ForcedDie } from '../src/dice/types';
import { playClicks, type Mode, type Rules } from './dice-fixtures';
import {
  clicksAccepted, dexOfRules, dieOf, explained, forcedOn, missesOf, monOf, newTally, SWEEP_CASES, sweepBoard, sweepClicks, sweepMoves, type DexMove, type Tally,
} from './dice-sweep-support';

// Round 82 (forced dice), lane A3a: the stalling sweep and the power rows. Every move with the Dex's `stallingMove` is used
// twice in a row; the second use draws whether it succeeds, forced to succeed and to fail, held against the `|-fail|` line. The
// first use draws nothing: a forced die there is no draw. A move that fails before the draw (a move that works on the first
// turn only) reads no draw with the protocol's line. The power rows follow: a chance that changes a move's power, read from
// the Dex's handler as calc/fickle.ts does, forced to happen and not to, held against the handler's own `|-activate|` line and
// against the damage.
await loadSimMods('gen9championsou');

const FAST = 'Pikachu';
const why = (report: DieReport): string => report.reason ?? 'no reason';

const logPath = process.env.DICE_SWEEP_LOG;
const summaries: string[] = [];
afterAll(() => {
  if (logPath) writeFileSync(logPath, summaries.join('\n') + '\n', 'utf8');
});

const stalling = (move: DexMove): boolean => !!(move as unknown as { stallingMove?: boolean }).stallingMove;
const stallDie = (moveId: string, happens: boolean): ForcedDie => ({ name: { slot: 'p1a', moveId, kind: 'stalling', effectId: 'stall' }, result: { happens } });

const failedBy = (lines: string[], slot: string): boolean => lines.some(line => line.startsWith('|-fail|') && line.split('|')[2].startsWith(slot));

/** The problem with a report of a forced stalling die on the second use, or null when the report and the protocol agree. */
function problemOf(report: DieReport, happens: boolean, failed: boolean): string | null {
  switch (report.took) {
    case 'applied': return failed !== happens ? null : `applied but the protocol shows ${failed ? 'a fail' : 'no fail'}`;
    case 'blocked': return happens && failed && report.reason ? null : `blocked: ${why(report)} (failed ${failed})`;
    case 'no-chance': return (report.chance ?? 0) >= 1 && !happens && !failed && report.reason ? null : `no-chance: chance ${report.chance}, failed ${failed}, ${why(report)}`;
    case 'no-draw': return explained(report.reason) ? null : `no-draw: ${why(report)} (failed ${failed})`;
  }
}

function exercise(rules: Rules, mode: Mode, move: DexMove, tally: Tally): string[] {
  const board = sweepBoard(rules, move.id, mode, '1,2,3,4', false, FAST);
  const clicks = sweepClicks(mode, move.target);
  if (!clicksAccepted(board, clicks)) {
    tally.unexercised.push(move.id);
    return [];
  }
  const problems: string[] = [];
  // the first use draws nothing: the die is never drawn
  const first = forcedOn(board, clicks, [stallDie(move.id, true)]);
  tally.cases++;
  if (first.report.forced[0].took !== 'no-draw' || !explained(first.report.forced[0].reason)) problems.push(`first use: ${first.report.forced[0].took} ${why(first.report.forced[0])}`);
  else tally.noDraw++;
  playClicks(board, clicks);
  if (!clicksAccepted(board, clicks)) {
    tally.unexercised.push(move.id);
    return problems;
  }
  for (const happens of [true, false]) {
    const { report, battle, start } = forcedOn(board, clicks, [stallDie(move.id, happens)]);
    const forced = report.forced[0];
    tally.cases++;
    const problem = problemOf(forced, happens, failedBy(battle.log.slice(start), 'p1a'));
    if (problem) problems.push(`${happens ? 'yes' : 'no'}: ${problem}`);
    else tally[forced.took === 'applied' ? 'applied' : forced.took === 'blocked' ? 'blocked' : forced.took === 'no-chance' ? 'noChance' : 'noDraw']++;
  }
  return problems;
}

describe.each(SWEEP_CASES)('the stalling sweep: $name', ({ rules, mode, name }) => {
  const { moves } = sweepMoves(rules, stalling, false);
  const tally: Tally = newTally();

  test.each(moves.map(move => [move.id, move] as const))('%s', (_id, move) => {
    expect(exercise(rules, mode, move, tally), `${rules.name} ${mode} ${move.id}`).toEqual([]);
  });

  test('the sweep exercised the moves', () => {
    summaries.push(`${name}: ${moves.length} stalling moves ${JSON.stringify({ ...tally, bad: undefined, unexercised: tally.unexercised.join(',') })}`);
    expect(tally.unexercised.length, `clicks refused: ${tally.unexercised}`).toBeLessThan(moves.length * 0.1 + 1);
    if (moves.length > 0) expect(tally.applied).toBeGreaterThan(0);
  });
});

describe.each(SWEEP_CASES)('the power rows: $name', ({ rules, mode, name }) => {
  const dex = dexOfRules(rules);
  const { moves } = sweepMoves(rules, move => strengthMix(dex, move.name) !== null);

  test('a chance that changes a move\'s power: yes shows the handler line and the stronger hit, no shows neither', () => {
    summaries.push(`${name}: ${moves.length} moves with a power chance (${moves.map(move => move.id).join(',')})`);
    for (const move of moves) {
      const mix = strengthMix(dex, move.name)!;
      const board = sweepBoard(rules, move.id, mode, '1,2,3,4', false, FAST);
      const clicks = sweepClicks(mode, move.target);
      const accuracy: ForcedDie = { name: dieOf(move.id, 'p2a', 'accuracy'), result: { happens: true } };
      const die = (happens: boolean): ForcedDie => ({ name: { slot: 'p1a', moveId: move.id, kind: 'power', effectId: move.id }, result: { happens } });
      const yes = forcedOn(board, clicks, [accuracy, die(true)]);
      const no = forcedOn(board, clicks, [accuracy, die(false)]);
      if (missesOf(yes.battle, yes.start, 'p2a') > 0) continue;
      expect(yes.report.forced[1].took, why(yes.report.forced[1])).toBe('applied');
      expect(no.report.forced[1].took, why(no.report.forced[1])).toBe('applied');
      expect(yes.report.forced[1].chance).toBeCloseTo(mix.chance, 5);
      const lost = (battle: typeof yes.battle) => monOf(battle, 'p2a').maxhp - monOf(battle, 'p2a').hp;
      expect(lost(yes.battle) / lost(no.battle), move.id).toBeGreaterThan(mix.factor * 0.9);
      expect(lost(yes.battle) / lost(no.battle), move.id).toBeLessThan(mix.factor * 1.1);
    }
  });
});

describe('the power rows played', () => {
  test.each(SWEEP_CASES.filter(entry => entry.rules.generation === 9))('$name has a move with a power chance', ({ rules }) => {
    expect(sweepMoves(rules, move => strengthMix(dexOfRules(rules), move.name) !== null).moves.length).toBeGreaterThan(0);
  });
});
