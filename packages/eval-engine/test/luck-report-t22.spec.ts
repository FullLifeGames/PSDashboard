import { test, expect, describe } from 'vitest';
import type { SideAnalysis, TurnAnalysis } from '../src/analysis';
import { buildGameReport } from '../src/report';

/**
 * Round 67 (T22 stage a): the game report splits the luck ledger into what
 * the turns rolled (a roll in the residual's direction, rolledFor) and what
 * the engine re-read. "The rolls decided it" needs the rolled part to point
 * the ledger's way and hold at least half of it (649664 on the base: 38%);
 * otherwise the luck line names both parts. The tip and denied-end clauses
 * read the same rolls. Without rolledFor the report keeps its anchor gates.
 */

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

describe('T22 report: the luck ledger in two parts', () => {
  test('649664 shape: the rolls hold under half of the ledger, so no "The rolls decided it" and the luck line names the re-read', () => {
    // The big swing sits before the favor boundary (turn 4), so it stays in the ledger.
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
    expect(report.summary).toContain('Chance swings favored Alpha overall (+40%): the rolls gave Alpha +15%, and the engine re-read the position for +25%.');
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

  test('573756 shape: the rolls went the other way, the luck line says what they cost', () => {
    const report = buildGameReport([
      mk(1, 0.1, 0.3, { chanceDelta: 0.24, rolledFor: forP1 }),
      mk(2, 0.3, -0.4, { attribution: 'chance', chanceDelta: -0.7, rolledFor: forP1 }),
      mk(3, -0.4, -0.8, { chanceDelta: -0.6, rolledFor: none }),
      mk(4, -0.8, -0.9, { rolledFor: none }),
    ], names, 'p2');
    expect(report.summary).not.toContain('The rolls decided it');
    expect(report.summary).toContain('Chance swings favored Beta overall (+53%): the rolls cost Beta 12%, and the engine re-read the position for +65%.');
  });

  test('doubles (2663093831 shape): luck toward the loser, under half rolled, names the re-read', () => {
    const pair = sideOf({ playedSlots: [{ kind: 'move', name: 'Heat Wave', targetLoc: null }, { kind: 'move', name: 'Protect', targetLoc: null }] });
    const report = buildGameReport([
      mk(1, 0, 0.3, { p1: pair, p2: pair, chanceDelta: 0.35, rolledFor: none }),
      mk(2, 0.3, 0.2, { p1: pair, p2: pair, chanceDelta: 0.15, rolledFor: forP1 }),
      mk(3, 0.2, -0.6, { p1: pair, p2: pair, rolledFor: none }),
      mk(4, -0.6, -0.9, { p1: pair, p2: pair, rolledFor: none }),
    ], names, 'p2');
    expect(report.summary).toContain('Chance swings favored Alpha overall (+25%): the rolls gave Alpha +8%, and the engine re-read the position for +18%.');
    expect(report.summary).not.toContain('Luck ran');
  });

  test('a ledger without a single roll says the rolls gave nothing', () => {
    const report = buildGameReport([
      mk(1, 0, 0.4, { chanceDelta: 0.4, rolledFor: none }),
      mk(2, 0.4, 0.8, { rolledFor: none }),
    ], names, 'p1');
    expect(report.summary).toContain('Chance swings favored Alpha overall (+20%): the rolls gave Alpha nothing, and the engine re-read the position for +20%.');
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

describe('T22 report: the tip and the denied end read the same rolls', () => {
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
    const near = { species: 'Garchomp', odds: 0.95, removes: 'Corviknight', announce: true };
    const turns = (rolledFor: { p1: boolean; p2: boolean }) => [
      mk(1, -0.5, 0.1, { attribution: 'chance', chanceDelta: 0.4, p2: sideOf({ nearDecided: near }), rolledFor }),
      ...Array.from({ length: 9 }, (_, index) => mk(index + 2, 0.1, -0.2 - index * 0.08, { rolledFor: none })),
    ];
    expect(buildGameReport(turns(forP1), names, 'p2', true, new Set([1])).deniedEnd?.turn).toBe(1);
    expect(buildGameReport(turns(forP2), names, 'p2', true, new Set([1])).deniedEnd).toBeUndefined();
  });
});
