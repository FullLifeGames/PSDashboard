import { test, expect } from '@playwright/test';
import type { TurnAnalysis } from '../src/analysis';
import { buildGameReport } from '../src/report';
import type { RankedChoice } from '../src/types';

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

test.describe('game report (multi-turn root cause)', () => {
  test('finds the turn whose play made the winning advantage permanent', () => {
    const report = buildGameReport([
      mk(1, 0.2, 0.1),
      mk(2, 0.1, -0.2),
      mk(3, -0.2, -0.5),
      mk(4, -0.5, -0.7),
    ], names, 'p2');
    // Scores favor Beta from turn 3 onward, so turn 2's play was decisive.
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

  test('a big roll qualifies and ranks a turn whose net swing partially cancelled (round 13)', () => {
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
    // Round 6: the played move's true odds ground the seed parenthetical.
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
      // Below the regret threshold — never listed.
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
    // The sack appears as a flagged chip but never as a seed of the loss.
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
    const report = buildGameReport([
      mk(1, 0.1, 0.3, { p2: read('Flip Turn', 0.3, 0.25) }),
      mk(2, 0.3, 0.2),
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
    // p2 never had a graded turn — no number is claimed.
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

test.describe('win-reason detection', () => {
  // Winner p2 throughout: p2-favoring scores are NEGATIVE (p1 perspective).

  test('speaks the decided sweep as the winner\'s conversion', () => {
    const report = buildGameReport([
      mk(1, 0.1, -0.25),
      mk(2, -0.25, -0.4),
      mk(3, -0.4, -0.6, { p2: { playedRaw: null, played: null, best: null, safe: null, regret: 0, decided: { species: 'Kyurem-White', announce: true } } }),
      mk(4, -0.6, -0.9, { p2: { playedRaw: null, played: null, best: null, safe: null, regret: 0, decided: { species: 'Kyurem-White', announce: false } } }),
    ], names, 'p2');
    expect(report.summary).toContain('From turn 3, Kyurem-White cleared everything Alpha had left.');
    expect(report.conversion).toEqual({ kind: 'decided', turn: 3, species: 'Kyurem-White' });
    // A quiet tip stays bare, and a spoken conversion mutes the close-game fallback.
    expect(report.summary).toContain('tipped for good on turn 1.');
    expect(report.summary).not.toContain('close game');
  });

  test('a proven forced win outranks a later decided sweep and carries its caveat', () => {
    const report = buildGameReport([
      mk(1, 0.05, -0.3),
      mk(2, -0.3, -0.5, { p2: { playedRaw: null, played: null, best: null, safe: null, regret: 0, forcedWin: { turns: 3, mass: 1, caveat: 'barring-crit', announce: true } } }),
      mk(3, -0.5, -0.8, { p2: { playedRaw: null, played: null, best: null, safe: null, regret: 0, decided: { species: 'Zapdos-Galar', announce: true } } }),
    ], names, 'p2');
    expect(report.summary).toContain('From turn 2 the win was forced — every reply lost within 3 turns, barring a crit.');
    expect(report.conversion).toEqual({ kind: 'forced', turn: 2, provenTurns: 3 });
  });

  test('an earlier decided sweep speaks over a later forced win', () => {
    const report = buildGameReport([
      mk(1, 0.05, -0.3),
      mk(2, -0.3, -0.5, { p2: { playedRaw: null, played: null, best: null, safe: null, regret: 0, decided: { species: 'Zapdos-Galar', announce: true } } }),
      mk(3, -0.5, -0.8, { p2: { playedRaw: null, played: null, best: null, safe: null, regret: 0, forcedWin: { turns: 2, mass: 1, caveat: 'none', announce: true } } }),
    ], names, 'p2');
    expect(report.summary).toContain('From turn 2, Zapdos-Galar cleared everything Alpha had left.');
    expect(report.conversion).toEqual({ kind: 'decided', turn: 2, species: 'Zapdos-Galar' });
  });

  test('a one-turn forced win reads singular', () => {
    const report = buildGameReport([
      mk(1, 0.05, -0.3),
      mk(2, -0.3, -0.5, { p2: { playedRaw: null, played: null, best: null, safe: null, regret: 0, forcedWin: { turns: 1, mass: 1, caveat: 'none', announce: true } } }),
      mk(3, -0.5, -0.8),
    ], names, 'p2');
    expect(report.summary).toContain('every reply lost within 1 turn.');
  });

  test('a forced win below the spoken mass stays silent', () => {
    const report = buildGameReport([
      mk(1, 0.05, -0.3),
      mk(2, -0.3, -0.5, { p2: { playedRaw: null, played: null, best: null, safe: null, regret: 0, forcedWin: { turns: 3, mass: 0.85, caveat: 'none', announce: true } } }),
      mk(3, -0.5, -0.8),
    ], names, 'p2');
    expect(report.summary).not.toContain('forced');
    expect(report.conversion).toBeUndefined();
    // With the conversion muted nothing else explains this game — the
    // close-game fallback takes over.
    expect(report.summary).toContain('No single edge decided it');
  });

  test('the loser\'s decided or forced signals never become the conversion', () => {
    const report = buildGameReport([
      mk(1, 0.05, -0.3),
      mk(2, -0.3, -0.5, { p1: { playedRaw: null, played: null, best: null, safe: null, regret: 0, decided: { species: 'Garchomp', announce: true }, forcedWin: { turns: 2, mass: 1, caveat: 'none', announce: true } } }),
      mk(3, -0.5, -0.8),
    ], names, 'p2');
    expect(report.summary).not.toContain('Garchomp');
    expect(report.conversion).toBeUndefined();
    expect(report.summary).toContain('No single edge decided it');
  });

  test('the tip names the winner\'s paid-off read on the turning point', () => {
    const report = buildGameReport([
      mk(1, 0.1, 0.05),
      mk(2, 0.05, -0.3, {
        attribution: 'p2-read',
        p2: {
          playedRaw: null,
          played: ranked('move flipturn', 'Flip Turn', -0.2),
          best: ranked('move safe', 'Safe', 0.1),
          safe: null,
          regret: 0.1,
          riskUnpunished: true,
          riskPayoff: 0.3,
          riskPaidOff: true,
        },
      }),
      mk(3, -0.3, -0.5),
      mk(4, -0.5, -0.8),
    ], names, 'p2');
    expect(report.summary).toContain('tipped for good on turn 2, when Beta\'s read (Flip Turn) paid off.');
    // A spoken win-path factor takes over the explaining: the clean-play
    // sentence keeps its praise but drops its matchup-and-variance tail.
    expect(report.summary).toContain('Alpha\'s play was clean.');
    expect(report.summary).not.toContain('matchup and variance');
  });

  test('the tip names a roll that went the winner\'s way', () => {
    const report = buildGameReport([
      mk(1, 0.1, 0.05),
      mk(2, 0.05, -0.3, { attribution: 'chance', chanceDelta: -0.35 }),
      mk(3, -0.3, -0.5),
      mk(4, -0.5, -0.8),
    ], names, 'p2');
    expect(report.summary).toContain('tipped for good on turn 2, on a roll that went Beta\'s way.');
  });

  test('luck toward the winner reads as the deciding factor and replaces the luck line', () => {
    const report = buildGameReport([
      mk(1, 0.1, -0.15, { attribution: 'chance', chanceDelta: -0.3 }),
      mk(2, -0.15, -0.35, { attribution: 'chance', chanceDelta: -0.2 }),
      mk(3, -0.35, -0.6),
      mk(4, -0.6, -0.85),
    ], names, 'p2');
    // t2's roll is past the favor boundary (resolution) — only t1 is luck.
    expect(report.summary).toContain('The rolls decided it — luck ran Beta\'s way overall (+15%).');
    expect(report.summary).not.toContain('Luck ran');
    expect(report.winPath).toEqual({ factor: 'variance', size: 0.3 });
  });

  // Characterization pin: this scenario must stay EXACTLY as before the
  // win-reason round — seeds tell the decisions story, the luck line stays
  // p1-framed (luck ran toward the loser), and no new sentence fires.
  test('luck toward the loser keeps the plain luck line and seeds mute the giveaway sentence', () => {
    const report = buildGameReport([
      mk(1, 0.1, 0.4, { attribution: 'chance', chanceDelta: 0.3 }),
      mk(2, 0.4, -0.4, {
        attribution: 'p1-decision',
        p1: {
          playedRaw: null,
          played: ranked('move scald', 'Scald', -0.4),
          best: ranked('switch 3', '→ Dragapult', 0.0),
          safe: null,
          regret: 0.4,
          tier: 'blunder' as const,
        },
      }),
      mk(3, -0.4, -0.7),
      mk(4, -0.7, -0.9),
    ], names, 'p2');
    expect(report.summary).toContain('Luck ran for Alpha overall (+15%).');
    expect(report.summary).toContain('seeds of the loss');
    expect(report.summary).not.toContain('small steps');
  });

  test('accumulated small giveaways are named when no single seed exists', () => {
    const bleed = () => ({ playedRaw: null, played: null, best: null, safe: null, regret: 0.1 });
    const report = buildGameReport([
      mk(1, 0.05, -0.1, { p1: bleed() }),
      mk(2, -0.1, -0.25, { p1: bleed() }),
      mk(3, -0.25, -0.4, { p1: bleed() }),
      mk(4, -0.4, -0.55, { p1: bleed() }),
      mk(5, -0.55, -0.7, { p1: bleed() }),
    ], names, 'p2');
    expect(report.summary).toContain('Alpha gave it away in small steps');
    expect(report.summary).toContain('−25%');
    expect(report.summary).toContain('next to nothing');
    expect(report.winPath).toEqual({ factor: 'decisions', size: 0.5 });
  });

  test('the winner\'s paid-off reads carry the win when they are the biggest edge', () => {
    const read = (label: string, choiceStr: string, payoff: number) => ({
      playedRaw: null,
      played: ranked(choiceStr, label, -0.1),
      best: ranked('move safe', 'Safe', 0.0),
      safe: null,
      regret: 0.05,
      riskUnpunished: true,
      riskPayoff: payoff,
      riskPaidOff: true,
    });
    const report = buildGameReport([
      mk(1, 0.1, -0.12, { p2: read('Flip Turn', 'move flipturn', 0.15) }),
      mk(2, -0.12, -0.3, { p2: read('→ Heatran', 'switch 4', 0.1) }),
      mk(3, -0.3, -0.55),
      mk(4, -0.55, -0.8),
    ], names, 'p2');
    expect(report.summary).toContain('Beta won it on reads: Flip Turn on turn 1 (+8%) and switching to Heatran on turn 2 (+5%).');
    expect(report.winPath).toEqual({ factor: 'reads', size: 0.25 });
  });

  test('a steady decision-led climb reads as the winner building it, hard-to-spot plays named', () => {
    // Scores stay clear of 0 mid-slide — a float-exact zero crossing would
    // move the favor boundary a turn early and shrink the window.
    const step = (turn: number, before: number): TurnAnalysis => mk(turn, before, before - 0.05, {
      decisionDelta: -0.04,
      chanceDelta: -0.01,
    });
    const narrow = () => ({
      playedRaw: null,
      played: ranked('move a', 'A', 0.1),
      best: ranked('move a', 'A', 0.1),
      safe: null,
      regret: 0,
      choiceCount: 5,
      viableCount: 1,
    });
    const analyses = [
      mk(1, 0.36, 0.31),
      ...[2, 3, 4, 5, 6, 7, 8].map(turn => step(turn, 0.31 - (turn - 2) * 0.05)),
      mk(9, -0.04, -0.1),
      mk(10, -0.1, -0.15),
      mk(11, -0.15, -0.2),
    ];
    analyses[2] = { ...analyses[2], p2: narrow() };
    analyses[4] = { ...analyses[4], p2: narrow() };
    analyses[5] = {
      ...analyses[5],
      p2: {
        playedRaw: null,
        played: ranked('switch 4', '→ Heatran', 0.0),
        best: ranked('move safe', 'Safe', 0.05),
        safe: null,
        regret: 0.02,
        riskUnpunished: true,
        riskPayoff: 0.12,
        riskPaidOff: true,
      },
    };
    const report = buildGameReport(analyses, names, 'p2');
    expect(report.summary).toContain('Beta built it step by step from turn 1');
    expect(report.summary).toContain('+20% across 8 turns');
    expect(report.summary).toContain('hard to spot');
    expect(report.summary).toContain('2 turns where only one line held');
    expect(report.summary).toContain('switching to Heatran');
    expect(report.winPath?.factor).toBe('grind');
    expect(report.winPath?.size).toBeCloseTo(0.28, 10);
  });

  test('a chance-led climb stays a variance story, not a grind', () => {
    const step = (turn: number, before: number): TurnAnalysis => mk(turn, before, before - 0.05, {
      decisionDelta: -0.01,
      chanceDelta: -0.04,
    });
    const report = buildGameReport([
      mk(1, 0.36, 0.31),
      ...[2, 3, 4, 5, 6, 7, 8].map(turn => step(turn, 0.31 - (turn - 2) * 0.05)),
      mk(9, -0.04, -0.1),
      mk(10, -0.1, -0.15),
      mk(11, -0.15, -0.2),
    ], names, 'p2');
    expect(report.summary).toContain('The rolls decided it');
    expect(report.summary).not.toContain('step by step');
  });

  test('a tipped game with no detectable edge falls back to the close-game sentence', () => {
    const report = buildGameReport([
      mk(1, 0.2, 0.1),
      mk(2, 0.1, -0.2),
      mk(3, -0.2, -0.5),
      mk(4, -0.5, -0.7),
    ], names, 'p2');
    expect(report.summary).toContain('No single edge decided it — Beta converted a close game turn by turn.');
    expect(report.winPath).toEqual({ factor: 'close', size: 0 });
  });

  test('without played tracking the conversion still speaks', () => {
    const report = buildGameReport([
      mk(1, 0.05, -0.3),
      mk(2, -0.3, -0.5, { p2: { playedRaw: null, played: null, best: null, safe: null, regret: 0, decided: { species: 'Kyurem-White', announce: true } } }),
      mk(3, -0.5, -0.8),
    ], names, 'p2', false);
    expect(report.summary).toContain('From turn 2, Kyurem-White cleared everything Alpha had left.');
    expect(report.summary).not.toContain('clean');
  });

  test('a wire-to-wire lead names the starting matchup when it was lopsided', () => {
    const report = buildGameReport([
      mk(1, -0.5, -0.6),
      mk(2, -0.6, -0.75),
      mk(3, -0.75, -0.9),
    ], names, 'p2');
    expect(report.summary).toContain('start to finish');
    expect(report.summary).toContain('72% matchup from the start');
  });
});

test.describe('null-swapped recommendations (round 5)', () => {
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
