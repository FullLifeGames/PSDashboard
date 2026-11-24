import { test, expect, describe } from 'vitest';
import type { TurnAnalysis, SideAnalysis } from '../src/analysis';
import { buildGameReport } from '../src/report';
import type { RankedChoice } from '../src/types';
import { buildScene, GAMES, READERS, type Scene } from './read-against-click-builder';

const names: [string, string] = ['Alpha', 'Beta'];

const ranked = (choiceStr: string, label: string, worstCase: number): RankedChoice =>
  ({ choice: choiceStr, label, worstCase, expected: worstCase, ev: worstCase, punishedBy: null });

const mk = (turn: number, scoreBefore: number, scoreAfter: number | null, over: Partial<TurnAnalysis> = {}): TurnAnalysis => ({
  turn,
  scoreBefore,
  scoreAfter,
  swing: scoreAfter !== null ? scoreAfter - scoreBefore : null,
  playedOutcome: null,
  decisionDelta: null,
  chanceDelta: null,
  attribution: 'quiet',
  p1: { playedRaw: null, played: null, best: null, safe: null, regret: 0 },
  p2: { playedRaw: null, played: null, best: null, safe: null, regret: 0 },
  ...over,
});

/** Tier as analyzeTurn would band it (fixtures hand-build SideAnalysis). */
const tierOf = (regret: number) =>
  regret >= 0.3 ? { tier: 'blunder' as const } : regret >= 0.15 ? { tier: 'mistake' as const } : {};

