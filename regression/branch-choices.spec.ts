import { test, expect } from '@playwright/test';
import {
  branchSideChoicesReady,
  buildBranchSideCommand,
  conflictingSwitchTargets,
  requiredChoicesForActiveSlots,
} from '../src/lib/branch-choices';

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
    expect(branchSideChoicesReady(['switch 3', 'switch 3'], [true, true])).toBe(false);
    expect(conflictingSwitchTargets(['switch 3', 'switch 3'], [true, true])).toEqual([3]);
    expect(branchSideChoicesReady(['switch 3', 'switch 4'], [true, true])).toBe(true);
  });

  test('builds pass placeholders only for slots that do not require choices', () => {
    expect(buildBranchSideCommand(['switch 3', null], [true, false])).toBe('switch 3, pass');
    expect(branchSideChoicesReady(['switch 3', null], [true, false])).toBe(true);
    expect(branchSideChoicesReady(['switch 3', null], [true, true])).toBe(false);
  });
});
