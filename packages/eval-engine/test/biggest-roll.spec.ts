import { describe, expect, test } from 'vitest';
import type { SideAnalysis, TurnAnalysis } from '../src/analysis';
import { biggestRollFor, rollToCopy, type RolledHit } from '../src/biggest-roll';
import { buildGameReport } from '../src/report';
import type { KoOddsInfo, RankedChoice } from '../src/types';
import { winPercent } from '../src/winprob';

/**
 * Round 79 (T284): the report names the game's biggest roll against the eventual winner. 573756 turn 73: the 95 % Fire Fang
 * missed, worth +13 % to SOULWIND, the largest roll of the game, but the report spoke of turn 71 and the chip printed the
 * net +5 %. The roll is the largest |chanceDelta| on a turn whose roll went in the chance's direction, toward the loser,
 * at least CHANCE_THRESHOLD (0.2). The move is named only when the winner's played move provably carried the roll: a sure
 * kill behind an accuracy under 1.
 * User gate 30.10.2026 ("2a"): the sentence speaks only where the log names the event; a biggest roll whose move is not
 * proven says nothing, since "the game's biggest roll" with no event behind it told the reader nothing.
 * Round 86 (T304, spec gate 2a): the sentence names both chances of the side that rolled, "A hit would have left Beta 84% to win;
 * after the miss Beta stood at 76%." The hit is the engine's score of the next root of the copy that plays the turn with the die turned
 * over (rolled-copy.ts); the miss is the actual next root. A doubles click names its move and target through the odds' label, and
 * the sentence waits for the copy there, since the copy is what finds the die in the log.
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
/** The copy's next root: Beta's score if the Fire Fang had hit (p1 view). */
const hitOf = (score: number, over: Partial<RolledHit> = {}): RolledHit => ({ turn: 3, score, ...over });