describe('game report (multi-turn root cause)', () => {
  test('finds the turn whose play made the winning advantage permanent', () => {
    const report = buildGameReport([
      mk(1, 0.2, 0.1),
      mk(2, 0.1, -0.2),
      mk(3, -0.2, -0.5),
      mk(4, -0.5, -0.7),
    ], names, 'p2');
    expect(report.turningPoint).toBe(2);
    expect(report.summary).toContain('Beta won');
    expect(report.summary).toContain('turn 2');
  });

  test('a wire-to-wire win has no turning point', () => {
    const report = buildGameReport([
      mk(1, -0.2, -0.3),
      mk(2, -0.3, -0.5),
      mk(3, -0.5, -0.8),
    ], names, 'p2');
    expect(report.turningPoint).toBeNull();
    expect(report.summary).toContain('start to finish');
  });

  test('key moments are the biggest non-quiet swings, in turn order', () => {
    const report = buildGameReport([
      mk(1, 0.0, 0.5, { attribution: 'chance' }),
      mk(2, 0.5, 0.45),
      mk(3, 0.45, -0.3, { attribution: 'p1-decision' }),
      mk(4, -0.3, -0.35, { attribution: 'p2-decision' }),
      mk(5, -0.35, -0.9, { attribution: 'both-decision' }),
    ], names, 'p2');
    expect(report.keyMoments.map(moment => moment.turn)).toEqual([1, 3, 5]);
  });

  test('a big roll qualifies and ranks a turn whose net swing partially cancelled', () => {
    // t2: the game's biggest roll (0.45) nets to 0.10 because the decision
    // pushed the other way (573756 t73). It must both ENTER the key moments
    // and RANK by the roll — displacing the weakest net-swing turn (t5)
    // from the top four. All chance runs toward p1 (against the p2 winner),
    // so resolution booking never absorbs it.
    const report = buildGameReport([
      mk(1, -0.3, 0.0, { attribution: 'p1-decision' }),
      mk(2, 0.0, 0.1, { attribution: 'chance', chanceDelta: 0.45 }),
      mk(3, 0.1, 0.38, { attribution: 'p2-decision' }),
      mk(4, 0.38, 0.65, { attribution: 'both-decision' }),
      mk(5, 0.65, 0.91, { attribution: 'p1-decision' }),
    ], names, 'p2');
    expect(report.keyMoments.map(moment => moment.turn)).toEqual([1, 2, 3, 4]);
  });

  test('sums per-player regret and net chance', () => {
    const side = (regret: number) => ({ playedRaw: null, played: null, best: null, regret });
    const report = buildGameReport([
      mk(1, 0, -0.1, { p1: side(0.2), p2: side(0.05), chanceDelta: -0.1 }),
      mk(2, -0.1, -0.2, { p1: side(0.15), p2: side(0), chanceDelta: -0.3 }),
    ], names, 'p2');
    expect(report.decisionTotals.p1).toBeCloseTo(0.35, 10);
    expect(report.decisionTotals.p2).toBeCloseTo(0.05, 10);
    expect(report.chanceTotal).toBeCloseTo(-0.4, 10);
  });

  test('a decided game\'s resolution is not luck: post-boundary chance toward the winner leaves key moments and the luck ledger', () => {
    // 573756 t134–138 in miniature: the winner is ahead through the whole
    // endgame, the static bar underprices the locked 1v1, and the final KO
    // "surprises" the model — chance toward the winner past the favor
    // boundary is the decided game resolving, not luck. Chance AGAINST the
    // winner stays genuine luck wherever it lands, and pre-boundary chance
    // toward the eventual winner stays luck too (the game was still open).
    const report = buildGameReport([
      mk(1, 0.1, -0.2, { attribution: 'chance', chanceDelta: -0.3 }),
      mk(2, -0.2, -0.25),
      mk(3, -0.25, -0.05, { attribution: 'chance', chanceDelta: 0.2 }),
      mk(4, -0.05, -0.98, { attribution: 'chance', chanceDelta: -0.9 }),
    ], names, 'p2');
    // Scores favor Beta from turn 2 onward: turn 4's convergence to the
    // terminal value is resolution; turn 1's swing (pre-boundary) and turn
    // 3's roll toward the loser are luck.
    expect(report.turningPoint).toBe(1);
    expect(report.keyMoments.map(moment => moment.turn)).toEqual([1]);
    expect(report.chanceTotal).toBeCloseTo(-0.1, 10);
    expect(report.resolutionTotal).toBeCloseTo(-0.9, 10);
  });

  test('names the seeds of the loss: the loser\'s costliest choices before the tip', () => {
    const report = buildGameReport([
      mk(1, 0.1, 0.05),
      mk(2, 0.05, -0.3, {
        attribution: 'p1-decision',
        p1: {
          playedRaw: { kind: 'move', name: 'Scald', tera: false },
          played: { ...ranked('move scald', 'Scald', -0.3), koOdds: { accuracy: 1, killFraction: 0.43 } },
          best: ranked('switch 3', '→ Dragapult', -0.05),
          safe: null,
          regret: 0.25,
          ...tierOf(0.25),
        },
      }),
      mk(3, -0.3, -0.6),
      mk(4, -0.6, -0.9),
    ], names, 'p2');
    expect(report.summary).toContain('Scald');
    expect(report.summary).toContain('switching to Dragapult');
    expect(report.summary).toContain('turn 2');
    // The played move's true odds ground the seed parenthetical.
    expect(report.summary).toContain('(kills ~43% of the time');
  });

  test('lists each side\'s biggest misplays, in turn order', () => {
    const misplay = (played: string, better: string, regret: number, riskUnpunished = false) => ({
      playedRaw: null,
      played: ranked(`move ${played.toLowerCase()}`, played, -0.2),
      best: ranked(`move ${better.toLowerCase()}`, better, 0.1),
      safe: null,
      regret,
      ...tierOf(regret),
      ...(riskUnpunished ? { riskUnpunished } : {}),
    });
    const report = buildGameReport([
      mk(1, 0.1, 0.0, { p1: misplay('Tackle', 'Surf', 0.18) }),
      mk(2, 0.0, -0.2, { p2: misplay('Growl', 'Protect', 0.4, true) }),
      mk(3, -0.2, -0.3, { p1: misplay('Splash', 'Toxic', 0.3), p2: misplay('Leer', 'Recover', 0.2) }),
      mk(4, -0.3, -0.35, { p1: misplay('Peck', 'Fly', 0.1) }),
      mk(5, -0.35, -0.5, { p2: misplay('Bite', 'Crunch', 0.25) }),
    ], names, 'p2');
    // Top two PER SIDE — p2's bigger numbers cannot crowd p1 out.
    expect(report.misplays.map(entry => `${entry.turn}${entry.side}`)).toEqual(['1p1', '2p2', '3p1', '5p2']);
    expect(report.misplays[1]).toEqual({ turn: 2, side: 'p2', regret: 0.4, played: 'Growl', better: 'Protect', tier: 'blunder', riskUnpunished: true });
    expect(report.tracked).toBe(true);
  });

  test('a sacked turn stays out of the seeds and carries the sacrifice flag', () => {
    const sackSide = {
      playedRaw: null,
      played: ranked('switch 2', '→ Uxie', -0.1),
      best: ranked('move dracometeor', 'Draco Meteor', 0.2),
      safe: ranked('move dracometeor', 'Draco Meteor', 0.2),
      regret: 0.2,
      tier: 'mistake' as const,
      sacrifice: { name: 'Uxie', hpFraction: 0.09 },
    };
    const report = buildGameReport([
      mk(1, 0.2, -0.1, { attribution: 'p1-decision', p1: sackSide }),
      mk(2, -0.1, -0.4),
      mk(3, -0.4, -0.7),
    ], names, 'p2');
    expect(report.misplays).toHaveLength(1);
    expect(report.misplays[0]).toMatchObject({ turn: 1, side: 'p1', sacrifice: true });
    expect(report.summary).not.toContain('seeds of the loss');
  });

  test('paid-off reads are listed separately, never as misplays or regret totals', () => {
    const read = (played: string, regret: number, payoff: number) => ({
      playedRaw: null,
      played: ranked(`move ${played.toLowerCase()}`, played, -0.2),
      best: ranked('move safe', 'Safe', 0.1),
      regret,
      riskUnpunished: true,
      riskPayoff: payoff,
      riskPaidOff: true,
    });
    // The read's side holds its ground on the turn (a read on a lost turn leaves the list).
    const report = buildGameReport([
      mk(1, 0.3, 0.1, { p2: read('Flip Turn', 0.3, 0.25) }),
      mk(2, 0.1, 0.2),
    ], names, 'p2');
    expect(report.reads).toEqual([{ turn: 1, side: 'p2', played: 'Flip Turn', payoff: 0.25 }]);
    expect(report.misplays).toEqual([]);
    expect(report.decisionTotals.p2).toBe(0);
  });

  test('an unpunished risk never counts as a seed of the loss', () => {
    const report = buildGameReport([
      mk(1, 0.1, 0.05),
      mk(2, 0.05, -0.3, {
        attribution: 'p1-decision',
        p1: {
          playedRaw: { kind: 'move', name: 'Recover', tera: false },
          played: ranked('move recover', 'Recover', -0.3),
          best: ranked('switch 3', '→ Dragapult', -0.05),
          safe: null,
          regret: 0.25,
          ...tierOf(0.25),
          riskUnpunished: true,
        },
      }),
      mk(3, -0.3, -0.6),
      mk(4, -0.6, -0.9),
    ], names, 'p2');
    expect(report.summary).not.toContain('seeds');
    expect(report.summary).not.toContain('Recover');
  });

  test('a clean loss is called out as matchup/variance, not blunders', () => {
    const report = buildGameReport([
      mk(1, -0.2, -0.4),
      mk(2, -0.4, -0.6),
      mk(3, -0.6, -0.9),
    ], names, 'p2');
    expect(report.summary).toContain('clean');
  });

  test('without played tracking the report never claims clean play or seeds', () => {
    const report = buildGameReport([
      mk(1, -0.2, -0.4),
      mk(2, -0.4, -0.6),
      mk(3, -0.6, -0.9),
    ], names, 'p2', false);
    expect(report.summary).toContain('Beta won');
    expect(report.summary).not.toContain('clean');
    expect(report.summary).not.toContain('seeds');
  });

  test('a perfect game scores 100 accuracy', () => {
    const perfect = () => ({
      playedRaw: null,
      played: ranked('move a', 'A', 0.1),
      best: ranked('move a', 'A', 0.1),
      safe: null,
      regret: 0,
      choiceCount: 4,
    });
    const report = buildGameReport(
      [1, 2, 3, 4, 5].map(turn => mk(turn, 0.1, 0.1, { p1: perfect(), p2: perfect() })),
      names, 'p1',
    );
    expect(report.accuracy?.p1).toBeCloseTo(100, 0);
    expect(report.accuracy?.p2).toBeCloseTo(100, 0);
  });

  test('one blunder drags the harmonic mean visibly', () => {
    const perfect = () => ({
      playedRaw: null, played: ranked('move a', 'A', 0.4), best: ranked('move a', 'A', 0.4),
      safe: null, regret: 0, choiceCount: 4,
    });
    const blunder = {
      playedRaw: null, played: ranked('move b', 'B', -0.8), best: ranked('move a', 'A', 0.4),
      safe: null, regret: 1.2, tier: 'blunder' as const, choiceCount: 4,
    };
    const analyses = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(turn => mk(turn, 0.1, 0.1, { p1: perfect() }));
    analyses.push(mk(10, 0.1, -0.5, { p1: blunder, attribution: 'p1-decision' }));
    const report = buildGameReport(analyses, names, 'p2');
    // In wp-units the 1.2 ev gap is a ~60% win-prob throw — it drags hard,
    // but nine clean turns keep the game off the floor.
    expect(report.accuracy?.p1).toBeLessThan(80);
    expect(report.accuracy?.p1).toBeGreaterThan(30);
    expect(report.accuracy?.p2).toBeNull();
  });

  test('under five graded turns accuracy stays null', () => {
    const perfect = () => ({
      playedRaw: null, played: ranked('move a', 'A', 0.1), best: ranked('move a', 'A', 0.1),
      safe: null, regret: 0, choiceCount: 4,
    });
    const report = buildGameReport(
      [1, 2, 3].map(turn => mk(turn, 0.1, 0.1, { p1: perfect() })),
      names, 'p1',
    );
    expect(report.accuracy?.p1).toBeNull();
  });

  test('forced turns never inflate accuracy', () => {
    // choiceCount 1 (forced switch / wait sentinel) is excluded from grading.
    const forced = () => ({
      playedRaw: null, played: ranked('move a', 'A', 0.1), best: ranked('move a', 'A', 0.1),
      safe: null, regret: 0, choiceCount: 1,
    });
    const report = buildGameReport(
      [1, 2, 3, 4, 5, 6].map(turn => mk(turn, 0.1, 0.1, { p1: forced() })),
      names, 'p1',
    );
    expect(report.accuracy?.p1).toBeNull();
  });

  test('gaps in the sweep are tolerated', () => {
    const report = buildGameReport([
      mk(1, 0.2, 0.1),
      null,
      mk(3, -0.2, -0.5),
      mk(4, -0.5, -0.7),
    ], names, 'p2');
    expect(report.turningPoint).toBe(2);
    expect(report.keyMoments.length).toBeGreaterThanOrEqual(0);
  });
});

