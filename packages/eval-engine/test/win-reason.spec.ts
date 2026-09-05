import { test, expect } from '@playwright/test';
import type { TurnAnalysis } from '../src/analysis';
import { diceEventTurns } from '../src/dice-events';
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

test.describe('dice-anchored luck claims', () => {
  // Winner p2; diceTurns marks turns whose protocol carries a visible dice
  // event. The gate is asymmetric: only an actively CONTRADICTING dice
  // ledger (≥ an inaccuracy the other way) demotes the luck claims —
  // damage-roll games without visible events keep their luck story.

  test('the variance claim needs the visible dice to agree', () => {
    // The draft game in miniature: the net chance runs toward the winner,
    // but the only dice turn (a crit) ran against them.
    const report = buildGameReport([
      mk(1, 0.1, 0.35, { attribution: 'chance', chanceDelta: 0.25 }),
      mk(2, 0.35, -0.05, { chanceDelta: -0.36 }),
      mk(3, -0.05, -0.4, { chanceDelta: -0.36 }),
      mk(4, -0.4, -0.7),
    ], names, 'p2', true, new Set([1]));
    expect(report.summary).not.toContain('The rolls decided it');
    expect(report.summary).toContain('Chance swings favored Beta overall (+24%), while the visible dice favored Alpha.');
    expect(report.summary).not.toContain('Luck ran');
    // With variance gated off, nothing else explains this tipped game — the
    // close-game fallback takes over.
    expect(report.winPath).toEqual({ factor: 'close', size: 0 });
  });

  test('dice agreement keeps the rolls story', () => {
    const report = buildGameReport([
      mk(1, 0.1, -0.2, { attribution: 'chance', chanceDelta: -0.3 }),
      mk(2, -0.2, -0.45, { chanceDelta: -0.17 }),
      mk(3, -0.45, -0.7),
    ], names, 'p2', true, new Set([1]));
    expect(report.summary).toContain('The rolls decided it — luck ran Beta\'s way overall (+24%).');
  });

  test('a weak dice anchor leaves the luck claim alone', () => {
    const report = buildGameReport([
      mk(1, 0.1, 0.15, { chanceDelta: 0.05 }),
      mk(2, 0.15, -0.25, { chanceDelta: -0.4 }),
      mk(3, -0.25, -0.5, { chanceDelta: -0.12 }),
      mk(4, -0.5, -0.75),
    ], names, 'p2', true, new Set([1]));
    expect(report.summary).toContain('The rolls decided it');
  });

  test('a contradicted luck line renames itself even without a variance claim', () => {
    // Luck toward the LOSER, dice toward the winner: no variance factor
    // either way, but the luck line must not call it luck.
    const report = buildGameReport([
      mk(1, 0.1, 0.4, { chanceDelta: 0.45 }),
      mk(2, 0.4, -0.3, { attribution: 'chance', chanceDelta: -0.15 }),
      mk(3, -0.3, -0.55),
      mk(4, -0.55, -0.8),
    ], names, 'p2', true, new Set([2]));
    expect(report.summary).toContain('Chance swings favored Alpha overall (+15%), while the visible dice favored Beta.');
    expect(report.summary).not.toContain('Luck ran');
  });

  test('without dice information the claims stay as before', () => {
    const report = buildGameReport([
      mk(1, 0.1, -0.15, { attribution: 'chance', chanceDelta: -0.3 }),
      mk(2, -0.15, -0.4, { chanceDelta: -0.17 }),
      mk(3, -0.4, -0.7),
    ], names, 'p2');
    expect(report.summary).toContain('The rolls decided it');
  });
});

test.describe('dice event turns (protocol classifier)', () => {
  test('crits, misses, chance-cant reasons, and rolled statuses mark a turn', () => {
    const turns = diceEventTurns([
      [],
      ['|-crit|p2a: Steel Shadow'],
      ['|move|p1a: A|Focus Blast|p2a: B|[miss]'],
      ['|cant|p2a: Slow Shadow|flinch'],
      ['|-status|p2a: Ice Shadow|brn|[from] ability: Flame Body|[of] p1a: C'],
      ['|-status|p1a: D|psn'],
    ]);
    expect([...turns].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  test('deterministic sources never mark a turn', () => {
    const turns = diceEventTurns([
      [],
      ['|cant|p2a: Slow Shadow|move: Taunt|Chilly Reception'],
      ['|-status|p2a: Sludge Shadow|slp|[from] move: Rest'],
      ['|-status|p1a: A|brn|[from] item: Flame Orb'],
      ['|move|p1a: A|Tackle|p2a: B', '|-damage|p2a: B|50/100'],
    ]);
    expect(turns.size).toBe(0);
  });
});

