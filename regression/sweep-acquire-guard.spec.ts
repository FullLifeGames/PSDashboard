import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { buildTeamsFromReplay } from '../src/lib/team-builder';
import {
  reconstructBranchRuntime, reconstructionReached, validateBranchRuntime,
  type BranchRuntime,
} from '../src/lib/branch-engine';
import { getBranchSimulatorFormat } from '../src/lib/replay-format';
import { parseReplayLogWithObservations } from '../src/lib/protocol-parser';

/**
 * The sweep's single-pass acquisition stores the reconstruction's FINAL
 * battle as the last analyzable turn's position. That is only honest when
 * the replay actually GOT there: a diverged choice replay can cascade a
 * side into a wipe (the premature-end family — gen9draft-2058494320 from
 * turn 56 without per-turn healing), and `validateBranchRuntime` passes an
 * ended battle deliberately (it is a legal branch state). Storing that
 * battle as the final turn hands the graph one phantom ±1.00 point at the
 * far right while every other turn stays a gap — the "Analyze game
 * produced an empty graph" report (2026-08-12).
 */

const stub = (battle: unknown, timedOut = false) =>
  ({ battleStream: { battle }, timedOut } as unknown as BranchRuntime);

test.describe('sweep end-position guard', () => {
  test('only a live battle standing at or past the turn may stand in for it', () => {
    expect(reconstructionReached(stub({ turn: 40, ended: false }), 40)).toBe(true);
    expect(reconstructionReached(stub({ turn: 41, ended: false }), 40)).toBe(true);
    // Short of the target: the replay wedged on the way there.
    expect(reconstructionReached(stub({ turn: 12, ended: false }), 40)).toBe(false);
    // ENDED is always an artifact here: a sampled turn is before the real
    // game's end, so an ended arrival means the sim killed a side the real
    // game kept (the harness applies the same invariant when scoring).
    expect(reconstructionReached(stub({ turn: 40, ended: true }), 40)).toBe(false);
    expect(reconstructionReached(stub({ turn: 99, ended: true }), 40)).toBe(false);
    expect(reconstructionReached(stub(null), 40)).toBe(false);
    expect(reconstructionReached(stub({ turn: 40, ended: false }, true), 40)).toBe(false);
  });

  test('the draft replay without healing ends prematurely — valid to branch, unusable as the final position', async () => {
    test.setTimeout(600_000);
    const replay = JSON.parse(readFileSync('e2e/fixtures/draft-replay.json', 'utf-8')) as {
      id: string; format: string; formatid?: string; players: string[]; log: string;
    };
    const { snapshots, observations, speedOrders } = parseReplayLogWithObservations(replay.log);
    const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders });
    const turns = snapshots.length;

    // No capturePositions => no per-turn snapshot healing, the same
    // single-shot route the premature-end cascade was diagnosed on.
    const runtime = await reconstructBranchRuntime({
      format: getBranchSimulatorFormat(replay),
      p1Team, p2Team,
      replayLog: replay.log,
      targetTurn: turns,
      snapshot: snapshots[Math.min(turns - 1, snapshots.length - 1)],
    });
    const battle = runtime.battleStream.battle!;
    expect(battle.ended).toBe(true);
    // The validator deliberately accepts an ended battle — which is exactly
    // why the sweep needed its own guard.
    expect(validateBranchRuntime(runtime)).toBeNull();
    expect(reconstructionReached(runtime, turns)).toBe(false);
  });
});
