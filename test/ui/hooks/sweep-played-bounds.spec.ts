import { describe, expect, test } from 'vitest';
import { logRules } from '@fulllifegames/replay-core';
import type { EvalResult, PlayedBounds, PlayedTurn, RankedChoice } from '@fulllifegames/eval-engine';
import { matchOrPhantom } from '../../../src/hooks/evaluation/sweep-types';

/**
 * Round 89 (#108, C4b): the sweep's played-pair match (a fresh result, a cache hit's backfill, the verify and sensitivity probes all call
 * `matchOrPhantom`) reads the order bound the result carries. A result stored before the field existed has none and matches as before.
 * The store keeps the result by structured clone (IndexedDB), so the clone below is the cache hit.
 */
const row = (choice: string, label: string, ev: number): RankedChoice => ({ choice, label, worstCase: ev, expected: ev, ev, punishedBy: 'Reply' });
const rules = logRules('');

const DOUBLES = [
  row('move extremespeed 1, move flashcannon 1', 'Extreme Speed→Floette + Flash Cannon→Floette', 0.9),
  row('switch 3, move flashcannon 1', '→ Sylveon + Flash Cannon→Floette', 0.95),
  row('move dragonpulse 1, move flashcannon 1', 'Dragon Pulse→Floette + Flash Cannon→Floette', 0.5),
];
const doublesBound: PlayedBounds = { p1: [{ moves: ['extremespeed'], switchOut: true }, null] };
const doublesPlayed: PlayedTurn = {
  p1: null, p2: null, p1Slots: [null, { kind: 'move', name: 'Flash Cannon', tera: false, targetLoc: 1 }],
  p2Slots: [{ kind: 'move', name: 'Dazzling Gleam', tera: false, targetLoc: null }, null],
};
const doublesResult = (playedBounds?: PlayedBounds): EvalResult => ({
  score: 0, interval: 0, depthCompleted: 1, perSide: { p1: DOUBLES, p2: [] }, ...(playedBounds ? { playedBounds } : {}),
});

const SINGLES = [row('move partingshot', 'Parting Shot', 0.4), row('move lowkick', 'Low Kick', 0.3), row('move gunkshot', 'Gunk Shot', 0.2)];
const singlesBound: PlayedBounds = { p1: [{ moves: ['partingshot'], switchOut: true }] };
const singlesPlayed: PlayedTurn = { p1: null, p2: { kind: 'move', name: 'Psyshock', tera: false, targetLoc: null }, prevented: { p1: 'faint' } };
const singlesResult = (playedBounds?: PlayedBounds): EvalResult => ({
  score: 0, interval: 0, depthCompleted: 1, perSide: { p1: SINGLES, p2: [row('move psyshock', 'Psyshock', 0)] }, ...(playedBounds ? { playedBounds } : {}),
});

describe('doubles (Doubles OU and VGC share the slot match)', () => {
  test('the bound moves the played row off a move the order rules out', () => {
    expect(matchOrPhantom(doublesResult(), 'p1', doublesPlayed, rules)?.choice).toBe('switch 3, move flashcannon 1');
    expect(matchOrPhantom(doublesResult(doublesBound), 'p1', doublesPlayed, rules)?.choice).toBe('move dragonpulse 1, move flashcannon 1');
  });

  test('a cache hit (the stored clone) matches like the fresh result, and an entry from before matches as it did', () => {
    const fresh = doublesResult(doublesBound);
    expect(matchOrPhantom(structuredClone(fresh), 'p1', doublesPlayed, rules)?.choice).toBe(matchOrPhantom(fresh, 'p1', doublesPlayed, rules)?.choice);
    const old = structuredClone(fresh) as Partial<EvalResult>;
    delete old.playedBounds;
    expect(matchOrPhantom(old as EvalResult, 'p1', doublesPlayed, rules)?.choice).toBe('switch 3, move flashcannon 1');
  });
});

describe('singles', () => {
  test('the stay-in phantom is the first move the bound leaves', () => {
    expect(matchOrPhantom(singlesResult(), 'p1', singlesPlayed, rules)?.choice).toBe('move partingshot');
    expect(matchOrPhantom(singlesResult(singlesBound), 'p1', singlesPlayed, rules)).toMatchObject({ choice: 'move lowkick', label: 'stayed in (KO’d before acting)' });
  });

  test('a cache hit and an entry from before, as in doubles', () => {
    expect(matchOrPhantom(structuredClone(singlesResult(singlesBound)), 'p1', singlesPlayed, rules)?.choice).toBe('move lowkick');
    const old = structuredClone(singlesResult(singlesBound)) as Partial<EvalResult>;
    delete old.playedBounds;
    expect(matchOrPhantom(old as EvalResult, 'p1', singlesPlayed, rules)?.choice).toBe('move partingshot');
  });
});