describe('null-swapped recommendations', () => {
  test('misplay rows and the seeds sentence use the co-optimal alternative', () => {
    const played = ranked('move splash', 'Splash', -0.3);
    const best = ranked('move willowisp', 'Will-O-Wisp', 0.2);
    const flagged = {
      playedRaw: null, played, best, safe: best, regret: 0.5, tier: 'blunder' as const,
      bestNull: {
        reason: 'Charizard-Mega-X cannot be burned (Fire-type)',
        alternative: { label: 'Hex', ev: 0.19 },
      },
    };
    const report = buildGameReport([
      mk(1, 0.1, -0.2, { attribution: 'p1-decision', p1: flagged }),
      mk(2, -0.2, -0.4),
      mk(3, -0.4, -0.6),
    ], names, 'p2');
    expect(report.misplays).toHaveLength(1);
    expect(report.misplays[0].better).toBe('Hex');
    expect(report.summary).toContain('safer was Hex');
    expect(report.summary).not.toContain('Will-O-Wisp');
  });
});

/**
 * The report's biggest-roll sentence holds both chances of the side that rolled. 562428 turn 11: Tapu Bulu's 80 % Stone Edge missed Ikki,
 * and the winner (p1) stood well ahead after it; a hit would have left it further ahead. 573756 turn 73 reads the same way for p2 (the shapes
 * of both scenes, the numbers of the copy's engine score are in test/regression/rolled-copy.spec.ts).
 */
