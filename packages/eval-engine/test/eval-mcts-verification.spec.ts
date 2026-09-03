import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { State } from '@pkmn/sim';
import { buildTeamsFromReplay, formatEnforcesSleepClause, getBranchSimulatorFormat, parseReplayLogWithObservations } from '@fulllifegames/replay-core';
import { reconstructBranchRuntime } from '../src/branch-engine';
import { createLocalExecutor } from '../src/search';
import { mctsTreeSearch } from '../src/mcts';
import { mergeMctsTrees, MCTS_TREES, starvedSupportCells } from '../src/mcts-merge';
import { cellKey } from '../src/rank';

/**
 * Starved-support verification on a REAL position — the draft game's t56
 * (user report 2026-08-11: branching after t55 with Draco Meteor made the
 * auto-opponent switch Mienshao into the nuke and keep sacking, "like it's
 * actually searching for the worst move").
 *
 * The mechanism: a root cell fixes ONE chance outcome per tree, so pooled
 * visit counts measure subtree exploration, not independent transition
 * samples — [Ice Beam × Draco Meteor] carried per-tree means of
 * −0.38/+0.37/−0.34/−0.37 (one tree rode a missed 90% Draco Meteor), and
 * the equilibrium solve chased the phantom: p2's Draco Meteor ev inflated
 * to 0.445 (matrix: 0.208) and p1's healthy-Mienshao sack ranked second.
 * The synthetic mechanism pins live in eval-search.spec.ts ("starved
 * support cells..."); this spec pins the end-to-end app path (4 trees →
 * merge → starved-support selection → matrix-grade cell verification →
 * re-merge) on the position that caught it.
 */

test.describe('mcts starved-support verification (draft t56)', () => {
  test('verification demotes the chance-phantom sack and restores the real punisher order', async () => {
    test.setTimeout(600_000);
    const replay = JSON.parse(readFileSync(new URL('./fixtures/draft-replay.json', import.meta.url), 'utf-8')) as {
      id: string; format: string; formatid?: string; players: string[]; log: string;
    };
    const { snapshots, observations, speedOrders } = parseReplayLogWithObservations(replay.log);
    const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders });

    // The app's branch path heals divergence with per-turn snapshot
    // corrections — the same route the user took to stand at t56.
    let serialized: string | null = null;
    await reconstructBranchRuntime({
      format: getBranchSimulatorFormat(replay),
      p1Team, p2Team,
      replayLog: replay.log,
      targetTurn: 57,
      snapshot: snapshots[Math.min(56, snapshots.length - 1)],
      capturePositions: {
        snapshotFor: turn => snapshots[Math.min(turn - 1, snapshots.length - 1)] ?? null,
        onPosition: (turn, battle) => {
          if (turn === 56 && !battle.ended) serialized = JSON.stringify(State.serializeBattle(battle));
        },
      },
    });
    expect(serialized).toBeTruthy();

    const sleepClause = formatEnforcesSleepClause(getBranchSimulatorFormat(replay));
    const settings = { depth: 1 as const, samples: 1 as const, tera: false, sleepClause, mode: 'mcts' as const };
    const trees = Array.from({ length: MCTS_TREES }, (_, offset) => mctsTreeSearch(serialized!, settings, offset));
    const merged = mergeMctsTrees(trees);

    // The selection must fire here: the support cells carry at most four
    // independent chance outcomes and the Draco column disagrees.
    const jobs = starvedSupportCells(trees, merged);
    expect(jobs.length).toBeGreaterThan(0);

    const values = await createLocalExecutor(serialized!).evalCells(jobs);
    const verified = mergeMctsTrees(trees, new Map(values.map(value => [cellKey(value.i, value.j), value])));

    // The sack is out of the auto-opponent's top picks (unverified it sat
    // second at three thousandths behind the top).
    const p1Top3 = verified.perSide.p1.slice(0, 3).map(entry => entry.label);
    expect(p1Top3).not.toContain('→ Mienshao');

    // p2's phantom Draco inflation is gone: Shadow Ball outranks Draco
    // Meteor again (matrix d2s3 reference: 0.535 vs 0.208).
    const p2Labels = verified.perSide.p2.map(entry => entry.label);
    expect(p2Labels.indexOf('Shadow Ball')).toBeLessThan(p2Labels.indexOf('Draco Meteor'));

    // HYBRID invariant on a real position: verification refines rankings,
    // never the recorded score line.
    expect(verified.score).toBeCloseTo(merged.score, 10);
  });
});