describe('the game\'s biggest roll against the winner (T284, T304)', () => {
  test('573756 shape: the sentence names what a hit would have left the side that rolled and where it stood after the miss', () => {
    const report = buildGameReport(game({ chanceDelta: 0.27, rolledFor: forP1, p2: fireFang }), names, 'p2', true, new Set([3]), hitOf(-0.9));
    expect(report.summary).toContain(
      "The game's biggest roll came on turn 3: Fire Fang (95%) missed. A hit would have left Beta 84% to win; after the miss Beta stood at 76%.",
    );
  });

  test('both chances belong to the side that rolled: a winner on p1 reads the score as it stands', () => {
    const turns = game({ chanceDelta: -0.27, rolledFor: forP2, p1: fireFang, scoreAfter: 0.5 });
    const report = buildGameReport(turns, names, 'p1', true, new Set([3]), hitOf(0.9));
    expect(report.summary).toContain('Fire Fang (95%) missed. A hit would have left Alpha 84% to win; after the miss Alpha stood at 72%.');
  });

  test('the fainted share of each position sets its own map', () => {
    const turns = game({ chanceDelta: 0.27, rolledFor: forP1, p2: fireFang, faintedFractionAfter: 0.75 });
    const report = buildGameReport(turns, names, 'p2', true, new Set([3]), hitOf(-0.9, { faintedFraction: 0.5 }));
    const hit = winPercent(0.9, 0.5);
    const after = winPercent(0.62, 0.75);
    expect(report.summary).toContain(`A hit would have left Beta ${hit}% to win; after the miss Beta stood at ${after}%.`);
    expect(hit).not.toBe(winPercent(0.9));
  });

  test('a hit that ends the game stands at 100%', () => {
    const report = buildGameReport(game({ chanceDelta: 0.27, rolledFor: forP1, p2: fireFang }), names, 'p2', true, new Set([3]), hitOf(-1));
    expect(report.summary).toContain('A hit would have left Beta 100% to win; after the miss Beta stood at 76%.');
  });

  test('no copy yet: the singles sentence keeps the miss and where the winner stood after it', () => {
    const report = buildGameReport(game({ chanceDelta: 0.27, rolledFor: forP1, p2: fireFang }), names, 'p2', true, new Set([3]));
    expect(report.summary).toContain("The game's biggest roll came on turn 3: Fire Fang (95%) missed. After the miss Beta stood at 76%.");
    expect(report.summary).not.toContain('A hit would');
  });

  test('a copy of another turn says nothing about this one', () => {
    const report = buildGameReport(game({ chanceDelta: 0.27, rolledFor: forP1, p2: fireFang }), names, 'p2', true, new Set([3]), { turn: 9, score: -0.9 });
    expect(report.summary).toContain('Fire Fang (95%) missed. After the miss Beta stood at 76%.');
    expect(report.summary).not.toContain('A hit would');
  });

  test('a roll whose move is not proven says nothing', () => {
    const report = buildGameReport(game({ chanceDelta: 0.27, rolledFor: forP1 }), names, 'p2', true, new Set([3]), hitOf(-0.9));
    expect(report.summary).not.toContain('biggest roll');
  });

  test('doubles: the odds\' label names the move and the target, and the sentence waits for the copy that finds the die in the log', () => {
    const pair = sideOf({ played: choice('Fire Fang→Rillaboom + Protect', {
      accuracy: 0.95, killFraction: 1, label: 'Fire Fang→Rillaboom', attacker: { slot: 0, species: 'Garchomp' },
    }) });
    const turns = game({ chanceDelta: 0.27, rolledFor: forP1, p2: pair });
    expect(buildGameReport(turns, names, 'p2', false, new Set([3])).summary).not.toContain('biggest roll');
    expect(buildGameReport(turns, names, 'p2', false, new Set([3]), { turn: 9, score: -0.9 }).summary).not.toContain('biggest roll');
    expect(buildGameReport(turns, names, 'p2', false, new Set([3]), hitOf(-0.9)).summary).toContain(
      "The game's biggest roll came on turn 3: Fire Fang (95%) missed Rillaboom. A hit would have left Beta 84% to win; after the miss Beta stood at 76%.",
    );
  });

  test('the largest roll wins among several', () => {
    const report = buildGameReport(game({ chanceDelta: 0.3, rolledFor: forP1, p2: fireFang }, [
      mk(5, -0.8, -1, { chanceDelta: 0.22, rolledFor: forP1, p2: fireFang }),
    ]), names, 'p2', true, new Set([3, 5]));
    expect(report.summary).toContain("biggest roll came on turn 3: Fire Fang (95%) missed.");
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

describe('the roll the app plays the other way (rollToCopy)', () => {
  const pair = sideOf({ played: choice('Fire Fang→Rillaboom + Protect', {
    accuracy: 0.95, killFraction: 1, label: 'Fire Fang→Rillaboom', attacker: { slot: 1, species: 'Garchomp' },
  }) });

  test('singles: the winner, the move and the turn', () => {
    const roll = rollToCopy(game({ chanceDelta: 0.27, rolledFor: forP1, p2: fireFang }), 'p2', new Set([3]));
    expect(roll).toMatchObject({ turn: 3, winner: 'p2', move: 'Fire Fang', accuracy: 0.95 });
    expect(roll?.target).toBeUndefined();
    expect(roll?.slot).toBeUndefined();
  });

  test('doubles: the move, the target body and the attacker\'s slot come from the odds\' label', () => {
    const roll = rollToCopy(game({ chanceDelta: 0.27, rolledFor: forP1, p2: pair }), 'p2', new Set([3]));
    expect(roll).toMatchObject({ turn: 3, winner: 'p2', move: 'Fire Fang', target: 'Rillaboom', slot: 1 });
  });

  test('none where the report names none: no proof, a denied end on the turn, the loser\'s win', () => {
    expect(rollToCopy(game({ chanceDelta: 0.27, rolledFor: forP1 }), 'p2', new Set([3]))).toBeNull();
    expect(rollToCopy(game({ chanceDelta: 0.27, rolledFor: forP1, p2: fireFang }), null, new Set([3]))).toBeNull();
    expect(rollToCopy(game({ chanceDelta: 0.27, rolledFor: forP1, p2: fireFang }), 'p1', new Set([3]))).toBeNull();
  });

  test('the report and the app read one roll: biggestRollFor with the copy adds only the hit', () => {
    const turns = game({ chanceDelta: 0.27, rolledFor: forP1, p2: fireFang });
    const named = rollToCopy(turns, 'p2', new Set([3]))!;
    const spoken = biggestRollFor(turns, 'p2', hitOf(-0.9))!;
    expect(spoken).toMatchObject({ turn: named.turn, move: named.move, accuracy: named.accuracy, winner: 'p2' });
    expect(spoken.hit).toEqual(hitOf(-0.9));
  });
});
