import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parseReplayLog } from '@fulllifegames/replay-core';
import { reconstructBranchRuntime, resolveSideChoices } from '../src/branch-engine';
import type { BranchSlotChoice } from '../src/branch-choices';

/**
 * Round 88 (#103): the reporter's scene. In public replay gen9ou-2710066092 p2's Ogerpon terastallizes on turn 9 (Ogerpon-Teal-Tera, log
 * lines 123 and 124). The variation from turn 21 plays Ice Shard against a switch to Slowking and Icicle Spear against a switch to Kingambit,
 * Kingambit faints, and the play-out picks Ogerpon for p2's replacement with the chip's own identity (`ogerpontealtera`, name Ogerpon). The
 * resolver answered "Ogerpon (Ogerpon-Teal-Tera) is no longer available to switch in." The fixtures hold the replay's public log and the data
 * of the state file the app wrote (built sets, the two history entries by their slot choices, the live choice).
 */
const dir = new URL('./fixtures/', import.meta.url);
const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(name, dir), 'utf8')) as T;
const replay = read<{ log: string }>('gen9ou-2710066092.json');
const variation = read<{
  formatid: string; players: string[]; startTurn: number; builtSets: { p1Team: unknown[]; p2Team: unknown[] };
  history: { turnNumber: number; p1SlotChoices: BranchSlotChoice[]; p2SlotChoices: BranchSlotChoice[] }[];
  live: { p1: BranchSlotChoice[]; p2: BranchSlotChoice[] };
}>('issue-103-variation.json');

describe('#103 gen9ou-2710066092: the variation from turn 21 and the replacement of Ogerpon', () => {
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
