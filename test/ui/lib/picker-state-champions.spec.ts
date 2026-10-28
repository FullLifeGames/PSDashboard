import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Battle, type PokemonSet } from '@pkmn/sim';
import { buildTeamsFromReplay, getBranchSimulatorFormat, parseReplayLog } from '@fulllifegames/replay-core';
import { loadSimMods } from '@fulllifegames/eval-engine';
import { pickerStateFromSerialized, pickerStateFromSnapshot } from '../../../src/lib/picker-state';

/**
 * Round 67 (T145 and decision 30, merge): the pickers on a Champions game. The
 * stored picker revives a recorded position on the Champions mod (the picker
 * module is only ever lazy-loaded and nothing before it loads the mod), and
 * every picker marks a Champions body, whose evs hold Stat Points, so the
 * damage preview reads them as EV = 8·SP − 4 with every IV 31 (the engine's
 * calc-champions.spec.ts holds that against the simulator). The positions and
 * the replay are lane F's Champions fixtures.
 */
const fixture = <T>(name: string) =>
  JSON.parse(readFileSync(join('packages', 'eval-engine', 'test', 'fixtures', 'champions', name), 'utf-8')) as T;
const position = (id: string) => fixture<{ serialized: string }>(`${id}.position.json`).serialized;

const positions = [['singles', 'gen9championsou-2693832490-t3'], ['doubles', 'gen9championsvgc2026regmbbo3-2679053861-t3']] as const;

describe('stored picker on a Champions position (T145)', () => {
  for (const [kind, id] of positions) {
    test(`pickerStateFromSerialized revives a Champions ${kind} position`, async () => {
      await expect(pickerStateFromSerialized(position(id))).resolves.toBeDefined();
    });

    test(`the stored ${kind} picker marks every body as a Champions body (decision 30)`, async () => {
      const state = await pickerStateFromSerialized(position(id));
      const infos = [...state.p1Pokemon, ...state.p2Pokemon];
      expect(infos.length).toBeGreaterThan(3);
      expect(infos.filter(info => info.mod !== 'champions').map(info => info.species)).toEqual([]);
    });
  }
});

describe('snapshot picker on a Champions replay (decision 30)', () => {
  test('a body\'s absolute HP is the simulator\'s on the Stat Point scale', async () => {
    const replay = fixture<{ formatid: string; log: string }>('gen9championsou-2693832490.json');
    await loadSimMods('gen9championsou');
    const snapshot = parseReplayLog(replay.log).find(entry => entry.turn === 3)!;
    const { p1Team, p2Team } = buildTeamsFromReplay(replay.log);
    const format = getBranchSimulatorFormat(replay);
    const state = pickerStateFromSnapshot(snapshot, p1Team, p2Team, 9, null, { format });
    const simulatedMaxHp = (set: PokemonSet) => {
      const battle = new Battle({ formatid: format as never, seed: '1,2,3,4', p1: { name: 'A', team: [set] }, p2: { name: 'B', team: [set] } });
      return battle.sides[0].pokemon[0].maxhp;
    };
    let compared = 0;
    for (const [infos, team] of [[state.p1Pokemon, p1Team], [state.p2Pokemon, p2Team]] as const) {
      for (const info of infos) {
        const set = team.find(candidate => candidate.species === info.species || candidate.name === info.name);
        expect(info.mod, info.species).toBe('champions');
        if (!set || info.fainted) continue;
        expect(info.maxhp, info.species).toBe(simulatedMaxHp(set));
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(3);
  }, 60_000);

  test('the fast picker offers no Tera where the Champions mod has none (T136, T145)', async () => {
    const replay = fixture<{ formatid: string; log: string }>('gen9championsou-2693832490.json');
    await loadSimMods('gen9championsou');
    const { p1Team, p2Team } = buildTeamsFromReplay(replay.log);
    const format = getBranchSimulatorFormat(replay);
    for (const snapshot of parseReplayLog(replay.log).slice(1, 6)) {
      const state = pickerStateFromSnapshot(snapshot, p1Team, p2Team, 9, null, { format });
      const slots = [...state.p1ModifiersBySlot, ...state.p2ModifiersBySlot];
      expect(slots.length, `turn ${snapshot.turn}`).toBeGreaterThan(0);
      expect(slots.map(slot => slot.teraType).filter(type => type !== null), `turn ${snapshot.turn}`).toEqual([]);
    }
  }, 60_000);
});
