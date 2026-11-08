import { describe, expect, test } from 'vitest';
import { Dex } from '@pkmn/sim';
import { buildSmogonStatsUrls, getSmogonStatsFormat } from '../../src/lib/smogon-stats';

/**
 * Round 88 (F, #101, user ruling 3): the usage file of a format keeps the format's generation. `ouFallbackFormat` sent every doubles
 * id to gen9doublesou, so a Gen 4 Doubles OU game read Gen 9 usage and the stand-ins for its unshown bodies would have come from Gen 9
 * species. The sweep plays every format of the Dex; the scene is one row of it. Every doubles game of the measurement corpora is
 * Generation 9, where the answer is the same as before.
 */
const genOf = (id: string) => id.match(/^gen\d+/)?.[0];

describe('the stats file of a doubles format', () => {
  test('every format of the Dex reads a stats file of its own generation', () => {
    const formats = Dex.formats.all().filter(format => format.effectType === 'Format');
    expect(formats.length).toBeGreaterThan(150);
    expect(formats.filter(format => /doubles|vgc/.test(format.id) && genOf(format.id) !== 'gen9').length).toBeGreaterThan(10);
    const wrong = formats.filter(format => genOf(format.id) && genOf(getSmogonStatsFormat(format.id)) !== genOf(format.id))
      .map(format => `${format.id} -> ${getSmogonStatsFormat(format.id)}`);
    expect(wrong).toEqual([]);
  });

  test('Gen 4 and Gen 3 Doubles OU read their own generation, then its OU and Ubers files', () => {
    expect(getSmogonStatsFormat('gen4doublesou')).toBe('gen4doublesou');
    expect(buildSmogonStatsUrls('gen4doublesou').map(candidate => candidate.format)).toEqual(['gen4doublesou', 'gen4ou', 'gen4ubers']);
    expect(buildSmogonStatsUrls('gen3doublesou').map(candidate => candidate.format)).toEqual(['gen3doublesou', 'gen3ou', 'gen3ubers']);
    expect(buildSmogonStatsUrls('smogtours-gen4doublesou-12')[0].url).toBe('https://data.pkmn.cc/stats/gen4doublesou.json');
  });

  test('the Generation 9 answers stay: Doubles OU, its variants and the year files of VGC', () => {
    for (const id of ['gen9doublesou', 'gen9doublesubers', 'gen9doublescustomgame', 'gen9doubleslc', 'doublesou']) {
      expect(getSmogonStatsFormat(id)).toBe('gen9doublesou');
    }
    expect(getSmogonStatsFormat('gen9nationaldexdoubles')).toBe('gen9nationaldexdoubles');
    expect(getSmogonStatsFormat('gen9vgc2026regi')).toBe('gen9vgc2026');
    expect(getSmogonStatsFormat('gen9championsvgc2026regmb')).toBe('gen9championsvgc2026');
  });
});
