import { test, expect, describe } from 'vitest';
import type { BranchMoveOption, BranchSlotModifiers, BranchSwitchOption } from '@fulllifegames/eval-engine';
import { moveChoiceFor, pickedChoice, type ChoiceContext } from '../src/components/branch/choice-context';

const move = (name: string, slot: number): BranchMoveOption =>
  ({ name, activeSlot: 0, slot, pp: 16, maxpp: 16, disabled: false, type: 'Normal', targetType: 'normal', requiresTarget: false, targetOptions: [] });
const switches: BranchSwitchOption[] = [
  { name: 'Heatran', species: 'Heatran', activeSlot: 0, slot: 2, hp: '300/300', hpPercent: 100, fainted: false },
  { name: 'Rotom', species: 'Rotom-Wash', activeSlot: 0, slot: 3, hp: '300/300', hpPercent: 100, fainted: false },
];
const modifiers: BranchSlotModifiers = { teraType: 'Fire', canMegaEvo: false, canUltraBurst: false, zMoves: [null, 'Inferno Overdrive'] };
const moves = [move('Earthquake', 1), move('Fire Fang', 2)];
const ctx = (extra: Partial<ChoiceContext> = {}): ChoiceContext => ({ modifier: null, modifierAvailable: false, moves, modifiers, ...extra });

describe('choice context', () => {
  test('a move button becomes a move choice, with its target in doubles', () => {
    expect(moveChoiceFor(moves[0], undefined, ctx())).toEqual({ kind: 'move', moveId: 'earthquake', moveName: 'Earthquake' });
    expect(moveChoiceFor(moves[1], 2, ctx())).toEqual({ kind: 'move', moveId: 'firefang', moveName: 'Fire Fang', targetLoc: 2 });
  });

  test('an armed gimmick rides on the move; a Z toggle only on moves with a Z option', () => {
    const tera = ctx({ modifier: 'terastallize', modifierAvailable: true });
    expect(moveChoiceFor(moves[0], undefined, tera)).toMatchObject({ modifier: 'terastallize' });
    const unavailable = ctx({ modifier: 'terastallize', modifierAvailable: false });
    expect(moveChoiceFor(moves[0], undefined, unavailable)).not.toHaveProperty('modifier');
    const z = ctx({ modifier: 'zmove', modifierAvailable: true });
    expect(moveChoiceFor(moves[0], undefined, z)).not.toHaveProperty('modifier');
    expect(moveChoiceFor(moves[1], undefined, z)).toMatchObject({ modifier: 'zmove' });
  });

  test('the free-choice value resolves by slot for moves and switches, or to nothing', () => {
    expect(pickedChoice('move:2', switches, ctx())).toEqual({ kind: 'move', moveId: 'firefang', moveName: 'Fire Fang' });
    expect(pickedChoice('move:1:2', switches, ctx())).toMatchObject({ moveId: 'earthquake', targetLoc: 2 });
    expect(pickedChoice('switch:3', switches, ctx())).toEqual({ kind: 'switch', speciesId: 'rotomwash', pokemonName: 'Rotom' });
    expect(pickedChoice('move:9', switches, ctx())).toBeNull();
    expect(pickedChoice('switch:9', switches, ctx())).toBeNull();
    expect(pickedChoice('', switches, ctx())).toBeNull();
  });
});
