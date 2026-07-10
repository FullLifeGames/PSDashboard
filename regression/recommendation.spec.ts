import { test, expect } from '@playwright/test';
import type { BranchMoveOption, BranchTargetOption } from '../src/lib/branch-engine';
import type { DamageResult } from '../src/lib/damage-calc';
import { pickRecommendedMove } from '../src/lib/recommendation';

function makeMove(overrides: Partial<BranchMoveOption> & { name: string; slot: number }): BranchMoveOption {
  return {
    activeSlot: 0,
    pp: 16,
    maxpp: 16,
    disabled: false,
    type: 'Normal',
    targetType: 'normal',
    requiresTarget: false,
    targetOptions: [],
    ...overrides,
  };
}

function makeTarget(side: 'p1' | 'p2', targetLoc: number, name: string): BranchTargetOption {
  return {
    label: `${side.toUpperCase()}${Math.abs(targetLoc) === 1 ? 'A' : 'B'}`,
    targetLoc,
    side,
    activeSlot: Math.abs(targetLoc) - 1,
    name,
    species: name,
    hpPercent: 100,
  };
}

function damage(maxPercent: number): DamageResult {
  return {
    moveName: 'Test Move',
    minPercent: Math.max(0, maxPercent - 10),
    maxPercent,
    range: `${Math.max(0, maxPercent - 10)}% - ${maxPercent}%`,
    koChance: '',
  };
}

test.describe('pickRecommendedMove', () => {
  test('never recommends targeting the own doubles partner even when ally damage is highest', () => {
    // B4 scenario: Ice move deals 2x into the dragon-type partner but must target an enemy.
    const moves = [
      makeMove({
        name: 'Ice Spinner',
        slot: 1,
        requiresTarget: true,
        targetOptions: [
          makeTarget('p2', 1, 'Enemy A'),
          makeTarget('p2', 2, 'Enemy B'),
          makeTarget('p1', -2, 'Partner Hydreigon'),
        ],
      }),
    ];
    const targetDamage: Record<string, DamageResult | undefined> = {
      '1:1': damage(45),
      '1:2': damage(60),
      '1:-2': damage(180),
    };

    const recommendation = pickRecommendedMove('p1', moves, [], targetDamage);
    expect(recommendation).not.toBeNull();
    expect(recommendation!.targetLoc).toBe(2);
    expect(recommendation!.score).toBe(60);
  });

  test('skips moves that can only target allies', () => {
    const moves = [
      makeMove({
        name: 'Helping Hand',
        slot: 1,
        requiresTarget: true,
        targetOptions: [makeTarget('p1', -2, 'Partner')],
      }),
      makeMove({
        name: 'Dark Pulse',
        slot: 2,
        requiresTarget: true,
        targetOptions: [makeTarget('p2', 1, 'Enemy A')],
      }),
    ];
    const targetDamage: Record<string, DamageResult | undefined> = {
      '1:-2': damage(0),
      '2:1': damage(70),
    };

    const recommendation = pickRecommendedMove('p1', moves, [], targetDamage);
    expect(recommendation!.move.name).toBe('Dark Pulse');
    expect(recommendation!.targetLoc).toBe(1);
  });

  test('uses default damage for moves without target options and skips disabled moves', () => {
    const moves = [
      makeMove({ name: 'Earthquake', slot: 1 }),
      makeMove({ name: 'Hyper Beam', slot: 2, disabled: true }),
    ];
    const defaultDamage = [damage(55), damage(150)];

    const recommendation = pickRecommendedMove('p2', moves, defaultDamage, {});
    expect(recommendation!.move.name).toBe('Earthquake');
    expect(recommendation!.targetLoc).toBeUndefined();
  });
});
