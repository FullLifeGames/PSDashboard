import { test, expect } from '@playwright/test';
import { State } from '@pkmn/sim';
import { buildTeamsFromReplay } from '../src/lib/team-builder';
import { reconstructBranchRuntime } from '../src/lib/branch-engine';
import { getBranchSimulatorFormat } from '../src/lib/replay-format';
import { parseReplayLog } from '../src/lib/protocol-parser';
import { searchPosition } from '../src/lib/eval/search';

/**
 * Informational calibration run against real finished replays: does the
 * score's sign predict the actual winner, and how does confidence grow over
 * the game? Not a CI gate — network + ~2 minutes of reconstruction.
 * Run: EVAL_CALIBRATION=1 npx playwright test -c playwright.regression.config.ts eval-calibration
 */
const REPLAY_IDS = [
  'gen9draft-2058494320',
  'gen9draft-2298735122',
  'gen3customgame-2115579570',
];

interface Sample {
  phase: 'early' | 'mid' | 'late';
  score: number;
  p1Won: boolean;
}

test.describe('eval calibration against real replays', () => {
  test.skip(!process.env.EVAL_CALIBRATION, 'set EVAL_CALIBRATION=1 to run the calibration sweep');

  test('score sign tracks the actual winner', async () => {
    test.setTimeout(600_000);
    const samples: Sample[] = [];

    for (const id of REPLAY_IDS) {
      const response = await fetch(`https://replay.pokemonshowdown.com/${id}.json`);
      if (!response.ok) {
        console.log(`skipping ${id}: HTTP ${response.status}`);
        continue;
      }
      const replay = await response.json() as { id: string; log: string; players: string[] };
      const winnerName = replay.log.match(/^\|win\|(.+)$/m)?.[1]?.trim();
      if (!winnerName) {
        console.log(`skipping ${id}: no winner line`);
        continue;
      }
      const p1Won = winnerName === replay.players[0];
      const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, {});
      if (p1Team.length === 0 || p2Team.length === 0) {
        console.log(`skipping ${id}: could not build teams`);
        continue;
      }
      const snapshots = parseReplayLog(replay.log);
      const maxTurn = snapshots.length;
      const step = Math.max(1, Math.ceil(maxTurn / 8));

      for (let turn = 2; turn < maxTurn; turn += step) {
        try {
          const runtime = await reconstructBranchRuntime({
            format: getBranchSimulatorFormat(replay),
            p1Team, p2Team,
            replayLog: replay.log,
            targetTurn: turn,
            snapshot: snapshots[Math.min(turn - 1, snapshots.length - 1)],
          });
          const battle = runtime.battleStream.battle;
          if (!battle) continue;
          const serialized = JSON.stringify(State.serializeBattle(battle));
          const { score } = searchPosition(serialized, { depth: 1, samples: 1, tera: false });
          const fraction = turn / maxTurn;
          samples.push({
            phase: fraction < 1 / 3 ? 'early' : fraction < 2 / 3 ? 'mid' : 'late',
            score,
            p1Won,
          });
        } catch (error) {
          console.log(`${id} turn ${turn}: ${error instanceof Error ? error.message : error}`);
        }
      }
      console.log(`${id}: sampled (winner: ${winnerName})`);
    }

    for (const phase of ['early', 'mid', 'late'] as const) {
      const inPhase = samples.filter(sample => sample.phase === phase);
      if (inPhase.length === 0) continue;
      const correct = inPhase.filter(sample => (sample.score > 0) === sample.p1Won).length;
      const meanAbs = inPhase.reduce((sum, sample) => sum + Math.abs(sample.score), 0) / inPhase.length;
      console.log(
        `${phase}: n=${inPhase.length} sign-accuracy=${(100 * correct / inPhase.length).toFixed(0)}% ` +
        `mean|score|=${meanAbs.toFixed(2)}`,
      );
    }
    expect(samples.length).toBeGreaterThan(0);
  });
});
