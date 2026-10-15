import { readFileSync } from 'fs';
import { describe, expect, test } from 'vitest';
import {
  buildTeamsFromReplay, getBranchSimulatorFormat, parseReplayLog, parseReplayLogWithObservations, replayBringOnly,
  type SmogonUsageStats,
} from '@fulllifegames/replay-core';
import { buildChoiceLockContext } from '../src/choice-lock';
import { reconstructBranchRuntime } from '../src/branch-engine';

/**
 * Round 70 (batch fix), the scene of the bug: smogtours-gen7ou-450650 turn 2, p2's Garchomp uses a Dragon Z-move. The build stored
 * "Devastating Drake" as its only move, so the branch at turn 3 offered Struggle, the picker said "Garchomp no longer knows
 * Devastating Drake", and the play-out stopped. Now the build holds a Dragon attack, the rebuild plays the Z-move without a rejected
 * choice, and the branch stands where the game stood: the side has spent its Z-power and the body offers its moves.
 */

type Replay = { id: string; format: string; formatid?: string; players: string[]; log: string };
const replay = JSON.parse(readFileSync(new URL('./fixtures/smogtours-gen7ou-450650.json', import.meta.url), 'utf-8')) as Replay;

/** A usage list for Garchomp whose four best-used moves hold no Dragon attack. */
const entry = (value: string, index: number) => ({ value, probability: 0.95 - index * 0.07, sourceDetail: 'test' });
const USAGE: SmogonUsageStats = {
  format: 'gen7ou', month: '2026-09', source: 'test',
  pokemon: {
    garchomp: {
      species: 'Garchomp', rawCount: 1000, abilities: [], items: [],
      moves: ['Earthquake', 'Swords Dance', 'Stealth Rock', 'Toxic', 'Outrage', 'Dragon Claw'].map(entry), spreads: [],
    },
  },
};

describe('450650: the branch after the Z-move of turn 2', () => {
  test('Garchomp is built with a Dragon attack and its crystal, and the branch at turn 3 offers its moves', { timeout: 240000 }, async () => {
    const { snapshots, observations, speedOrders, hpEvidence } = parseReplayLogWithObservations(replay.log);
    const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders, hpEvidence, usageStats: USAGE });
    const garchomp = p2Team.find(set => set.species === 'Garchomp')!;
    expect(garchomp.item).toBe('Dragonium Z');
    expect(garchomp.moves).not.toContain('Devastating Drake');
    expect(garchomp.moves).toContain('Outrage');

    const snapshotFor = (turn: number) => snapshots[Math.min(turn - 1, snapshots.length - 1)] ?? null;
    const runtime = await reconstructBranchRuntime({
      format: getBranchSimulatorFormat(replay), p1Team, p2Team, replayLog: replay.log,
      bringOnly: replayBringOnly(replay, parseReplayLog(replay.log)) ?? undefined,
      targetTurn: 3, snapshot: snapshotFor(3), playerNames: [replay.players[0], replay.players[1]],
      choiceLocks: buildChoiceLockContext(replay.log, { p1Team, p2Team }, observations),
    });
    expect(runtime.choiceErrors.count).toBe(0);
    const battle = runtime.battleStream.battle!;
    const active = battle.sides[1].active[0]!;
    expect(active.species.name).toBe('Garchomp');
    // The game spent the side's Z-power on turn 2; the rebuild did too, and the body is not offered a second Z-move.
    expect(battle.sides[1].zMoveUsed).toBe(true);
    const request = active.getMoveRequestData();
    expect(request.canZMove).toBeUndefined();
    expect(request.moves.map(move => move.id)).not.toContain('struggle');
    expect(request.moves.map(move => move.id)).toContain('outrage');
  });
});