describe('the biggest roll in the game report', () => {
  const stoneEdge = {
    ...ranked('move stoneedge', 'Stone Edge', 0.2),
    koOdds: { accuracy: 0.8, killFraction: 1 },
  };
  const game = (): TurnAnalysis[] => [
    mk(1, 0.2, 0.3, { chanceDelta: 0, rolledFor: { p1: false, p2: false } }),
    mk(2, 0.3, 0.5, { chanceDelta: 0.05, rolledFor: { p1: false, p2: false } }),
    mk(3, 0.5, 0.6, {
      chanceDelta: -0.3, rolledFor: { p1: false, p2: true }, p1: { playedRaw: null, played: stoneEdge, best: null, safe: null, regret: 0 },
      faintedFractionAfter: 0.25,
    }),
    mk(4, 0.6, 0.8, { chanceDelta: 0.02, rolledFor: { p1: false, p2: false } }),
  ];

  test('562428 shape: the winner\'s Stone Edge missed; the sentence says what a hit would have left and where the winner stood', () => {
    const report = buildGameReport(game(), names, 'p1', true, new Set([3]), { turn: 3, score: 0.9 });
    expect(report.summary).toContain(
      "The game's biggest roll came on turn 3: Stone Edge (80%) missed. A hit would have left Alpha 84% to win; after the miss Alpha stood at 75%.",
    );
  });

  test('a copy of another turn is not read', () => {
    const report = buildGameReport(game(), names, 'p1', true, new Set([3]), { turn: 2, score: 0.9 });
    expect(report.summary).toContain('Stone Edge (80%) missed. After the miss Alpha stood at 75%.');
    expect(report.summary).not.toContain('A hit would');
  });
});

