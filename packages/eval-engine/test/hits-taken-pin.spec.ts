import { readFileSync } from 'fs';
import { describe, expect, test } from 'vitest';
import type { Battle } from '@pkmn/sim';
import {
  buildTeamsFromReplay, getBranchSimulatorFormat, parseReplayLog, parseReplayLogWithObservations, replayBringOnly,
} from '@fulllifegames/replay-core';
import { reconstructBranchRuntime } from '../src/branch-engine';
import { bodyOf } from '../src/calc/body';
import { calcMove } from '../src/calc/move';
import { buildChoiceLockContext } from '../src/choice-lock';
import { loadSimMods } from '../src/forward/sim-mods';
import { landedMove } from '../src/score/move-facts';
import { calcGenerationFor, CHAMPIONS_MOD } from '@fulllifegames/replay-core';

/**
 * Round 76 (T265): the rebuilt board pins the hits a body took to the count of the log (the snapshot's `timesAttacked`, which
 * @pkmn/client keeps), as it pins the side's fallen. The scene: gen9championsou-2691703002 turn 7, where p1's Annihilape has
 * taken four hits (turn 4, 5, 6 and one before) and plays Rage Fist at 250 in the game. The rebuilt simulator counted one
 * (round 76's drift probe: 3,584 bodies, 6 to 53 of them off per replay); the calculator's move and the static read the count.
 */

await loadSimMods('gen9championsou');

type Replay = { id: string; format: string; players: string[]; log: string };
const replay = JSON.parse(readFileSync(new URL('./fixtures/gen9championsou-2691703002.json', import.meta.url), 'utf-8')) as Replay;

async function boundary<T>(turn: number, read: (battle: Battle) => T): Promise<T> {
  const { snapshots, observations, speedOrders } = parseReplayLogWithObservations(replay.log);
  const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders });
  const snapshotFor = (t: number) => snapshots[Math.min(t - 1, snapshots.length - 1)] ?? null;
  let seen: { value: T } | null = null;
  await reconstructBranchRuntime({
    format: getBranchSimulatorFormat(replay), p1Team, p2Team, replayLog: replay.log,
    bringOnly: replayBringOnly(replay, parseReplayLog(replay.log)) ?? undefined,
    targetTurn: turn + 1, snapshot: snapshotFor(turn + 1),
    choiceLocks: buildChoiceLockContext(replay.log, { p1Team, p2Team }, observations),
    capturePositions: { snapshotFor, onPosition: (t, battle) => { if (t === turn && !seen) seen = { value: read(battle as never) }; } },
  });
  return seen!.value;
}

describe('the hits a body took reach the rebuilt board (gen9championsou-2691703002 turn 7, singles)', () => {
  test('the snapshot carries the client\'s count', () => {
    const snapshot = parseReplayLogWithObservations(replay.log).snapshots.find(entry => entry.turn === 7)!;
    expect(snapshot.p1.pokemon.find(mon => mon.speciesForme === 'Annihilape')!.timesAttacked).toBe(4);
    // Absent at none, so a snapshot written before round 76 reads the same.
    expect(snapshot.p2.pokemon.every(mon => mon.timesAttacked === undefined || mon.timesAttacked > 0)).toBe(true);
  });

  test('the rebuilt Annihilape holds four hits; the static and the calculator\'s move play Rage Fist at 250', { timeout: 240000 }, async () => {
    const seen = await boundary(7, battle => {
      const attacker = battle.sides[0].pokemon.find(mon => mon.species.name === 'Annihilape')!;
      const defender = battle.sides[1].active[0];
      const move = battle.dex.moves.get('ragefist');
      return {
        hits: attacker.timesAttacked,
        static: landedMove(attacker, defender, move, battle).basePower,
        calc: calcMove(calcGenerationFor(battle.gen, CHAMPIONS_MOD), 'Rage Fist', bodyOf(battle, attacker)).bp,
      };
    });
    expect(seen).toEqual({ hits: 4, static: 250, calc: 250 });
  });
});
