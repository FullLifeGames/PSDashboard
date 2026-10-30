import { describe, expect, test } from 'vitest';
import type { SideAnalysis, TurnAnalysis } from '../src/analysis';
import { buildGameReport } from '../src/report';
import type { KoOddsInfo, RankedChoice } from '../src/types';

/**
 * Round 79 (T284): the report names the game's biggest roll against the eventual winner. 573756 turn 73: the 95 % Fire Fang
 * missed, worth +13 % to SOULWIND, the largest roll of the game, but the report spoke of turn 71 and the chip printed the
 * net +5 %. The roll is the largest |chanceDelta| on a turn whose roll went in the chance's direction, toward the loser,
 * at least CHANCE_THRESHOLD (0.2). The move is named only when the winner's played move provably carried the roll: a sure
 * kill behind an accuracy under 1. Singles and doubles read the same turns; a doubles pair names no move.
 * User gate 30.10.2026 ("2a"): the sentence speaks only where the log names the event; a biggest roll whose move is not
 * proven says nothing, since "the game's biggest roll" with no event behind it told the reader nothing.
 */

const names: [string, string] = ['Alpha', 'Beta'];
const none = { p1: false, p2: false };
const forP1 = { p1: true, p2: false };
const forP2 = { p1: false, p2: true };

const choice = (label: string, koOdds?: KoOddsInfo): RankedChoice =>
  ({ choice: label, label, worstCase: 0, expected: 0, ev: 0, punishedBy: null, ...(koOdds ? { koOdds } : {}) });
const sideOf = (extra: Partial<SideAnalysis> = {}): SideAnalysis =>
  ({ playedRaw: null, played: null, best: null, safe: null, regret: 0, ...extra });
const mk = (turn: number, scoreBefore: number, scoreAfter: number | null, over: Partial<TurnAnalysis> = {}): TurnAnalysis => ({
  turn, scoreBefore, scoreAfter, swing: scoreAfter !== null ? scoreAfter - scoreBefore : null,
  playedOutcome: null, decisionDelta: null, chanceDelta: null, attribution: 'quiet',
  p1: sideOf(), p2: sideOf(), ...over,
});

/** Beta wins; every turn is rolled (rolledFor present); the scores favor Beta from turn 4 on. */
const game = (rollTurn: Partial<TurnAnalysis>, extra: TurnAnalysis[] = []): TurnAnalysis[] => [
  mk(1, -0.1, -0.1, { chanceDelta: 0, rolledFor: none }),
  mk(2, -0.1, -0.3, { chanceDelta: -0.05, rolledFor: none }),
  mk(3, -0.3, -0.62, { chanceDelta: 0.1, rolledFor: none, ...rollTurn }),
  mk(4, -0.62, -0.8, { rolledFor: none }),
  ...extra,
];
const fireFang = sideOf({ played: choice('Fire Fang', { accuracy: 0.95, killFraction: 1, attacker: { slot: 0, species: 'Garchomp' } }) });

describe('the game\'s biggest roll against the winner (T284)', () => {
  test('573756 shape: a missed sure kill is named with its accuracy and what it was worth', () => {
    const report = buildGameReport(game({ chanceDelta: 0.27, rolledFor: forP1, p2: fireFang }), names, 'p2', true, new Set([3]));
    expect(report.summary).toContain("The game's biggest roll came on turn 3: Fire Fang (95%) missed, worth +14% to Alpha.");
  });

  test('a roll whose move is not proven says nothing', () => {
    const report = buildGameReport(game({ chanceDelta: 0.27, rolledFor: forP1 }), names, 'p2', true, new Set([3]));
    expect(report.summary).not.toContain('biggest roll');
  });

  test('doubles: a pair of clicks names no move, so the report says nothing', () => {
    const pair = sideOf({ played: choice('Fire Fang→Rillaboom + Protect', { accuracy: 0.95, killFraction: 1, label: 'Fire Fang→Rillaboom' }) });
    const report = buildGameReport(game({ chanceDelta: 0.27, rolledFor: forP1, p2: pair }), names, 'p2', false, new Set([3]));
    expect(report.summary).not.toContain('biggest roll');
  });

  test('the largest roll wins among several', () => {
    const report = buildGameReport(game({ chanceDelta: 0.3, rolledFor: forP1, p2: fireFang }, [
      mk(5, -0.8, -1, { chanceDelta: 0.22, rolledFor: forP1, p2: fireFang }),
    ]), names, 'p2', true, new Set([3, 5]));
    expect(report.summary).toContain("biggest roll came on turn 3: Fire Fang (95%) missed, worth +15% to Alpha");
  });

  test('a proven smaller roll does not stand in for an unproven biggest one', () => {
    const report = buildGameReport(game({ chanceDelta: 0.3, rolledFor: forP1 }, [
      mk(5, -0.8, -1, { chanceDelta: 0.22, rolledFor: forP1, p2: fireFang }),
    ]), names, 'p2', true, new Set([3, 5]));
    expect(report.summary).not.toContain('biggest roll');
  });

  test('no sentence under the mistake floor, without a roll behind the chance, toward the winner, or without the turns\' rolls', () => {
    const says = (turns: TurnAnalysis[], winner: 'p1' | 'p2' | null = 'p2') =>
      buildGameReport(turns, names, winner, true, new Set([3])).summary.includes("biggest roll");
    expect(says(game({ chanceDelta: 0.19, rolledFor: forP1 }))).toBe(false);
    expect(says(game({ chanceDelta: 0.4, rolledFor: none }))).toBe(false);
    expect(says(game({ chanceDelta: -0.4, rolledFor: forP2 }))).toBe(false);
    expect(says(game({ chanceDelta: 0.4 }).map(turn => ({ ...turn, rolledFor: undefined })))).toBe(false);
    expect(says(game({ chanceDelta: 0.4, rolledFor: forP1 }), null)).toBe(false);
  });

  test('the denied end of the same turn is not said twice', () => {
    const near = { species: 'Garchomp', odds: 0.95, removes: 'Corviknight', click: { move: 'firefang' }, announce: true };
    const played = { ...choice('Fire Fang'), choice: 'move firefang' };
    const turns = [
      mk(1, -0.5, 0.1, { attribution: 'chance', chanceDelta: 0.4, p2: sideOf({ played, nearDecided: near }), rolledFor: forP1 }),
      ...Array.from({ length: 9 }, (_, index) => mk(index + 2, 0.1, -0.2 - index * 0.08, { rolledFor: none })),
    ];
    const report = buildGameReport(turns, names, 'p2', true, new Set([1]));
    expect(report.deniedEnd?.turn).toBe(1);
    expect(report.summary).not.toContain("biggest roll");
  });
});