describe('luck-report', () => {
  const names: [string, string] = ['Alpha', 'Beta'];

  const sideOf = (extra: Partial<SideAnalysis> = {}): SideAnalysis =>
    ({ playedRaw: null, played: null, best: null, safe: null, regret: 0, ...extra });

  const mk = (turn: number, scoreBefore: number, scoreAfter: number | null, over: Partial<TurnAnalysis> = {}): TurnAnalysis => ({
    turn, scoreBefore, scoreAfter, swing: scoreAfter !== null ? scoreAfter - scoreBefore : null,
    playedOutcome: null, decisionDelta: null, chanceDelta: null, attribution: 'quiet',
    p1: sideOf(), p2: sideOf(), ...over,
  });

  const none = { p1: false, p2: false };
  const forP1 = { p1: true, p2: false };
  const forP2 = { p1: false, p2: true };

  describe('report: the luck ledger in two parts', () => {
    test('649664 shape: the rolls hold under half of the ledger, so no "The rolls decided it" and the luck line names only what the rolls gave', () => {
      const report = buildGameReport([
        mk(1, -0.3, -0.1, { chanceDelta: 0.3, rolledFor: forP1 }),
        mk(2, -0.1, -0.2, { chanceDelta: -0.05, rolledFor: none }),
        mk(3, -0.2, 0.25, { attribution: 'chance', chanceDelta: 0.45, rolledFor: forP2 }),
        mk(4, 0.25, 0.55, { chanceDelta: 0.1, rolledFor: none }),
        mk(5, 0.55, 0.85, { rolledFor: none }),
      ], names, 'p1');
      expect(report.summary).not.toContain('The rolls decided it');
      expect(report.winPath?.factor).not.toBe('variance');
      expect(report.chanceSplit?.rolled).toBeCloseTo(0.3);
      expect(report.chanceSplit?.reRead).toBeCloseTo(0.5);
      expect(report.summary).toContain('The rolls gave Alpha +15%.');
    });

    test('the rolls carry at least half the ledger the same way: the rolls decided it', () => {
      const report = buildGameReport([
        mk(1, 0.1, -0.25, { attribution: 'chance', chanceDelta: -0.35, rolledFor: forP2 }),
        mk(2, -0.25, -0.45, { chanceDelta: -0.15, rolledFor: none }),
        mk(3, -0.45, -0.75, { rolledFor: none }),
      ], names, 'p2');
      expect(report.summary).toContain('The rolls decided it');
      expect(report.winPath?.factor).toBe('variance');
    });

    test('573756 shape: the rolls went the other way, the luck line says what they gave the other side', () => {
      const report = buildGameReport([
        mk(1, 0.1, 0.3, { chanceDelta: 0.24, rolledFor: forP1 }),
        mk(2, 0.3, -0.4, { attribution: 'chance', chanceDelta: -0.7, rolledFor: forP1 }),
        mk(3, -0.4, -0.8, { chanceDelta: -0.6, rolledFor: none }),
        mk(4, -0.8, -0.9, { rolledFor: none }),
      ], names, 'p2');
      expect(report.summary).not.toContain('The rolls decided it');
      expect(report.summary).toContain('The rolls gave Alpha +12%.');
    });

    test('doubles (2663093831 shape): luck toward the loser, under half rolled, names only the rolls', () => {
      const pair = sideOf({ playedSlots: [{ kind: 'move', name: 'Heat Wave', targetLoc: null }, { kind: 'move', name: 'Protect', targetLoc: null }] });
      const report = buildGameReport([
        mk(1, 0, 0.3, { p1: pair, p2: pair, chanceDelta: 0.35, rolledFor: none }),
        mk(2, 0.3, 0.2, { p1: pair, p2: pair, chanceDelta: 0.15, rolledFor: forP1 }),
        mk(3, 0.2, -0.6, { p1: pair, p2: pair, rolledFor: none }),
        mk(4, -0.6, -0.9, { p1: pair, p2: pair, rolledFor: none }),
      ], names, 'p2');
      expect(report.summary).toContain('The rolls gave Alpha +8%.');
      expect(report.summary).not.toContain('Luck ran');
    });

    test('a ledger without a single roll says the rolls gave nothing', () => {
      const report = buildGameReport([
        mk(1, 0, 0.4, { chanceDelta: 0.4, rolledFor: none }),
        mk(2, 0.4, 0.8, { rolledFor: none }),
      ], names, 'p1');
      expect(report.summary).toContain('The rolls favored neither side.');
    });

    test('without rolledFor the report keeps its anchor gates and writes no split', () => {
      const report = buildGameReport([
        mk(1, 0.1, -0.15, { attribution: 'chance', chanceDelta: -0.3 }),
        mk(2, -0.15, -0.4, { chanceDelta: -0.17 }),
        mk(3, -0.4, -0.7),
      ], names, 'p2');
      expect(report.summary).toContain('The rolls decided it');
      expect(report.chanceSplit).toBeUndefined();
    });
  });

  describe('report: the tip and the denied end read the same rolls', () => {
    test('the tip turn speaks "on a roll" only with a roll toward the winner, a marker the other way no longer suffices', () => {
      // Turn 2 produced the boundary score: the tip turn.
      const turns = (rolledFor: { p1: boolean; p2: boolean }) => [
        mk(1, 0.1, 0.05, { rolledFor: none }),
        mk(2, 0.05, -0.4, { attribution: 'chance', chanceDelta: -0.3, rolledFor }),
        mk(3, -0.4, -0.75, { rolledFor: none }),
      ];
      expect(buildGameReport(turns(forP2), names, 'p2', true, new Set()).summary).toContain("on a roll that went Beta's way");
      expect(buildGameReport(turns(forP1), names, 'p2', true, new Set([2])).summary).not.toContain('on a roll');
    });

    test('573756 t73 shape: the denied end needs a roll against the near-decided side', () => {
      const near = { species: 'Garchomp', odds: 0.95, removes: 'Corviknight', click: { move: 'firefang' }, announce: true };
      const played = { choice: 'move firefang', label: 'Fire Fang', worstCase: 0, expected: 0, ev: 0, punishedBy: null };
      const turns = (rolledFor: { p1: boolean; p2: boolean }) => [
        mk(1, -0.5, 0.1, { attribution: 'chance', chanceDelta: 0.4, p2: sideOf({ played, nearDecided: near }), rolledFor }),
        ...Array.from({ length: 9 }, (_, index) => mk(index + 2, 0.1, -0.2 - index * 0.08, { rolledFor: none })),
      ];
      expect(buildGameReport(turns(forP1), names, 'p2', true, new Set([1])).deniedEnd?.turn).toBe(1);
      expect(buildGameReport(turns(forP2), names, 'p2', true, new Set([1])).deniedEnd).toBeUndefined();
    });
  });
});

