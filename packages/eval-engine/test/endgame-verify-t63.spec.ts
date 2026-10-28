import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { PokemonSet } from '@pkmn/sim';
import { getBranchSimulatorFormat, parseReplayLog, type ReplayData } from '@fulllifegames/replay-core';
import { requiredChoicesForActiveSlots, type BranchSlotChoice } from '../src/branch-choices';
import { executeBranchChoices, resolveSideChoices } from '../src/branch/execute';
import { reconstructBranchRuntime } from '../src/branch/runtime';
import { serializeLiveBattle } from '../src/serialize';
import { createLocalTreeExecutor, searchTreesOrchestrated } from '../src/tree-orchestrator';
import { loadSimModsFor } from '../src/forward/sim-mods';

const replay = JSON.parse(readFileSync(new URL('./fixtures/draft-replay.json', import.meta.url), 'utf8')) as ReplayData;
const variation = JSON.parse(readFileSync(new URL('./fixtures/draft-t63-variation.json', import.meta.url), 'utf8')) as {
  startTurn: number; p1Team: PokemonSet[]; p2Team: PokemonSet[];
  history: { p1?: BranchSlotChoice; p2?: BranchSlotChoice }[];
};

/** The variation of the user's state file, replayed onto a rebuild of turn 54 the way the app replays a saved variation. */
async function turn63(): Promise<string> {
  const snapshots = parseReplayLog(replay.log);
  const runtime = await reconstructBranchRuntime({
    format: getBranchSimulatorFormat(replay), p1Team: variation.p1Team, p2Team: variation.p2Team, replayLog: replay.log,
    targetTurn: variation.startTurn, snapshot: snapshots.find(entry => entry.turn === variation.startTurn) ?? null,
    playerNames: [replay.players[0], replay.players[1]],
  });
  const battle = runtime.battleStream.battle!;
  for (const entry of variation.history) {
    const commands: { side: 'p1' | 'p2'; command: string }[] = [];
    for (const [index, side] of (['p1', 'p2'] as const).entries()) {
      const choice = entry[side];
      if (!choice) continue;
      const sideState = battle.sides[index];
      const forced = sideState.active.map((_, slot) => sideState.activeRequest?.forceSwitch?.[slot] ?? false);
      const resolved = resolveSideChoices(battle, side, [choice], requiredChoicesForActiveSlots(sideState.active, forced));
      if (!resolved.ok) throw new Error(resolved.error);
      commands.push({ side, command: resolved.command });
    }
    const result = await executeBranchChoices({ streams: runtime.streams, log: runtime.log, choiceErrors: runtime.choiceErrors, commands });
    if (!result.ok) throw new Error(result.error);
  }
  return serializeLiveBattle(battle);
}

describe('an endgame keeps the trees\' verdict (round 77, T267)', () => {
  test('draft 2058494320, variation turn 63: the lines agree with the score, and the advice is an attack, not U-turn', { timeout: 300_000 }, async () => {
    // User report 28.10.2026: Mienshao (Choice Scarf, locked into Close Combat) and Kyurem at 48 % against Dragapult at
    // 45 % (Choice Specs) and Muk-Alola. The panel read "puffelmaedchen 15 % · Bene 85 %" above lines that advised
    // U-turn for Bene at 16 %: the trees saw Bene winning, the verify round re-priced Kyurem's row with the one-ply
    // sampler (84 to 93 % for P1), and the floor of 0.9 kept the sampler. The replay never terastallized (Tera Auto bans it).
    const serialized = await turn63();
    const result = await searchTreesOrchestrated(createLocalTreeExecutor(serialized), { depth: 1, samples: 1, mode: 'mcts', tera: false });
    const p2 = result.perSide.p2;
    expect(result.score).toBeLessThan(0);
    expect(Math.sign(result.perSide.p1[0].ev)).toBe(Math.sign(result.score));
    expect(['Draco Meteor', 'Shadow Ball', 'Fire Blast']).toContain(p2[0].label);
    expect(p2.find(choice => choice.label === 'U-turn')!.ev).toBeLessThan(0);
  });

  test('Champions VGC 2628166702 turn 7: a thin pool leaves the cell to the sampler, and the prover proves the win', { timeout: 300_000 }, async () => {
    // The CI holdout of round 77: the last pair, p1 won the game. The four trees visited Dark Pulse into Protect 24
    // times (8, 6, 5, 5) and read about 0.1; one ply deeper the sampler reads the win (Protect holds once, the next
    // Dark Pulse lands), and the prover proves it in two turns against every reply. Waiving the floor for that thin
    // pool ranked Dark Pulse third (0.14), and the prover, which tries the ranked moves in order, found no proof.
    const position = JSON.parse(readFileSync(new URL('./fixtures/championsvgc-2628166702-t7.json', import.meta.url), 'utf8')) as {
      serialized: string; tera: false; sleepClause: boolean; ruleset: 'champions';
    };
    await loadSimModsFor(position.serialized);
    const result = await searchTreesOrchestrated(createLocalTreeExecutor(position.serialized, position.ruleset), {
      depth: 1, samples: 1, mode: 'mcts', tera: position.tera, sleepClause: position.sleepClause, ruleset: position.ruleset,
    });
    expect(result.perSide.p1[0].label).toBe('Dark Pulse');
    expect(result.forcedWin).toMatchObject({ side: 'p1', mass: 1 });
    expect(result.score).toBe(1);
  });
});
