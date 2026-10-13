import { describe, expect, test } from 'vitest';
import { applyTeamSheetToInfo } from '../src/team-sheets.ts';
import type { OpponentTeamInfo, PokemonEvs, PokemonEvsInfo } from '../src/types.ts';

/**
 * Round 70 (T205, panel half): a posted team sheet carries IVs, and the stats panel showed none of them (13 of 336
 * built sets with an IV below 31 lacked it, and Slowking read Speed IV 0 where the sheet plays 31), because the
 * overlay copied the sheet's EVs but not its IVs. The sheet is authoritative for its side, as for every other field;
 * proof and the user's own input still win.
 */

const allIvs = (ivs: Partial<PokemonEvs> = {}): PokemonEvs => ({ hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31, ...ivs });

const infoWith = (ivs?: PokemonEvsInfo): OpponentTeamInfo => ({
  pokemon: [{
    species: 'Heatran',
    moves: [{ name: 'Overheat', source: 'revealed' }],
    ability: { value: '', source: 'unknown' },
    item: { value: '', source: 'unknown' },
    teraType: { value: '', source: 'unknown' },
    evs: { value: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, source: 'unknown' },
    ...(ivs ? { ivs } : {}),
    level: 100,
    gender: 'M',
  }],
} as OpponentTeamInfo);

const sheetWith = (ivs: Partial<PokemonEvs>) => [{
  name: 'Fire Shadow', species: 'Heatran', item: 'Choice Scarf', ability: 'Flash Fire',
  moves: ['Power Gem', 'Overheat', 'Flamethrower', 'Steel Beam'], nature: 'Modest',
  evs: { hp: 80, atk: 0, def: 0, spa: 252, spd: 0, spe: 176 },
  ivs: allIvs(ivs),
  level: 100, gender: 'M', teraType: 'Fire',
}] as never;

describe('a posted team sheet fills the IVs the panel shows', () => {
  test('a lowered IV on the sheet reaches the panel with the sheet as its source', () => {
    const out = applyTeamSheetToInfo(infoWith(), sheetWith({ atk: 0 })).pokemon[0];
    expect(out.ivs).toEqual({ value: allIvs({ atk: 0 }), source: 'sheet', sourceDetail: expect.stringContaining('team sheet') });
  });

  test('the sheet replaces a guessed IV table, also with an all-31 sheet', () => {
    const guessed: PokemonEvsInfo = { value: allIvs({ spe: 0 }), source: 'guessed' };
    expect(applyTeamSheetToInfo(infoWith(guessed), sheetWith({ atk: 0 })).pokemon[0].ivs?.value).toEqual(allIvs({ atk: 0 }));
    expect(applyTeamSheetToInfo(infoWith(guessed), sheetWith({})).pokemon[0].ivs).toMatchObject({ value: allIvs(), source: 'sheet' });
  });

  test('IVs the user typed stay', () => {
    const manual: PokemonEvsInfo = { value: allIvs({ spe: 0 }), source: 'manual' };
    expect(applyTeamSheetToInfo(infoWith(manual), sheetWith({ atk: 0 })).pokemon[0].ivs).toEqual(manual);
  });

  test('an all-31 sheet adds no IV table where none stood', () => {
    expect(applyTeamSheetToInfo(infoWith(), sheetWith({})).pokemon[0].ivs).toBeUndefined();
  });
});
