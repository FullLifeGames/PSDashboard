import { describe, expect, test } from 'vitest';
import { Dex } from '@pkmn/sim';
import { isChampionsFormat } from '@fulllifegames/replay-core';
import { isChampionsSimFormat } from '../src/forward/sim-mods';

/**
 * Round 75 (T160): the engine's name for "is this a Champions format" is replay-core's one rule. This compares the two over every
 * format of the base Dex and a set of spellings the hosts hand over, so a second regex cannot return under the old name.
 */
describe('isChampionsSimFormat is replay-core isChampionsFormat', () => {
  const spellings = [
    'gen9championsou', 'gen9championsdoublescustomgame', 'gen9championsvgc2026regmbbo3', 'smogtours-gen9championsou-12',
    'gen9championsou@@@+sleepclausemod', '[Gen 9 Champions] OU', '[Gen 9] Champions VGC 2026 Reg M-A (Bo3)',
    'gen9customgame', 'gen9ou', '[Gen 9] OU', 'gen9vgc2026regi', '',
  ];

  test('same answer on every spelling and on every format of the base Dex (id and name)', () => {
    const all = [...spellings, ...Dex.formats.all().flatMap(format => [format.id, format.name])];
    expect(all.length).toBeGreaterThan(300);
    expect(all.filter(format => isChampionsSimFormat(format) !== isChampionsFormat(format))).toEqual([]);
  });

  test('the Champions spellings are Champions and the others are not', () => {
    expect(spellings.filter(isChampionsSimFormat)).toEqual(spellings.slice(0, 7));
  });
});
