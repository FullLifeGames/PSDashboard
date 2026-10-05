import { describe, expect, test } from 'vitest';
import { getMovePool } from '../src/lib/pokemon-options';

/**
 * T96 (3): the team editor and the "What if it had…" box offer what a forme
 * really learns. A forme's own learnset holds only its signature moves
 * (Rotom-Wash: Hydro Pump); the rest comes from the forme it changes from,
 * which the data library walks along with prevos (learnsets.all).
 */
describe('move pools of alternate formes', () => {
  test('Rotom-Wash learns what Rotom learns, plus Hydro Pump', async () => {
    const pool = await getMovePool('Rotom-Wash', 9);
    expect(pool).toEqual(expect.arrayContaining(['Hydro Pump', 'Thunderbolt', 'Volt Switch', 'Will-O-Wisp']));
  });

  test('Necrozma-Dusk-Mane keeps Necrozma\'s moves next to its own', async () => {
    const pool = await getMovePool('Necrozma-Dusk-Mane', 9);
    expect(pool).toEqual(expect.arrayContaining(['Sunsteel Strike', 'Photon Geyser', 'Earthquake']));
  });

  test('prevos and the generation filter work as before', async () => {
    expect(await getMovePool('Machoke', 3)).toContain('Low Kick');
    expect(await getMovePool('Machoke', 3)).not.toContain('Close Combat');
    const garchomp = await getMovePool('Garchomp', 9);
    expect(garchomp).toContain('Earthquake');
    expect(garchomp).not.toContain('Spore');
  });
});
