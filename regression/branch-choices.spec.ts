import { test, expect } from '@playwright/test';
import {
  branchSideChoicesReady,
  choiceId,
  conflictingSwitchTargets,
  describeSlotChoice,
  evalChoiceToSlotChoices,
  requiredChoicesForActiveSlots,
  switchChoiceKey,
  switchOptionKey,
  type BranchSlotChoice,
} from '../src/lib/branch-choices';
import type { BranchMoveOption, BranchSwitchOption, BranchTargetOption } from '../src/lib/branch-engine';

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

test.describe('engine choice → branch slot choices', () => {
  const target = (targetLoc: number): BranchTargetOption =>
    ({ label: `${targetLoc}`, targetLoc, side: 'p2', activeSlot: 0, name: 'Foe', species: 'Foe', hpPercent: 100 });
  const move = (name: string, activeSlot: number, slot: number, targets: number[] = []): BranchMoveOption => ({
    name, activeSlot, slot, pp: 16, maxpp: 16, disabled: false, type: 'Normal', targetType: 'normal',
    requiresTarget: targets.length > 0, targetOptions: targets.map(target),
  });
  const bench = (name: string, slot: number): BranchSwitchOption =>
    ({ name, species: name, activeSlot: 0, slot, hp: '100/100', hpPercent: 100, fainted: false });

  test('a singles move with a gimmick maps onto one slot', () => {
    const choices = evalChoiceToSlotChoices('move bugbite terastallize', [[move('Bug Bite', 0, 1)]], [[]]);
    expect(choices).toEqual([
      { kind: 'move', moveId: 'bugbite', moveName: 'Bug Bite', modifier: 'terastallize' },
    ]);
  });

  test('a doubles combined choice maps per slot with targets, mega, and switches', () => {
    const choices = evalChoiceToSlotChoices(
      'move bugbite 1 mega, switch 3',
      [[move('Bug Bite', 0, 1, [1, 2])], []],
      [[], [bench('Amoonguss', 3)]],
    );
    expect(choices).toEqual([
      { kind: 'move', moveId: 'bugbite', moveName: 'Bug Bite', targetLoc: 1, modifier: 'mega' },
      { kind: 'switch', speciesId: 'amoonguss', pokemonName: 'Amoonguss' },
    ]);
  });

  test('a pass slot stays empty and an unresolvable part rejects the whole pick', () => {
    expect(evalChoiceToSlotChoices('pass, move protect', [[], [move('Protect', 1, 1)]], [[], []]))
      .toEqual([null, { kind: 'move', moveId: 'protect', moveName: 'Protect' }]);
    // The move exists but the named switch target does not — no partial prefill.
    expect(evalChoiceToSlotChoices('move protect, switch 5', [[move('Protect', 0, 1)], []], [[], [bench('Amoonguss', 3)]]))
      .toBeNull();
  });
});
