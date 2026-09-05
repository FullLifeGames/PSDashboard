import { test, expect, describe } from 'vitest';
import type { PokemonSet } from '@pkmn/sim';
import {
  createBranchState,
  executeBranchChoices,
  reconstructBranchRuntime,
  resolveSideChoices,
} from '../src/branch-engine';
import { describeSlotChoice, type BranchSlotChoice } from '../src/branch-choices';

const p1Team: PokemonSet[] = [
  {
    name: 'Garchomp',
    species: 'Garchomp',
    item: 'Loaded Dice',
    ability: 'Rough Skin',
    moves: ['Earthquake', 'Protect'],
    nature: 'Jolly',
    evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 100,
    teraType: 'Fire',
  },
];

const p2Team: PokemonSet[] = [
  {
    name: 'Skarmory',
    species: 'Skarmory',
    item: 'Rocky Helmet',
    ability: 'Sturdy',
    moves: ['Roost', 'Spikes'],
    nature: 'Bold',
    evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 100,
  },
];

const singlesLog = [
  '|switch|p1a: Garchomp|Garchomp, M|100/100',
  '|switch|p2a: Skarmory|Skarmory, F|100/100',
  '|turn|1',
].join('\n');

describe('battle gimmick choices (G7)', () => {
  test('describes modifier choices in pending chips', () => {
    const tera: BranchSlotChoice = { kind: 'move', moveId: 'earthquake', moveName: 'Earthquake', modifier: 'terastallize' };
    expect(describeSlotChoice(tera)).toBe('move Earthquake (Tera)');
    const z: BranchSlotChoice = { kind: 'move', moveId: 'thunderbolt', moveName: 'Thunderbolt', targetLoc: 1, modifier: 'zmove' };
    expect(describeSlotChoice(z)).toBe('move Thunderbolt +1 (Z)');
  });

  test('exposes Tera availability and executes a terastallized turn in gen 9', async () => {
    const runtime = await reconstructBranchRuntime({
      format: 'gen9ou',
      p1Team,
      p2Team,
      replayLog: singlesLog,
      targetTurn: 1,
    });
    const battle = runtime.battleStream.battle!;

    const state = createBranchState(runtime.battleStream, runtime.log, { p1Choices: [], p2Choices: [] });
    expect(state.p1ModifiersBySlot[0]?.teraType).toBe('Fire');

    const choice: BranchSlotChoice = { kind: 'move', moveId: 'earthquake', moveName: 'Earthquake', modifier: 'terastallize' };
    const resolved = resolveSideChoices(battle, 'p1', [choice], [true]);
    expect(resolved).toEqual({ ok: true, command: 'move 1 terastallize' });

    const result = await executeBranchChoices({
      streams: runtime.streams,
      log: runtime.log,
      choiceErrors: runtime.choiceErrors,
      commands: [
        { side: 'p1', command: resolved.ok ? resolved.command : '' },
        { side: 'p2', command: 'move 1' },
      ],
    });
    expect(result.ok).toBe(true);

    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && !runtime.log.some(line => line.startsWith('|-terastallize|p1a'))) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    expect(runtime.log.some(line => line.startsWith('|-terastallize|p1a'))).toBe(true);

    // Tera is once per battle — availability disappears afterwards.
    const nextState = createBranchState(runtime.battleStream, runtime.log, { p1Choices: [], p2Choices: [] });
    expect(nextState.p1ModifiersBySlot[0]?.teraType).toBeNull();
  });

  test('offers no gimmicks in gen 3', async () => {
    const runtime = await reconstructBranchRuntime({
      format: 'gen3ou',
      p1Team: [{ ...p1Team[0], item: 'Choice Band', teraType: undefined, moves: ['Earthquake', 'Protect'] }],
      p2Team,
      replayLog: singlesLog,
      targetTurn: 1,
    });
    const state = createBranchState(runtime.battleStream, runtime.log, { p1Choices: [], p2Choices: [] });
    const modifiers = state.p1ModifiersBySlot[0];
    expect(modifiers?.teraType ?? null).toBeNull();
    expect(modifiers?.canMegaEvo ?? false).toBe(false);
    expect((modifiers?.zMoves ?? []).some(Boolean)).toBe(false);
  });
});
