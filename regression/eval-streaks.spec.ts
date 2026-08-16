import { test, expect } from '@playwright/test';
import { detectStreakOdds, type StreakHistoryEntry } from '../src/lib/eval/streaks';

const entry = (over: Partial<StreakHistoryEntry> = {}): StreakHistoryEntry => ({
  attacker: 'Kyurem', moveId: 'icebeam', defender: 'Blissey', movedFirst: true,
  attackerAbility: 'pressure', defenderAbility: 'naturalcure', defenderItem: 'leftovers',
  defenderBoosts: { def: 0, spd: 0 }, ...over,
});

test.describe('secondary fishing', () => {
  test('five Ice Beams compound freeze to 1 − 0.9^5', () => {
    const result = detectStreakOdds(6, [entry(), entry(), entry(), entry(), entry()]);
    expect(result).not.toBeNull();
    expect(result!.event).toBe('freeze');
    expect(result!.n).toBe(5);
    expect(result!.perTurn).toBeCloseTo(0.1, 9);
    expect(result!.cumulative).toBeCloseTo(1 - 0.9 ** 5, 9);
  });
  test('milestones only: n = 4 is silent', () => {
    expect(detectStreakOdds(6, [entry(), entry(), entry(), entry()])).toBeNull();
  });
  test('a break in the streak resets it', () => {
    expect(detectStreakOdds(6, [entry(), entry(), null, entry(), entry()])).toBeNull();
  });
  test('Serene Grace doubles the chance', () => {
    const e = () => entry({ attacker: 'Jirachi', moveId: 'ironhead', attackerAbility: 'serenegrace' });
    const result = detectStreakOdds(6, [e(), e(), e()]);
    expect(result!.event).toBe('flinch');
    expect(result!.perTurn).toBeCloseTo(0.6, 9);
  });
  test('flinch requires moving first on every streak turn', () => {
    const e = (movedFirst: boolean) => entry({ moveId: 'ironhead', movedFirst });
    expect(detectStreakOdds(6, [e(true), e(false), e(true)])).toBeNull();
  });
  test('Shield Dust silences secondary fishing', () => {
    const e = () => entry({ defenderAbility: 'shielddust' });
    expect(detectStreakOdds(6, [e(), e(), e()])).toBeNull();
  });
  test('gen 2 and below stay silent', () => {
    expect(detectStreakOdds(2, [entry(), entry(), entry()])).toBeNull();
  });
});

test.describe('crit vs boost wall', () => {
  test('attacks into a boosted special wall accumulate crit odds', () => {
    // Different moves are fine — the crit streak keys on attacker+defender.
    const e = (moveId: string) => entry({ moveId, defenderBoosts: { def: 0, spd: 2 }, defenderAbility: 'shielddust' });
    const result = detectStreakOdds(6, [e('icebeam'), e('earthpower'), e('icebeam')]);
    expect(result).not.toBeNull();
    expect(result!.event).toBe('crit');
    expect(result!.perTurn).toBeCloseTo(1 / 16, 9);
    expect(result!.cumulative).toBeCloseTo(1 - (15 / 16) ** 3, 9);
  });
  test('gen 7+ crit rate is 1/24', () => {
    const e = () => entry({ defenderBoosts: { def: 0, spd: 1 }, defenderAbility: 'shielddust' });
    expect(detectStreakOdds(8, [e(), e(), e()])!.perTurn).toBeCloseTo(1 / 24, 9);
  });
  test('no boost, no crit story', () => {
    // Earth Power's only secondary is a stat drop (not fished), no boosts → null.
    const e = () => entry({ defenderAbility: 'shielddust', moveId: 'earthpower' });
    expect(detectStreakOdds(6, [e(), e(), e()])).toBeNull();
  });
});
