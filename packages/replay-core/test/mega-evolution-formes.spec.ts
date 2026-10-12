import { describe, expect, test } from 'vitest';
import { Dex } from '@pkmn/sim';
import { megaEvolution } from '../src/protocol/speed-evidence';
import { generationsFor } from '../src/format-generations';

/**
 * Round 69 (lane A's request, T190): the tempo evidence marks a forme change as a Mega Evolution from the Dex. The
 * Mega-Z formes of Champions (Garchomp-Mega-Z, Absol-Mega-Z) carry no isMega flag; the simulator's canMegaEvo reads
 * the holder's item (`megaStone`, a map from the base species to the forme), so the Dex says it for them too. The
 * check is about species and items, not the game type: a singles and a doubles log hold the same forme change line.
 */
const data = generationsFor('[Gen 9 Champions] OU').get(9);

describe('megaEvolution reads the Mega formes from the Dex', () => {
  test('every forme a Mega Stone of the Dex turns a species into counts, the Mega-Z formes among them', () => {
    const stones = Dex.items.all().filter(item => item.megaStone);
    const formes = stones.flatMap(item => Object.values(item.megaStone!));
    expect(formes).toContain('Garchomp-Mega-Z');
    expect(formes).toContain('Absol-Mega-Z');
    for (const forme of formes) expect(megaEvolution(data, forme), forme).toBe(true);
  });

  test('a forme a stone does not make is no Mega Evolution (battle formes, plain species)', () => {
    for (const species of ['Garchomp', 'Zacian-Crowned', 'Greninja-Ash', 'Aegislash-Blade', 'Mimikyu-Busted']) {
      expect(megaEvolution(data, species), species).toBe(false);
    }
  });

  test('Ultra Burst and Rayquaza-Mega (no stone) keep counting', () => {
    expect(megaEvolution(data, 'Necrozma-Ultra')).toBe(true);
    expect(megaEvolution(data, 'Rayquaza-Mega')).toBe(true);
  });
});
