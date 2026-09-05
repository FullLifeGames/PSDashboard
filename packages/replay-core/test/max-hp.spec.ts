import { describe, expect, test } from 'vitest';
import { hpEvsForMaxHp, observedMaxHp } from '../src/spreads/max-hp';

/**
 * Round 40: a server log prints every Pokémon's exact maximum HP on its
 * switch line; at level 100 that pins the HP EVs (573756 Garchomp 409/409
 * = 208 HP EVs, so 300 EVs remain for 252 Spe — the 252-HP rung the fitter
 * used to pick reads 420 HP and contradicts the log).
 */
describe('max HP from the log', () => {
  test('reads the first switch or drag line per side and species, skipping percent logs', () => {
    const log = [
      '|switch|p2a: Penal Battalion|Garchomp, F|409/409',
      '|switch|p1a: Corviknight|Corviknight, F|399/399',
      '|-damage|p1a: Corviknight|157/399',
      '|switch|p1a: Toxapex|Toxapex, F|250/303',
      '|drag|p2a: Conscripts|Toxapex, M|304/304',
      '|switch|p2a: Penal Battalion|Garchomp, F|44/409',
      '|switch|p1a: Clefable|Clefable, L50, F|100/100',
    ].join('\n');
    const seen = observedMaxHp(log);
    expect(seen.get('p2:garchomp')).toEqual({ maxhp: 409, level: 100 });
    expect(seen.get('p1:corviknight')).toEqual({ maxhp: 399, level: 100 });
    expect(seen.get('p1:toxapex')).toEqual({ maxhp: 303, level: 100 });
    expect(seen.get('p2:toxapex')).toEqual({ maxhp: 304, level: 100 });
    // A percent log carries no measurement.
    expect(seen.get('p1:clefable')).toBeUndefined();
  });

  test('reads the level from the details', () => {
    const seen = observedMaxHp('|switch|p1a: Uxie|Uxie, L50|182/182');
    expect(seen.get('p1:uxie')).toEqual({ maxhp: 182, level: 50 });
  });

  test('inverts the HP formula at level 100 exactly', () => {
    // Garchomp base 108: 409 = (216 + 31 + 52) + 110 → 52 × 4 = 208 EVs.
    expect(hpEvsForMaxHp(108, 100, 409, 0)).toBe(208);
    // Kyurem base 125: 405 → 56; Zapdos-Galar base 90: 321 → 0; Landorus-T base 89: 382 → 252.
    expect(hpEvsForMaxHp(125, 100, 405, 0)).toBe(56);
    expect(hpEvsForMaxHp(90, 100, 321, 252)).toBe(0);
    expect(hpEvsForMaxHp(89, 100, 382, 0)).toBe(252);
    // No 31-IV spread reaches this HP: unknown IVs, no measurement.
    expect(hpEvsForMaxHp(108, 100, 300, 0)).toBeUndefined();
    expect(hpEvsForMaxHp(108, 100, 500, 0)).toBeUndefined();
  });

  test('at level 50 several EV counts share one HP: the one nearest the prior wins', () => {
    // Uxie base 75 at level 50: HP = floor((181 + e) / 2) + 60 with e = floor(EV/4).
    // 160 HP ⇐ e ∈ {19, 20} → EVs 76 or 80; 182 HP ⇐ e = 63 → 252 alone.
    expect(hpEvsForMaxHp(75, 50, 160, 0)).toBe(76);
    expect(hpEvsForMaxHp(75, 50, 160, 252)).toBe(80);
    expect(hpEvsForMaxHp(75, 50, 182, 0)).toBe(252);
  });
});
