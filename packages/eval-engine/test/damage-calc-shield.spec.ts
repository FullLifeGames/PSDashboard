import { describe, expect, test, vi } from 'vitest';
import { Generations, Pokemon } from '@smogon/calc';
import { calcSingleDamageRange } from '../src/damage-calc';
import type { BranchMoveOption, SimPokemonInfo } from '../src/branch-engine';

/**
 * Round 68 (T186, decision 4, wiring): damage-calc.ts `shieldedBy` asks protectBlocks (calc/protect.ts) before the calc
 * sees the partner's Protect. Only a smart-target move (Dragon Darts) reaches it, and only in doubles, with the defender's
 * partner on the field: singles have no partner, so the preview never asks there. Dragon Darts into Snorlax with Garchomp
 * (Dragon-weak) behind it: with no partner pick one dart goes to each, so the preview prices one hit on Snorlax; when the
 * partner's pick shields it (Protect, going first), both darts land on Snorlax. The simulator's answer for the move comes
 * from protectBlocks: stubbed to "Protect does not stop it" the shield does not count and the preview is back at one dart.
 * protect-at-use.spec.ts holds protectBlocks itself against real battles.
 */
const blocks = vi.hoisted(() => ({ forced: undefined as boolean | undefined }));
vi.mock('../src/calc/protect.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/calc/protect')>();
  return { ...actual, protectBlocks: (...args: Parameters<typeof actual.protectBlocks>) => blocks.forced ?? actual.protectBlocks(...args) };
});

const gen9 = Generations.get(9);
const STATS = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
function mon(species: string, overrides: Partial<SimPokemonInfo> = {}): SimPokemonInfo {
  const evs = { ...STATS, hp: 252, spa: 252 };
  const maxhp = new Pokemon(gen9, species, { level: 100, evs }).maxHP();
  return {
    name: species, species, hp: maxhp, maxhp, hpPercent: 100, status: '', fainted: false, isActive: true, activeSlot: 0,
    moves: [], ability: '', item: '', stats: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, nature: 'Hardy', evs,
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, gender: '', teraType: '', boosts: {}, level: 100,
    types: [], ...overrides,
  };
}
const darts: BranchMoveOption = { name: 'Dragon Darts', activeSlot: 0, slot: 1, pp: 16, maxpp: 16, disabled: false, type: '', targetType: 'normal', requiresTarget: true, targetOptions: [] };

describe('the preview asks protectBlocks about the partner\'s Protect (doubles)', () => {
  const dragapult = mon('Dragapult');
  const snorlax = mon('Snorlax');
  const garchomp = mon('Garchomp');
  const doubles = { gameType: 'Doubles' as const, defenderPartner: garchomp, attackerPartnerAlive: true };
  const damage = (context: Parameters<typeof calcSingleDamageRange>[3]) => calcSingleDamageRange(dragapult, snorlax, darts, context).maxPercent;

  test('a partner that picks Protect leaves both darts on the defender', () => {
    blocks.forced = undefined;
    const open = damage(doubles);
    const shielded = damage({ ...doubles, defenderPartnerMove: 'protect' });
    expect(shielded / open).toBeCloseTo(2, 1);
  });

  test('when the simulator lets Protect fail to stop the move, the shield does not count', () => {
    blocks.forced = undefined;
    const open = damage(doubles);
    blocks.forced = false;
    try {
      expect(damage({ ...doubles, defenderPartnerMove: 'protect' })).toBe(open);
    } finally {
      blocks.forced = undefined;
    }
  });

  test('a pick that is no shield changes nothing, and the preview without the field is the calc\'s own reading', () => {
    blocks.forced = undefined;
    expect(damage({ ...doubles, defenderPartnerMove: 'roost' })).toBe(damage(doubles));
    expect(damage({ gameType: 'Doubles' })).toBeGreaterThan(0);
  });
});
