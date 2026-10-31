import { writeFileSync } from 'node:fs';
import { afterAll, describe, expect, test } from 'vitest';
import { loadSimMods } from '../src/forward/sim-mods';
import type { DieReport } from '../src/dice/types';
import { playClicks, type Mode, type Rules } from './dice-fixtures';
import {
  clicksAccepted, dieOf, explained, forcedOn, isCharge, missesOf, newTally, picksOne, SWEEP_CASES, sweepBoard, sweepClicks, sweepMoves, sweepTargets,
  VGC_RULES, type DexMove, type Tally,
} from './dice-sweep-support';

// Round 82 (forced dice), lane A2b: the accuracy sweep. Every move of every rule set with a numeric accuracy, singles and
// doubles (a spread move: every target on its own), forced to hit and forced to miss, and the report held against the
// protocol's own lines. A hit has no `|-miss|` for the target and an effect line; a miss has one. A draw that cannot give
// the answer (a 100 percent move forced to miss) says `no-chance` and the hit shows; a die the simulator never drew says so
// with the protocol line that explains it. A move the simulator drew an accuracy for but the module did not name fails the
// sweep: its report would read `no-draw` with the generic sentence, or `no-chance` with no chance behind it. The rows with
// no chance (a move that cannot miss) and a VGC row (a team of six, Scarlet/Violet and Champions) close it.
await loadSimMods('gen9championsou');

/** The problem with a report, or null when the report and the protocol agree. */
function problemOf(report: DieReport, happens: boolean, misses: number, move: DexMove, rules: Rules): string | null {
  switch (report.took) {
    case 'applied': return (happens ? misses === 0 : misses >= 1) ? null : `applied but the protocol shows ${misses} misses`;
    case 'blocked': return happens && misses === 0 && report.reason ? null : `blocked: ${why(report)} (${misses} misses)`;
    case 'no-chance': {
      // a sure draw (chance of one), a move that cannot miss (no draw), or Gen 2's 100 percent moves, which draw nothing
      const sure = (report.chance ?? 0) >= 1 || move.accuracy === true || (rules.generation === 2 && move.accuracy === 100);
      return misses === 0 && sure && !!report.reason ? null : `no-chance: chance ${report.chance}, ${misses} misses, ${why(report)}`;
    }
    case 'no-draw': return misses === 0 && explained(report.reason) ? null : `no-draw: ${why(report)} (${misses} misses)`;
  }
}

/** The reason of a report, or the word that it has none (a report that must have one fails with this). */
const why = (report: DieReport): string => report.reason ?? 'no reason';

const logPath = process.env.DICE_SWEEP_LOG;
const summaries: string[] = [];
afterAll(() => {
  if (logPath) writeFileSync(logPath, summaries.join('\n') + '\n', 'utf8');
});

/** Forces the accuracy of one move to hit and to miss on every slot it can draw for; the problems found, with the tally filled. */
function exercise(rules: Rules, mode: Mode, move: DexMove, tally: Tally, vgc = false): string[] {
  const board = sweepBoard(rules, move.id, mode, '1,2,3,4', vgc);
  let clicks = sweepClicks(mode, move.target);
  if (isCharge(move)) {
    playClicks(board, clicks);
    clicks = sweepClicks(mode, move.target, true);
  }
  if (!clicksAccepted(board, clicks)) {
    tally.unexercised.push(move.id);
    return [];
  }
  const problems: string[] = [];
  for (const happens of [true, false]) {
    const verdicts: { slot: string; report: DieReport; problem: string | null }[] = [];
    for (const slot of sweepTargets(mode, move.target)) {
      const { report, battle, start } = forcedOn(board, clicks, [{ name: dieOf(move.id, slot, 'accuracy'), result: { happens } }]);
      const shown = report.forced[0];
      tally.cases++;
      const misses = missesOf(battle, start, slot);
      // a future move draws two turns later: the turn it starts in holds no accuracy draw
      const problem = move.flags.futuremove
        ? (shown.took === 'no-draw' && misses === 0 && /two turns later/.test(shown.reason ?? '') ? null : `future move: ${shown.took}, ${misses} misses`)
        : problemOf(shown, happens, misses, move, rules);
      verdicts.push({ slot, report: shown, problem });
    }
    // a move that picks one target draws for that one only: the others are no draw
    const settled = picksOne(move.target) && verdicts.some(verdict => verdict.report.took !== 'no-draw' && !verdict.problem);
    for (const verdict of verdicts) {
      if (settled && verdict.report.took === 'no-draw') continue;
      if (verdict.problem) problems.push(`${happens ? 'yes' : 'no'} ${verdict.slot}: ${verdict.problem}`);
      else tally[verdict.report.took === 'no-chance' ? 'noChance' : verdict.report.took === 'applied' ? 'applied' : verdict.report.took === 'blocked' ? 'blocked' : 'noDraw']++;
    }
  }
  return problems;
}

