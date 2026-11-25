import { beforeAll, describe, expect, test } from 'vitest';
import { Dex } from '@pkmn/sim';
import { loadSimMods } from '@fulllifegames/eval-engine';
import {
  getAbilityPool, getEveryAbilityPool, getEveryMovePool, getEvLimit, getItemPool, getMovePool, getTeraTypePool,
} from '../../../src/lib/pokemon-options';

const CHAMPIONS_FORMATS = ['gen9championsou', 'gen9championsvgc2026regmcbo3'];

beforeAll(async () => {
  await loadSimMods('gen9championsou');
});

describe('Champions pools', () => {
  const mod = () => Dex.mod('champions');

  for (const format of CHAMPIONS_FORMATS) {
    test(`${format}: the item pool is the mod's standard items, Mega Stones included`, () => {
      const wanted = [...mod().items.all()].filter(item => !item.isNonstandard).map(item => item.name);
      const pool = getItemPool(9, format);
      expect([...pool].sort()).toEqual([...wanted].sort());
      const megaStones = [...mod().items.all()].filter(item => item.megaStone && !item.isNonstandard).map(item => item.name);
      expect(megaStones.length).toBeGreaterThan(0);
      expect(megaStones.filter(name => !pool.includes(name))).toEqual([]);
    });

    test(`${format}: no Tera type exists`, () => {
      expect(getTeraTypePool(9, format)).toEqual([]);
    });

    test(`${format}: Aegislash and Garchomp get the mod's abilities and learnsets`, async () => {
      for (const species of ['Aegislash', 'Garchomp']) {
        const entry = mod().species.get(species);
        expect(getAbilityPool(species, 9, format)).toEqual(Object.values(entry.abilities).filter(Boolean));
        const learnset = (await mod().learnsets.get(entry.id)).learnset ?? {};
        const wanted = Object.keys(learnset).map(id => mod().moves.get(id).name);
        const pool = await getMovePool(species, 9, format);
        expect(pool.length).toBeGreaterThan(0);
        expect([...pool].sort()).toEqual([...wanted].sort());
      }
      expect(getAbilityPool('Aegislash', 9, format)).toContain('Stance Change');
    });

    test(`${format}: a species the mod marks Past (Golisopod) still gets a non-empty pool`, async () => {
      expect(getAbilityPool('Golisopod', 9, format)).toContain('Emergency Exit');
      expect((await getMovePool('Golisopod', 9, format)).length).toBeGreaterThan(0);
    });

    test(`${format}: the whole move and ability lists are the mod's standard entries`, () => {
      const moves = [...mod().moves.all()].filter(move => !move.isNonstandard).map(move => move.name);
      const abilities = [...mod().abilities.all()].filter(ability => !ability.isNonstandard).map(ability => ability.name);
      expect([...getEveryMovePool(9, format)].sort()).toEqual([...moves].sort());
      expect([...getEveryAbilityPool(9, format)].sort()).toEqual([...abilities].sort());
      expect(getEveryAbilityPool(9, format)).toContain('Intimidate');
    });

    test(`${format}: the EV limit is the validator limit of 66`, () => {
      expect(getEvLimit(format)).toBe(66);
    });
  }
});

describe('a Champions format the mod does not list', () => {
  // The mod lists Regulation M-C only, so an M-B replay's format is unlisted too.
  const UNLISTED = ['gen9championsubers', 'gen9championsvgc2026regmabo3', 'gen9championsvgc2026regmbbo3', 'gen9championsdoublesou'];

  for (const format of UNLISTED) {
    test(`${format}: the simulator does not know it, the total is still the Champions ruleset's`, () => {
      expect(Dex.formats.get(format).exists).toBe(false);
      const listed = Dex.formats.getRuleTable(Dex.formats.get('gen9championsou')).evLimit;
      expect(listed).toBe(66);
      expect(getEvLimit(format)).toBe(listed);
    });
  }

  test('a listed Champions custom game keeps the simulator\'s answer, none', () => {
    expect(getEvLimit('gen9championsdoublescustomgame')).toBeNull();
  });
});

describe('Scarlet/Violet pools stay', () => {
  for (const format of ['gen9ou', 'gen9doublesou']) {
    test(`${format}: Tera pool has Stellar, no Mega Stone, total EV limit 510`, () => {
      expect(getTeraTypePool(9, format)).toContain('Stellar');
      expect(getItemPool(9, format)).not.toContain('Abomasite');
      expect(getItemPool(9, format)).toContain('Leftovers');
      expect(getEvLimit(format)).toBe(510);
    });
  }

  test('a format without a total (Gen 2) reads null, an unknown format reads null', () => {
    expect(getEvLimit('gen2ou')).toBeNull();
    expect(getEvLimit('gen9nosuchformat')).toBeNull();
  });
});
