import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  buildTeamsFromReplay,
  getBranchSimulatorFormat,
  parseReplayLog,
  parseReplayLogWithObservations,
  replayBringOnly,
  type SmogonUsageStats,
  calcGenerationFor,
  CHAMPIONS_MOD,
} from '@fulllifegames/replay-core';
import { buildChoiceLockContext } from '../src/choice-lock';
import { reconstructBranchRuntime, resolveSideChoices } from '../src/branch-engine';
import type { Battle } from '@pkmn/sim';
import { bodyOf } from '../src/calc/body';
import { calcMove } from '../src/calc/move';
import { loadSimMods } from '../src/forward/sim-mods';
import { landedMove } from '../src/score/move-facts';
import type { BranchSlotChoice } from '../src/branch-choices';

/**
 * Scene: smogtours-gen7ou-450650 turn 2, p2's Garchomp uses a Dragon Z-move. The build stored "Devastating Drake" as its only move,
 * so the branch at turn 3 offered Struggle, the picker named the lost move, and the play-out stopped. The build holds a Dragon
 * attack, the rebuild plays the Z-move without a rejected choice, and the branch stands where the game stood: the side has spent
 * its Z-power and the body offers its moves.
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

await loadSimMods('gen9championsou');

describe('hits-taken-pin', () => {
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
      // Absent at none, so an older snapshot reads the same.
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
});

describe('switch-forme-replay', () => {
  const dir = new URL('./fixtures/', import.meta.url);
  const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(name, dir), 'utf8')) as T;
  const replay = read<{ log: string }>('gen9ou-2710066092.json');
  const variation = read<{
    formatid: string; players: string[]; startTurn: number; builtSets: { p1Team: unknown[]; p2Team: unknown[] };
    history: { turnNumber: number; p1SlotChoices: BranchSlotChoice[]; p2SlotChoices: BranchSlotChoice[] }[];
    live: { p1: BranchSlotChoice[]; p2: BranchSlotChoice[] };
  }>('issue-103-variation.json');

  describe('gen9ou-2710066092: the variation from turn 21 and the replacement of Ogerpon', () => {
    test('the history replays and the live choice switches Ogerpon-Teal-Tera in', async () => {
      const runtime = await reconstructBranchRuntime({
        format: variation.formatid,
        p1Team: variation.builtSets.p1Team as never,
        p2Team: variation.builtSets.p2Team as never,
        replayLog: replay.log,
        targetTurn: variation.startTurn,
        snapshot: parseReplayLog(replay.log)[variation.startTurn - 1] ?? null,
        playerNames: variation.players,
      });
      const battle = runtime.battleStream.battle!;
      for (const entry of variation.history) {
        const p1 = resolveSideChoices(battle, 'p1', entry.p1SlotChoices, [true]);
        const p2 = resolveSideChoices(battle, 'p2', entry.p2SlotChoices, [true]);
        expect(p1.ok && p2.ok, `turn ${entry.turnNumber} resolves`).toBe(true);
        if (!p1.ok || !p2.ok) return;
        expect(battle.choose('p1', p1.command)).toBe(true);
        expect(battle.choose('p2', p2.command)).toBe(true);
      }
      expect(battle.sides[1].requestState).toBe('switch');
      const ogerpon = battle.sides[1].pokemon.findIndex(body => body.species.name === 'Ogerpon-Teal-Tera');
      expect(ogerpon, 'Ogerpon is on the bench in its Tera forme').toBeGreaterThan(0);
      expect(variation.live.p2[0]).toMatchObject({ kind: 'switch', speciesId: 'ogerpontealtera', pokemonName: 'Ogerpon' });
      const resolved = resolveSideChoices(battle, 'p2', variation.live.p2, [true]);
      expect(resolved).toEqual({ ok: true, command: `switch ${ogerpon + 1}` });
    });
  });
});
