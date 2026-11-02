import { describe, expect, test } from 'vitest';
import { calcSingleDamageRange, type DamageResult } from '@fulllifegames/eval-engine';
import { fullMoveTitle, hitSharesText, koVerdict, ppTextFor, shortRange } from '../../../src/lib/move-damage-text';
import { moveOption, pokemon } from '../fixtures/sim-state';

/**
 * Round 84 (turn dock), step A3b: the texts of a move tile and its tooltip, with the cases the old MoveBtn spec held (round 67,
 * T136 point 1: the hit distribution of Bullet Seed; round 83: the short KO verdict).
 */
const damage = (min: number, max: number, koChance = ''): DamageResult =>
  ({ moveName: 'Earthquake', minPercent: min, maxPercent: max, range: `${min}% - ${max}%`, koChance });

describe('move damage text', () => {
  test('the KO verdict drops the "after" clause and shortens "chance to"', () => {
    expect(koVerdict('guaranteed 2HKO after Leftovers recovery')).toBe('guaranteed 2HKO');
    expect(koVerdict('62.5% chance to OHKO')).toBe('62.5% to OHKO');
    expect(koVerdict('')).toBe('');
  });

  test('a range reads in whole percent, and one number when both ends round alike', () => {
    expect(shortRange(44.6, 53.8)).toBe('45-54%');
    expect(shortRange(30.2, 30.4)).toBe('30%');
  });

  test('PP reads current over maximum, a dash without a maximum', () => {
    expect(ppTextFor(moveOption('Earthquake', { pp: 14, maxpp: 16 }))).toBe('14/16');
    expect(ppTextFor(moveOption('Struggle', { pp: 0, maxpp: 0 }))).toBe('—');
  });

  test('the tooltip leads with the range and the whole KO sentence; no damage gives none', () => {
    expect(fullMoveTitle(damage(30, 35, 'guaranteed 3HKO'))).toBe('30% - 35% (guaranteed 3HKO)');
    expect(fullMoveTitle(damage(30, 35))).toBeUndefined();
    expect(fullMoveTitle(undefined)).toBeUndefined();
  });

  test('Bullet Seed into Blissey names each hit count with its chance and range', () => {
    const breloom = pokemon('Breloom', { ability: '', item: '', nature: 'Hardy', evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 0, spe: 0 }, isActive: true, activeSlot: 0 });
    const blissey = pokemon('Blissey', { ability: '', item: '', nature: 'Hardy', evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 0, spe: 0 }, isActive: true, activeSlot: 0 });
    const result = calcSingleDamageRange(breloom, blissey, moveOption('Bullet Seed', { type: 'Grass', pp: 30, maxpp: 30 }), { gameType: 'Singles', gen: 9 });
    const counts = result.hitShares ?? [];
    expect(counts.map(({ hits, chance }) => [hits, chance])).toEqual([[2, 0.35], [3, 0.35], [4, 0.15], [5, 0.15]]);
    const expected = counts.map(({ hits, chance, minPercent, maxPercent }) => `${hits} hits (${Math.round(chance * 1000) / 10}%): ${minPercent}% - ${maxPercent}%`).join(' · ');
    expect(hitSharesText(result)).toBe(expected);
    const sentence = result.koChance ? `${result.range} (${result.koChance}) · ` : '';
    expect(fullMoveTitle(result)).toBe(`${sentence}${expected}`);
    expect(expected).toContain('2 hits (35%)');
    expect(expected).toContain('5 hits (15%)');
  });
});