const scene = (overrides: Partial<Scene> & Pick<Scene, 'kind' | 'playedCell' | 'safeCell'>, reader: Scene['reader']): Scene => ({ reader, ...overrides });

describe.each(GAMES)('%s', (_game, make) => {
  describe.each(READERS)('read by %s', reader => {
    const build = (overrides: Partial<Scene> & Pick<Scene, 'kind' | 'playedCell' | 'safeCell'>) => buildScene(make, scene(overrides, reader));
    const other = reader === 'p1' ? 'p2' : 'p1';

    test('a gamble whose played cell trails the safe cell by a point is no read (648453 t8; red before: riskPaidOff true, p2-read)', () => {
      const { analysis } = build({ kind: 'gamble', playedCell: 0.189, safeCell: 0.19 });
      const side = analysis[reader];
      expect(side.riskPayoff).toBeGreaterThanOrEqual(0.08);
      expect(side.riskPaidOff).toBeUndefined();
      expect(side.safeAgainstClick).toEqual({ against: analysis[other].played!.label, playedValue: 0.189, safeValue: 0.19 });
      expect(analysis.attribution).toBe('quiet');
    });

    test('a gamble whose played cell beats the safe cell is a read and carries both cells', () => {
      const { analysis } = build({ kind: 'gamble', playedCell: 0.3, safeCell: 0.19 });
      const side = analysis[reader];
      expect(side.riskPaidOff).toBe(true);
      expect(side.safeAgainstClick).toEqual({ against: analysis[other].played!.label, playedValue: 0.3, safeValue: 0.19 });
      expect(analysis.attribution).toBe(`${reader}-read`);
    });

    test('a mistake paid three turns later against a safe cell that read better is the reader\'s decision (2663093831 t8)', () => {
      const { analysis } = build({ kind: 'mistake', playedCell: 0.072, safeCell: 0.327, window: true });
      const side = analysis[reader];
      expect(side.tier).toBe('mistake');
      expect(side.riskPayoffTurn).toBe(2);
      expect(side.riskPaidOff).toBeUndefined();
      expect(side.riskUnpunished).toBe(true);
      expect(side.safeAgainstClick).toEqual({ against: analysis[other].played!.label, playedValue: 0.072, safeValue: 0.327 });
      expect(analysis.attribution).toBe(`${reader}-decision`);
    });

    test('that mistake lists as a misplay with riskUnpunished, no read, and its regret in the decision total', () => {
      const { analysis, names } = build({ kind: 'mistake', playedCell: 0.072, safeCell: 0.327, window: true });
      const report = buildGameReport([analysis], names, null);
      expect(report.reads.filter(read => read.side === reader)).toEqual([]);
      const misplays = report.misplays.filter(misplay => misplay.side === reader);
      expect(misplays).toHaveLength(1);
      expect(misplays[0]).toMatchObject({ turn: 8, side: reader, riskUnpunished: true });
      expect(report.decisionTotals[reader]).toBeCloseTo(analysis[reader].regret!, 9);
    });

    test('the same mistake with a played cell that beats the safe cell stays a read and an excused regret', () => {
      const { analysis, names } = build({ kind: 'mistake', playedCell: 0.4, safeCell: 0.327, window: true });
      expect(analysis[reader].riskPaidOff).toBe(true);
      expect(analysis.attribution).toBe(`${reader}-read`);
      const report = buildGameReport([analysis], names, null);
      expect(report.reads.filter(read => read.side === reader)).toHaveLength(1);
      expect(report.decisionTotals[reader]).toBe(0);
    });

    test('an inaccuracy risk against a safe cell that read better earns no credit and shows no read (2663093831 t6)', () => {
      const { analysis } = build({ kind: 'inaccuracy', playedCell: 0.325, safeCell: 0.454 });
      const side = analysis[reader];
      expect(side.tier).toBe('inaccuracy');
      expect(side.riskPaidOff).toBeUndefined();
      expect(side.riskUnpunished).toBeUndefined();
      expect(side.safeAgainstClick).toMatchObject({ playedValue: 0.325, safeValue: 0.454 });
      expect(analysis.attribution).toBe('quiet');
    });

    test('an inaccuracy risk that beat the safe cell keeps its credit', () => {
      const { analysis } = build({ kind: 'inaccuracy', playedCell: 0.454, safeCell: 0.325 });
      expect(analysis[reader].riskPaidOff).toBe(true);
      expect(analysis.attribution).toBe(`${reader}-read`);
    });

    test('a gap of 0.005 fails and a gap of 0.01 passes', () => {
      expect(build({ kind: 'gamble', playedCell: 0.205, safeCell: 0.2 }).analysis[reader].riskPaidOff).toBeUndefined();
      expect(build({ kind: 'gamble', playedCell: 0.21, safeCell: 0.2 }).analysis[reader].riskPaidOff).toBe(true);
      expect(build({ kind: 'gamble', playedCell: 0.2, safeCell: 0.2 }).analysis[reader].riskPaidOff).toBeUndefined();
    });

    test('a side that lost ground with a failing read keeps no credit either (2663093831 t1)', () => {
      const { analysis } = build({ kind: 'inaccuracy', playedCell: 0.325, safeCell: 0.454, lostGround: 0.15 });
      expect(analysis[reader].riskPaidOff).toBeUndefined();
      expect(analysis[reader].safeAgainstClick).toBeDefined();
      expect(analysis.attribution).not.toBe(`${reader}-read`);
    });

    test('fail open: a result without a matrix keeps today\'s rule and writes no field', () => {
      const { analysis } = build({ kind: 'gamble', playedCell: 0.189, safeCell: 0.19, noMatrix: true });
      expect(analysis[reader].riskPaidOff).toBe(true);
      expect(analysis[reader].safeAgainstClick).toBeUndefined();
      expect(analysis.attribution).toBe(`${reader}-read`);
    });
  });
});

