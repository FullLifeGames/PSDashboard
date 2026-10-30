import { describe, expect, test } from 'vitest';
import { createRootPosition, legalChoices } from '../src/forward-model';
import { replacementRounds } from '../src/replacement-rounds';
import { reconstructWithPoints } from './replacement-points';

/**
 * Round 79 (T290): the capture hook of the replacement points. The reconstruction hands out the battle at every open forced
 * request of the knockout's block, read-only, before the replay answers it. The hook never changes the replay: the boundary
 * positions and the final position are byte-identical with and without it.
 */

describe('onReplacement: the hook at the open request', () => {
  test('doubles: every point is an open request, read twice with the same bytes', { timeout: 240000 }, async () => {
    const run = await reconstructWithPoints('gen9doublesou-2694811367');
    const rounds = replacementRounds(run.replay.log);
    expect(rounds.length).toBeGreaterThan(0);
    expect(run.points.length).toBeGreaterThan(0);
    for (const { point, serialized, serializedAgain } of run.points) {
      // Read-only: reading it twice gives the same bytes, and the request is still open when the hook fires.
      expect(serializedAgain).toBe(serialized);
      // The serialized battle is the open request: a side with forced slots lists switches, a waiting side the wait sentinel.
      const root = createRootPosition(serialized);
      for (const side of ['p1', 'p2'] as const) {
        const choices = legalChoices(root, side).map(option => option.choice);
        if (point.forced[side].length === 0) expect(choices).toEqual(['wait']);
        else expect(choices.every(choice => choice.split(', ').some(part => part.startsWith('switch') || part === 'pass'))).toBe(true);
      }
    }
  });

  test('singles: the point names the knockout turn, the slot and the species the replay sent in', { timeout: 240000 }, async () => {
    const run = await reconstructWithPoints('gen9ou-2658662321');
    const rounds = replacementRounds(run.replay.log);
    expect(rounds.length).toBeGreaterThan(0);
    const first = run.points[0].point;
    expect(first.turn).toBe(rounds[0].turn);
    expect(first.ordinal).toBe(0);
    const side = first.forced.p1.length > 0 ? 'p1' : 'p2';
    expect(first.forced[side]).toEqual([0]);
    expect(first.played[side]).toEqual(rounds[0].species[side]);
  });

  test.each(['gen9doublesou-2694811367', 'gen9ou-2658662321'])('%s: the hook changes no position', { timeout: 480000 }, async fixture => {
    const withHook = await reconstructWithPoints(fixture);
    const without = await reconstructWithPoints(fixture, { hook: false });
    expect(withHook.points.length).toBeGreaterThan(0);
    expect(without.points.length).toBe(0);
    expect([...withHook.positions.keys()]).toEqual([...without.positions.keys()]);
    for (const [turn, serialized] of without.positions) expect(withHook.positions.get(turn)).toBe(serialized);
    expect(withHook.final).toBe(without.final);
    expect(withHook.runtime.log).toEqual(without.runtime.log);
  });
});
