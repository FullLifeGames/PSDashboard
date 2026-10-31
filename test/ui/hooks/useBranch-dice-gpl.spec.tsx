import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, renderHook } from '@testing-library/react';
import { buildTeamsFromReplay, getBranchSimulatorFormat, parseReplayLogWithObservations } from '@fulllifegames/replay-core';
import type { ForcedDie } from '@fulllifegames/eval-engine';
import { useBranch } from '../../../src/hooks/useBranch';
import { branchFrameLog } from '../../../src/lib/branch-log';
import { parseExportedReplay } from '../../../src/lib/replay-file';

/**
 * Round 82 (forced dice), criterion 5 without a browser: the draft league replay DzBQ5azlO5l, turn 13. Noivern's Air Slash left
 * Cobalion's flinch undrawn in the game. The user picks the chip "Flinch" (which pulls the hit, decision 5a) and executes: the
 * branch's log shows Cobalion flinching ("King Bradley" in this game), and the frame log carries the mark before it. The e2e spec
 * `test/e2e/branch-dice-flinch.spec.ts` plays the same scene through the browser.
 */
const replay = parseExportedReplay(readFileSync(join('test', 'e2e', 'fixtures', 'gpl-replay-DzBQ5azlO5l.html'), 'utf-8'), 'gpl-replay-DzBQ5azlO5l.html');

describe('GPL DzBQ5azlO5l turn 13, Air Slash with a forced flinch', () => {
  const hit: ForcedDie = { name: { slot: 'p1a', moveId: 'airslash', targetSlot: 'p2a', kind: 'accuracy' }, result: { happens: true } };
  const flinch: ForcedDie = { name: { slot: 'p1a', moveId: 'airslash', targetSlot: 'p2a', kind: 'secondary', effectId: 'flinch' }, result: { happens: true } };

  test('the branch log shows Cobalion flinching, and the frame log carries the mark before it', async () => {
    const { snapshots, observations } = parseReplayLogWithObservations(replay.log);
    const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations });
    const { result } = renderHook(() => useBranch());
    await act(async () => {
      await result.current.startBranch(getBranchSimulatorFormat(replay), p1Team, p2Team, replay.log, 13, snapshots[12] ?? null, {
        playerNames: [replay.players[0], replay.players[1]],
        snapshotFor: (boundary: number) => snapshots[boundary - 1] ?? null,
      });
    });
    const before = result.current.simState!;
    const move = (name: string, moves: typeof before.p1MovesBySlot) => moves[0].find(option => option.name === name)!;
    act(() => {
      result.current.setChoice('p1', { kind: 'move', moveId: 'airslash', moveName: 'Air Slash', dice: [hit, flinch] }, 0);
      result.current.setChoice('p2', { kind: 'move', moveId: 'heavyslam', moveName: move('Heavy Slam', before.p2MovesBySlot).name }, 0);
    });
    await act(async () => { await result.current.executeTurn(); });
    expect(result.current.executeError).toBeNull();
    const entry = result.current.history[0];
    expect(entry.diceReport!.forced.map(report => [report.die.name.kind, report.took])).toEqual([['accuracy', 'applied'], ['secondary', 'applied']]);
    expect(entry.dieLines!.map(line => line.text)).toEqual([expect.stringMatching(/^Forced: Air Slash hits, /), 'Forced: Air Slash flinch, 30 %']);
    const frame = branchFrameLog(result.current.simState!.log, result.current.history.flatMap(item => item.dieLines ?? [])).split('\n');
    const mark = frame.indexOf('|-message|Forced: Air Slash flinch, 30 %');
    const cant = frame.findIndex(line => line.startsWith('|cant|p2a: King Bradley|flinch'));
    expect(mark).toBeGreaterThanOrEqual(0);
    expect(cant).toBeGreaterThan(mark);
    // Cobalion never reached Heavy Slam: the forced flinch took the move from the game's log
    expect(frame.some(line => line.startsWith('|move|p2a: King Bradley|Heavy Slam'))).toBe(false);
  }, 180_000);
});