describe('doubles: a hidden slot of the opponent\'s click', () => {
  const doubles = GAMES[1][1];
  test.each(READERS)('read by %s: no clicked column, so today\'s credit stays and no field is written', reader => {
    const { analysis } = buildScene(doubles, { kind: 'gamble', reader, playedCell: 0.189, safeCell: 0.19, hiddenClick: true });
    expect(analysis[reader].riskPaidOff).toBe(true);
    expect(analysis[reader].safeAgainstClick).toBeUndefined();
  });
});

describe('win-reason-order', () => {
  const names: [string, string] = ['Alpha', 'Beta'];

  const ranked = (choiceStr: string, label: string, worstCase: number): RankedChoice =>
    ({ choice: choiceStr, label, worstCase, expected: worstCase, ev: worstCase, punishedBy: null });

  const quietSide = (): SideAnalysis => ({ playedRaw: null, played: null, best: null, safe: null, regret: 0 });

  const mk = (turn: number, scoreBefore: number, scoreAfter: number | null, over: Partial<TurnAnalysis> = {}): TurnAnalysis => ({
    turn, scoreBefore, scoreAfter,
    swing: scoreAfter !== null ? scoreAfter - scoreBefore : null,
    playedOutcome: null, decisionDelta: null, chanceDelta: null,
    attribution: 'quiet', p1: quietSide(), p2: quietSide(),
    ...over,
  });

  const read = (label: string, choiceStr: string, payoff: number): SideAnalysis => ({
    playedRaw: null,
    played: ranked(choiceStr, label, 0.1),
    best: ranked('move safe', 'Safe', 0.2),
    safe: null,
    regret: 0.05,
    riskUnpunished: true,
    riskPayoff: payoff,
    riskPaidOff: true,
  });

  describe('the reads examples read in turn order', () => {
    test('singles, 655336: the bigger payoff on turn 27 is named after the read on turn 13', () => {
      const analyses: TurnAnalysis[] = [];
      for (let turn = 1; turn <= 28; turn++) {
        const before = 0.02 * turn;
        const p1 = turn === 13 ? read('Dragon Dance', 'move dragondance', 0.31)
          : turn === 27 ? read('Dragon Claw', 'move dragonclaw', 0.75) : quietSide();
        analyses.push(mk(turn, before, before + 0.02, { p1 }));
      }
      const report = buildGameReport(analyses, names, 'p1');
      expect(report.summary).toContain('Alpha won it on reads: Dragon Dance on turn 13 (+16%) and Dragon Claw on turn 27 (+38%).');
      expect(report.reads.map(entry => entry.turn)).toEqual([13, 27]);
    });

    test('doubles: two combo reads keep the turn order the same way', () => {
      const report = buildGameReport([
        mk(1, 0.05, 0.1, { p1: read('Breaking Swipe + Make It Rain', 'move breakingswipe, move makeitrain', 0.12) }),
        mk(2, 0.1, 0.15),
        mk(3, 0.15, 0.3, { p1: read('Hyper Voice + Life Dew', 'move hypervoice, move lifedew', 0.4) }),
        mk(4, 0.3, 0.6),
      ], names, 'p1');
      expect(report.summary).toContain('Alpha won it on reads: Breaking Swipe + Make It Rain on turn 1 (+6%) and Hyper Voice + Life Dew on turn 3 (+20%).');
    });
  });

  /** A conversion needs the bar to hold for the winner from its turn on, so it never names a turn before the tip: the report's "From turn N" never precedes "tipped on turn M". */
  describe('the conversion never comes before the tip', () => {
    const swept = (species: string): SideAnalysis => ({ ...quietSide(), decided: { species, announce: true } });

    test('a decided sweep before a dip under the favor line does not convert before the tip', () => {
      const report = buildGameReport([
        mk(1, 0.1, 0.8),
        mk(2, 0.8, 0.85, { p1: swept('Dragonite') }),
        mk(3, 0.85, -0.05),
        mk(4, -0.05, 0.75),
        mk(5, 0.75, 0.9, { p1: swept('Dragonite') }),
        mk(6, 0.9, 1),
      ], names, 'p1');
      expect(report.turningPoint).toBe(4);
      expect(report.conversion?.turn).toBe(5);
      const summary = report.summary;
      expect(summary.indexOf('tipped for good on turn 4')).toBeLessThan(summary.indexOf('From turn 5'));
    });
  });
});
