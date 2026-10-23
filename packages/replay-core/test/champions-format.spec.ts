import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { Dex } from '@pkmn/sim';
import * as championsMod from '@pkmn/mods/champions';
import { calcModOf, CHAMPIONS_MOD } from '../src/calc-gen';
import { replayRuleset, inferReplayFormatId } from '../src/replay-format';
import { isChampionsFormat } from '../src/champions-format';
import { evBudget } from '../src/spreads/ev-budget';

/**
 * Round 75 (T160): one function decides whether a format is Pokémon Champions, for a format id ('gen9championsou'), a replay id
 * ('smogtours-gen9championsou-12'), a branch format with custom rules and the tier name a log prints ('[Gen 9 Champions] OU').
 * Four modules decided on their own before (calcModOf, replayRuleset, isChampionsFormat, eval-engine's isChampionsSimFormat) and
 * a tier name with its capitals read as no Champions format in one of them. The checker is the Dex: every format of the mod
 * names `mod: 'champions'`, every format of the base Dex names another mod, and the fit corpus manifests list the ids played.
 */
Dex.mod('champions', championsMod as unknown as NonNullable<Parameters<typeof Dex.mod>[1]>);

const manifest = (name: string) => JSON.parse(readFileSync(new URL(`../../../regression/fixtures/${name}`, import.meta.url), 'utf8')) as Record<string, unknown>;

/** Every spelling of one format the hosts hand over: the Dex's id, its name, a replay id, a branch format with rules. */
function spellings(format: { id: string; name: string }): string[] {
  return [format.id, format.name, `${format.id}-2628340185`, `smogtours-${format.id}-12`, `${format.id}@@@+sleepclausemod`];
}

describe('the one Champions rule', () => {
  const champions = (championsMod.Formats as unknown as { id?: string; name: string }[]).map(f => ({ id: f.id ?? f.name.toLowerCase().replace(/[^a-z0-9]/g, ''), name: f.name }));
  const others = Dex.formats.all().filter(f => !/champions/i.test(f.id)).map(f => ({ id: f.id, name: f.name }));

  test('the sample is real: the mod lists Champions formats and the base Dex many others', () => {
    expect(champions.length).toBeGreaterThan(5);
    expect(others.length).toBeGreaterThan(150);
  });

  test('every spelling of a Champions format is Champions in all three replay-core readers', () => {
    const wrong: string[] = [];
    for (const spelling of champions.flatMap(spellings)) {
      if (!isChampionsFormat(spelling)) wrong.push(`isChampionsFormat ${spelling}`);
      if (calcModOf(spelling) !== CHAMPIONS_MOD) wrong.push(`calcModOf ${spelling}`);
      if (evBudget(spelling).statPoints !== true) wrong.push(`evBudget ${spelling}`);
    }
    expect(wrong).toEqual([]);
  });

  test('no spelling of another format is Champions', () => {
    const wrong: string[] = [];
    for (const spelling of others.flatMap(spellings)) {
      if (isChampionsFormat(spelling)) wrong.push(`isChampionsFormat ${spelling}`);
      if (calcModOf(spelling) !== undefined) wrong.push(`calcModOf ${spelling}`);
    }
    expect(wrong).toEqual([]);
  });

  test('the formats and tier names of the corpus manifests and fixtures read alike in every reader', () => {
    const replays = (manifest('fit-corpus-manifest.json').replays as { id: string; format: string }[]);
    const holdoutIds = (manifest('fit-holdout-manifest.json').sets as { ids: string[] }[]).flatMap(set => set.ids);
    const tierNames = ['[Gen 9 Champions] OU', '[Gen 9 Champions] VGC 2026 Reg M-B (Bo3)', '[Gen 9] Champions VGC 2026 Reg M-A (Bo3)', '[Gen 9 Champions] Doubles Custom Game', '[Gen 9] OU', '[Gen 9] Doubles OU', '[Gen 9] VGC 2026 Reg I', '[Gen 3] Ubers'];
    const wrong: string[] = [];
    const samples = [...replays.flatMap(r => [r.id, r.format]), ...holdoutIds, ...tierNames];
    expect(samples.length).toBeGreaterThan(1000);
    for (const sample of samples) {
      const expected = /champions/i.test(sample.replace(/\s/g, ''));
      const log = /^\[/.test(sample) ? `|tier|${sample}\n` : '';
      const readers = {
        isChampionsFormat: isChampionsFormat(sample),
        calcModOf: calcModOf(sample) === CHAMPIONS_MOD,
        replayRuleset: replayRuleset(log ? { log } : { id: sample }) === 'champions',
      };
      for (const [reader, answer] of Object.entries(readers)) if (answer !== expected) wrong.push(`${reader} ${sample}`);
    }
    expect(wrong).toEqual([]);
    expect(inferReplayFormatId({ log: '|tier|[Gen 9 Champions] OU\n' })).toBe('gen9championsou');
  });
});
