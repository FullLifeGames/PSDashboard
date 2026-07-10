import { test, expect } from '@playwright/test';
import {
  branchSideChoicesReady,
  choiceId,
  conflictingSwitchTargets,
  describeSlotChoice,
  requiredChoicesForActiveSlots,
  switchChoiceKey,
  switchOptionKey,
  type BranchSlotChoice,
} from '../src/lib/branch-choices';

function switchTo(species: string, name = species): BranchSlotChoice {
  return { kind: 'switch', speciesId: choiceId(species), pokemonName: name };
}

function moveBy(name: string, targetLoc?: number): BranchSlotChoice {
  return {
    kind: 'move',
    moveId: choiceId(name),
    moveName: name,
    ...(targetLoc !== undefined ? { targetLoc } : {}),
  };
}

test.describe('branch choice helpers', () => {
  test('requires every live active slot unless a force switch request narrows the choice set', () => {
    expect(requiredChoicesForActiveSlots([{ fainted: false }, { fainted: false }], []))
      .toEqual([true, true]);
    expect(requiredChoicesForActiveSlots([{ fainted: false }, { fainted: false }], [true, false]))
      .toEqual([true, false]);
    expect(requiredChoicesForActiveSlots([{ fainted: true }, { fainted: false }], []))
      .toEqual([false, true]);
  });

  test('rejects duplicate switch targets across simultaneous doubles slots', () => {
    expect(branchSideChoicesReady([switchTo('Raichu'), switchTo('Raichu')], [true, true])).toBe(false);
    expect(conflictingSwitchTargets([switchTo('Raichu'), switchTo('Raichu')], [true, true]))
      .toEqual(['raichu|raichu']);
    expect(branchSideChoicesReady([switchTo('Raichu'), switchTo('Squirtle')], [true, true])).toBe(true);
  });

  test('allows same-species switches to different nicknamed team members', () => {
    expect(branchSideChoicesReady([switchTo('Eevee', 'Alpha'), switchTo('Eevee', 'Beta')], [true, true]))
      .toBe(true);
    expect(switchChoiceKey(switchTo('Eevee', 'Alpha')))
      .toBe(switchOptionKey({ species: 'Eevee', name: 'Alpha' }));
  });

  test('treats missing choices as not ready only for required slots', () => {
    expect(branchSideChoicesReady([switchTo('Raichu'), null], [true, false])).toBe(true);
    expect(branchSideChoicesReady([switchTo('Raichu'), null], [true, true])).toBe(false);
  });

  test('describes slot choices with move names and targets', () => {
    expect(describeSlotChoice(moveBy('Blizzard'))).toBe('move Blizzard');
    expect(describeSlotChoice(moveBy('Icy Wind', 1))).toBe('move Icy Wind +1');
    expect(describeSlotChoice(moveBy('Flamethrower', -2))).toBe('move Flamethrower -2');
    expect(describeSlotChoice(switchTo('Skarmory'))).toBe('switch Skarmory');
    expect(describeSlotChoice(null)).toBe('');
  });
});