function conclude(name: string, moves: DexMove[], skipped: number, tally: Tally): void {
  summaries.push(`${name}: ${moves.length} moves (${skipped} skipped: no foe as target) ${JSON.stringify({ ...tally, bad: undefined, unexercised: tally.unexercised.join(',') })}`);
  expect(tally.unexercised.length, `clicks refused: ${tally.unexercised}`).toBeLessThan(moves.length * 0.02);
  expect(tally.cases).toBeGreaterThan(moves.length);
  // most moves in a plain scene draw their accuracy (or cannot miss: a no-draw with that reason, each held by its case) and show the answer
  expect(tally.applied + tally.blocked + tally.noChance + tally.noDraw).toBeGreaterThan(tally.cases * 0.8);
  expect(tally.applied).toBeGreaterThan(tally.cases * 0.3);
}

describe.each(SWEEP_CASES)('the accuracy sweep: $name', ({ rules, mode, name }) => {
  const { moves, skipped } = sweepMoves(rules, move => typeof move.accuracy === 'number');
  const tally: Tally = newTally();

  test.each(moves.map(move => [move.id, move] as const))('%s', (_id, move) => {
    expect(exercise(rules, mode, move, tally), `${rules.name} ${mode} ${move.id}`).toEqual([]);
  });

  test('the sweep exercised the moves', () => conclude(name, moves, skipped, tally));
});

describe.each(SWEEP_CASES)('the accuracy rows with no chance: $name', ({ rules, mode, name }) => {
  const { moves } = sweepMoves(rules, move => move.accuracy === true && move.category !== 'Status');

  test('a damaging move that cannot miss draws no accuracy: both answers are no draw and the hit shows', () => {
    let noChance = 0;
    for (const move of moves) {
      const board = sweepBoard(rules, move.id, mode);
      let clicks = sweepClicks(mode, move.target);
      if (isCharge(move)) {
        playClicks(board, clicks);
        clicks = sweepClicks(mode, move.target, true);
      }
      if (!clicksAccepted(board, clicks)) continue;
      for (const happens of [true, false]) {
        const shown = sweepTargets(mode, move.target).map(slot => {
          const { report, battle, start } = forcedOn(board, clicks, [{ name: dieOf(move.id, slot, 'accuracy'), result: { happens } }]);
          expect(missesOf(battle, start, slot), `${move.id} ${slot} ${happens}`).toBe(0);
          return report.forced[0];
        });
        const sure = (report: DieReport): boolean => report.took === 'no-draw' && explained(report.reason);
        // a move that picks one target draws for that one only
        const fine = picksOne(move.target) ? shown.some(sure) : shown.every(sure);
        expect(fine, `${move.id} ${happens}: ${shown.map(report => `${report.took} ${report.reason}`).join(' | ')}`).toBe(true);
        noChance += shown.filter(sure).length;
      }
    }
    expect(noChance, `${name} ${moves.length} moves`).toBeGreaterThan(moves.length * 0.5);
  });
});

describe.each(VGC_RULES.map(rules => ({ rules, name: `${rules.name} VGC` })))('the accuracy sweep, a team of six: $name', ({ rules, name }) => {
  // every tenth move keeps the row short; the dice behave as in doubles, the row exists because VGC counts on its own
  const { moves, skipped } = sweepMoves(rules, move => typeof move.accuracy === 'number');
  const some = moves.filter((_, index) => index % 10 === 0);
  const tally: Tally = newTally();

  test('the bench is there: a team of six on each side with four behind the leads', () => {
    const board = sweepBoard(rules, 'tackle', 'doubles', '1,2,3,4', true);
    expect(board.sides.map(side => side.pokemon.length)).toEqual([6, 6]);
  });

  test.each(some.map(move => [move.id, move] as const))('%s', (_id, move) => {
    expect(exercise(rules, 'doubles', move, tally, true), `${name} ${move.id}`).toEqual([]);
  });

  test('the sweep exercised the moves', () => conclude(name, some, skipped, tally));
});
