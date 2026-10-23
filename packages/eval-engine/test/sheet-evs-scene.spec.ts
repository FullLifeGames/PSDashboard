import { readFileSync } from 'fs';
import { describe, expect, test } from 'vitest';
import type { Battle } from '@pkmn/sim';
import {
  buildTeamsFromReplay, getBranchSimulatorFormat, parseReplayLog, parseReplayLogWithObservations, replayBringOnly,
} from '@fulllifegames/replay-core';
import { reconstructBranchRuntime } from '../src/branch-engine';
import { buildChoiceLockContext } from '../src/choice-lock';
import { cloneBattle } from '../src/forward/sim-fast/clone';
import { loadSimMods } from '../src/forward/sim-mods';

/**
 * Round 76 (T260): gen9championsvgc2026regmbbo3-2634204248 turn 11. The game's Mawile-Mega stands at 100 % and keeps 7 % after
 * p2's Flare Blitz. The open team sheet shows no EVs; the build gave Mawile none (125 HP), and all 16 rolls (128 to 152) knocked
 * it out, so the rebuilt game ended and the bank skipped turn 12. With the solver's EVs (about 151 HP) 15 of 16 rolls leave it alive.
 */

await loadSimMods('gen9championsou');

type Replay = { id: string; format: string; players: string[]; log: string };
const replay = JSON.parse(readFileSync(new URL('./fixtures/gen9championsvgc2026regmbbo3-2634204248.json', import.meta.url), 'utf-8')) as Replay;

async function boundary<T>(turn: number, read: (battle: Battle) => T): Promise<T | null> {
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
  return seen ? (seen as { value: T }).value : null;
}

describe('the sheet\'s Mawile (doubles, Champions VGC)', () => {
  test('turn 11: about 151 HP, and 15 of the 16 Flare Blitz rolls leave it alive', { timeout: 240000 }, async () => {
    const seen = await boundary(11, battle => {
      const copy = cloneBattle(battle) as Battle;
      const [attacker, defender] = [copy.sides[1].active[0], copy.sides[0].active[0]];
      const rolls: number[] = [];
      copy.randomChance = () => false;
      for (let roll = 0; roll < 16; roll++) {
        copy.random = (n?: number) => (n === 16 ? roll : 0);
        rolls.push(copy.actions.getDamage(attacker, defender, copy.dex.getActiveMove('flareblitz')) as number);
      }
      return { name: defender.species.name, hp: defender.hp, alive: rolls.filter(damage => damage < defender.hp).length };
    });
    expect(seen).not.toBeNull();
    expect(seen!.name).toBe('Mawile-Mega');
    expect(seen!.hp).toBeGreaterThanOrEqual(145);
    expect(seen!.alive).toBe(15);
  });

  test('the rebuilt game reaches turn 12 (the bank row returns)', { timeout: 240000 }, async () => {
    const seen = await boundary(12, battle => ({ ended: battle.ended }));
    expect(seen).toEqual({ ended: false });
  });
});
