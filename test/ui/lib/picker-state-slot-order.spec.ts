import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildTeamsFromReplay, parseReplayLog, type TurnSnapshot } from '@fulllifegames/replay-core';
import { loadSimMods } from '@fulllifegames/eval-engine';
import { pickerStateFromSnapshot } from '../../../src/lib/picker-state';

/**
 * Round 84 (turn dock), lane A, step A2: the probe over 36 games found the snapshot picker's slot index differing from the
 * body's slot for 41 to 46 percent of the active bodies in doubles and VGC. `snapshotSideOptions` listed the actives in team
 * order, and the replay client keeps the team in the order of the party, not of the field. The pickers then showed slot A the
 * moves of the body that stands in slot B, and the dock's seed (and any pick made before the exact position lands) read the
 * wrong body's moves. A slot's pickers belong to the body that stands there.
 */
const FIXTURES = [
  ['Doubles OU', 'gen9doublesou', 'test/e2e/fixtures/dock-doublesou-2662153814.json'],
  ['Regulation I VGC', 'gen9doublesou', 'test/e2e/fixtures/dock-vgcregi-2573391549.json'],
  ['Champions VGC', 'gen9championsvgc2026regmcbo3', 'test/e2e/fixtures/dock-championsvgc-2625939941.json'],
] as const;

describe('snapshot picker, doubles slots', () => {
  test.each(FIXTURES)('%s: each slot\'s pickers belong to the body standing in it', async (_label, format, path) => {
    const replay = JSON.parse(readFileSync(path, 'utf-8')) as { log: string };
    await loadSimMods(format);
    const snapshots: TurnSnapshot[] = parseReplayLog(replay.log);
    const { p1Team, p2Team } = buildTeamsFromReplay(replay.log);
    let reordered = 0;
    const wrong: string[] = [];
    for (let index = 0; index < snapshots.length - 1; index++) {
      const snapshot = snapshots[index];
      const state = pickerStateFromSnapshot(snapshot, p1Team, p2Team, 9, null, { format });
      for (const side of ['p1', 'p2'] as const) {
        const field = snapshot[side].pokemon.filter(mon => mon.isActive && !mon.fainted);
        if (field.some((mon, position) => (mon.slot ?? position) !== position)) reordered += 1;
        const actives = side === 'p1' ? state.p1ActiveSlots : state.p2ActiveSlots;
        const moves = side === 'p1' ? state.p1MovesBySlot : state.p2MovesBySlot;
        for (const mon of field) {
          const slot = mon.slot ?? 0;
          if (actives[slot]?.name !== mon.name) wrong.push(`turn ${index} ${side} slot ${slot}: ${actives[slot]?.name} for ${mon.name}`);
          const set = (side === 'p1' ? p1Team : p2Team).find(entry => entry.species === mon.speciesForme || entry.name === mon.name);
          const offered = moves[slot]?.map(option => option.name) ?? [];
          for (const move of set?.moves ?? []) {
            if (!offered.some(name => name.toLowerCase().replace(/[^a-z0-9]/g, '') === move.toLowerCase().replace(/[^a-z0-9]/g, ''))) {
              wrong.push(`turn ${index} ${side} slot ${slot}: ${move} of ${mon.name} is not offered in its slot`);
            }
          }
        }
      }
    }
    expect(wrong).toEqual([]);
    // The check means something only where the party order and the field order differ.
    expect(reordered, 'a snapshot whose team order differs from its field order').toBeGreaterThan(0);
  }, 120_000);
});
