import { describe, expect, test } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import {
  createBranchStateFromBattle, requiredChoicesForActiveSlots, resolveSideChoices,
  type BranchMoveModifier, type BranchSimState, type BranchSlotChoice,
} from '@fulllifegames/eval-engine';
import { useGimmickToggles } from '../../src/hooks/useSideControlsState';
import { moveChoiceFor } from '../../src/components/branch/choice-context';

/**
 * T124 point 1 against the simulator: a side's choice takes each gimmick
 * once (Side.chooseMove checks choice.terastallize, mega, ultra and zMove),
 * and the request names no such limit, so the panel holds the same check.
 * Per kind, a doubles battle with two actives that can both use it: the
 * simulator rejects the kind on both slots, and the command the panel builds
 * after both toggles were clicked is one the simulator accepts.
 */

const STATS = { hp: 0, atk: 252, def: 0, spa: 252, spd: 0, spe: 0 };

function set(species: string, moves: string[], extra: Partial<PokemonSet> = {}): PokemonSet {
  return {
    name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy', evs: STATS,
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 50, gender: '', ...extra,
  };
}

function battle(format: string, p1: PokemonSet[], p2: PokemonSet[]): Battle {
  const created = new Battle({ formatid: toID(format), seed: '1,2,3,4', p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) } });
  if (created.sides.some(side => side.requestState === 'teampreview')) {
    created.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
    created.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
  }
  return created;
}

const walls = [set('Snorlax', ['Splash']), set('Blissey', ['Splash'])];

const SCENES: { kind: BranchMoveModifier; format: string; p1: PokemonSet[] }[] = [
  { kind: 'terastallize', format: 'gen9doublescustomgame', p1: [
    set('Garchomp', ['Dragon Claw'], { teraType: 'Ground' }), set('Incineroar', ['Flare Blitz'], { teraType: 'Fire' })] },
  { kind: 'mega', format: 'gen7doublescustomgame', p1: [
    set('Gengar', ['Shadow Ball'], { item: 'Gengarite' }), set('Lopunny', ['Return'], { item: 'Lopunnite' })] },
  { kind: 'zmove', format: 'gen7doublescustomgame', p1: [
    set('Garchomp', ['Dragon Claw'], { item: 'Dragonium Z' }), set('Charizard', ['Flamethrower'], { item: 'Firium Z' })] },
  { kind: 'ultra', format: 'gen7doublescustomgame', p1: [
    set('Necrozma-Dusk-Mane', ['Sunsteel Strike'], { item: 'Ultranecrozium Z' }), set('Necrozma-Dawn-Wings', ['Moongeist Beam'], { item: 'Ultranecrozium Z' })] },
];

/** The command the picker sends for P1: each slot's first move into the first foe, with the slot's gimmick toggle. */
function commandFor(current: Battle, state: BranchSimState, gimmicks: { modifier: BranchMoveModifier | null; modifierAvailable: boolean }[]) {
  const choices: BranchSlotChoice[] = state.p1MovesBySlot.map((moves, slot) => moveChoiceFor(moves[0], moves[0].targetOptions[0]?.targetLoc, {
    ...gimmicks[slot], moves, modifiers: state.p1ModifiersBySlot[slot],
  }));
  const resolved = resolveSideChoices(current as never, 'p1', choices, requiredChoicesForActiveSlots(state.p1ActiveSlots, state.p1ForceSwitches));
  if (!resolved.ok) throw new Error(resolved.error);
  return resolved.command;
}

describe('a side arms each gimmick once, as the simulator takes it (T124 point 1)', () => {
  for (const { kind, format, p1 } of SCENES) {
    test(`${kind}: the simulator rejects it on both slots and accepts the command the panel builds`, () => {
      const state = createBranchStateFromBattle(battle(format, p1, walls) as never, [], {});
      const armedBoth = commandFor(battle(format, p1, walls), state, [0, 1].map(() => ({ modifier: kind, modifierAvailable: true })));
      const twice = battle(format, p1, walls);
      expect(twice.choose('p1', armedBoth), armedBoth).toBe(false);
      expect(twice.sides[0].choice.error).toMatch(/once per battle/);

      const hook = renderHook(() => useGimmickToggles(state.p1ModifiersBySlot, state.p2ModifiersBySlot, 'k'));
      act(() => hook.result.current.gimmickFor('p1', 0).toggle(kind));
      act(() => hook.result.current.gimmickFor('p1', 1).toggle(kind));
      const panel = commandFor(battle(format, p1, walls), state, [0, 1].map(slot => hook.result.current.gimmickFor('p1', slot)));
      expect(battle(format, p1, walls).choose('p1', panel), panel).toBe(true);
      expect(hook.result.current.gimmickFor('p1', 0).modifier).toBe(kind);
    });
  }

  test('singles: the one active is never blocked, and its Tera command is taken', () => {
    const p1 = [set('Garchomp', ['Dragon Claw'], { teraType: 'Ground' })];
    const state = createBranchStateFromBattle(battle('gen9customgame', p1, [walls[0]]) as never, [], {});
    const hook = renderHook(() => useGimmickToggles(state.p1ModifiersBySlot, state.p2ModifiersBySlot, 'k'));
    act(() => hook.result.current.gimmickFor('p1', 0).toggle('terastallize'));
    const gimmick = hook.result.current.gimmickFor('p1', 0);
    expect(gimmick).toMatchObject({ modifier: 'terastallize', modifierAvailable: true });
    const choice = moveChoiceFor(state.p1MovesBySlot[0][0], undefined, { ...gimmick, moves: state.p1MovesBySlot[0], modifiers: state.p1ModifiersBySlot[0] });
    const current = battle('gen9customgame', p1, [walls[0]]);
    const resolved = resolveSideChoices(current as never, 'p1', [choice], [true]);
    expect(resolved).toEqual({ ok: true, command: 'move 1 terastallize' });
    expect(current.choose('p1', 'move 1 terastallize')).toBe(true);
  });
});
