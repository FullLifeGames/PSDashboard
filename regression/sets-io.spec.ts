import { test, expect, describe } from 'vitest';
import { buildSetsExport, parseSetsImport } from '../src/lib/sets-io';
import { enrichTeamInfo, type OpponentTeamInfo, type SmogonSetAssumptions } from '@fulllifegames/replay-core';

const p1Info: OpponentTeamInfo = {
  pokemon: [{
    species: 'Garchomp',
    moves: [
      { name: 'Earthquake', source: 'revealed' },
      { name: 'Scale Shot', source: 'guessed', probability: 0.6 },
    ],
    ability: { value: 'Rough Skin', source: 'revealed' },
    item: { value: 'Loaded Dice', source: 'guessed' },
    teraType: { value: 'Steel', source: 'guessed' },
    evs: { value: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 }, source: 'guessed' },
    nature: { value: 'Jolly', source: 'guessed' },
    level: 100,
    gender: 'M',
  }],
};
const p2Info: OpponentTeamInfo = {
  pokemon: [{
    species: 'Kingambit',
    moves: [{ name: 'Sucker Punch', source: 'revealed' }],
    ability: { value: '', source: 'unknown' },
    item: { value: '(has item)', source: 'revealed' },
    teraType: { value: '', source: 'unknown' },
    evs: { value: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, source: 'unknown' },
    level: 78,
    gender: 'F',
  }],
};

describe('sets import/export', () => {
  test('exports both sides as side-headered Showdown blocks', () => {
    const text = buildSetsExport({ p1Name: 'Alice', p2Name: 'Bob', p1Info, p2Info });

    expect(text).toContain('=== p1: Alice ===');
    expect(text).toContain('=== p2: Bob ===');
    expect(text).toContain('Garchomp (M) @ Loaded Dice');
    expect(text).toContain('Ability: Rough Skin');
    expect(text).toContain('Tera Type: Steel');
    expect(text).toContain('EVs: 252 Atk / 4 SpD / 252 Spe');
    expect(text).toContain('Jolly Nature');
    expect(text).toContain('- Earthquake');
    // Unknown fields stay out of the export entirely:
    expect(text).toContain('Kingambit (F)');
    expect(text).not.toContain('(has item)');
    expect(text).toContain('Level: 78');
    expect(text).not.toContain('Level: 100');
  });

  test('round-trips: parse(export) recovers the sets per side', () => {
    const text = buildSetsExport({ p1Name: 'Alice', p2Name: 'Bob', p1Info, p2Info });
    const parsed = parseSetsImport(text);

    expect(parsed.p1).toHaveLength(1);
    expect(parsed.p1[0]).toMatchObject({
      species: 'Garchomp',
      item: 'Loaded Dice',
      ability: 'Rough Skin',
      teraType: 'Steel',
      nature: 'Jolly',
      moves: ['Earthquake', 'Scale Shot'],
    });
    expect(parsed.p2[0]).toMatchObject({ species: 'Kingambit', level: 78 });
  });

  test('strips the "(consumed)" annotation from exported items', () => {
    const consumedInfo: OpponentTeamInfo = {
      pokemon: [{
        species: 'Sneasler',
        moves: [{ name: 'Close Combat', source: 'revealed' }],
        ability: { value: 'Unburden', source: 'revealed' },
        item: { value: 'Heavy-Duty Boots (consumed)', source: 'revealed' },
        teraType: { value: '', source: 'unknown' },
        evs: { value: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, source: 'unknown' },
        level: 100,
        gender: 'M',
      }],
    };
    const text = buildSetsExport({ p1Name: 'A', p2Name: 'B', p1Info: consumedInfo, p2Info: null });

    expect(text).toContain('Sneasler (M) @ Heavy-Duty Boots');
    expect(text).not.toContain('(consumed)');

    const parsed = parseSetsImport(text);
    expect(parsed.p1[0].item).toBe('Heavy-Duty Boots');
  });
  // Round 69 (T136): the export carries the IVs the build plays (2663093831 Sinistcha: published IV 0 in Attack and Speed).
  for (const format of ['gen9ou', 'gen9doublesou']) {
    test(`exports the IVs of a published Trick Room set and round-trips them (${format})`, () => {
      const assumptions: SmogonSetAssumptions = {
        format, source: 'test',
        pokemon: { sinistcha: {
          species: 'Sinistcha', sourceDetail: 'Smogon sets',
          ability: { value: 'Hospitality', sourceDetail: 'Smogon sets' }, item: { value: 'Sitrus Berry', sourceDetail: 'Smogon sets' },
          moves: ['Rage Powder', 'Trick Room', 'Matcha Gotcha', 'Protect'].map(value => ({ value, sourceDetail: 'Smogon sets' })),
          spread: { value: 'Bold', sourceDetail: 'Smogon sets', nature: 'Quiet', evs: { hp: 252, atk: 0, def: 4, spa: 252, spd: 0, spe: 0 } },
          ivs: { atk: 0, spe: 0 },
        } },
      };
      const raw: OpponentTeamInfo = { pokemon: [{
        species: 'Sinistcha', moves: [], ability: { value: '', source: 'unknown' }, item: { value: '', source: 'unknown' },
        teraType: { value: '', source: 'unknown' }, evs: { value: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, source: 'unknown' },
        level: 100, gender: 'F',
      }] };
      const text = buildSetsExport({ p1Name: 'A', p2Name: 'B', p1Info: enrichTeamInfo(raw, null, assumptions), p2Info: null });
      expect(text).toContain('IVs: 0 Atk / 0 Spe');
      expect(parseSetsImport(text).p1[0].ivs).toEqual({ hp: 31, atk: 0, def: 31, spa: 31, spd: 31, spe: 0 });
    });
  }

  // Round 76 (T234): the library's import gives a set with a typed Hidden Power the type's own IVs (Ice: 30 Atk, 30 Def) unless the
  // text lists IVs, while the build plays a listed Hidden Power at the IVs it has. An export of IVs that are all 31 stays explicit.
  test.each([
    ['singles', 'Tornadus-Therian', ['U-turn', 'Hidden Power Ice', 'Hurricane', 'Knock Off']],
    ['doubles', 'Incineroar', ['Fake Out', 'Hidden Power Ice', 'Parting Shot', 'Knock Off']],
  ])('%s: a set with a typed Hidden Power and IVs of 31 imports at IVs of 31', (_kind, species, moves) => {
    const info: OpponentTeamInfo = { pokemon: [{
      species, moves: moves.map(name => ({ name, source: 'guessed' as const })), ability: { value: '', source: 'unknown' },
      item: { value: '', source: 'unknown' }, teraType: { value: '', source: 'unknown' },
      evs: { value: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, source: 'unknown' }, level: 100,
    }] };
    const text = buildSetsExport({ p1Name: 'A', p2Name: 'B', p1Info: info, p2Info: null });
    expect(parseSetsImport(text).p1[0].ivs).toEqual({ hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 });
  });

  test('accepts a one-sided import and rejects headerless text with guidance', () => {
    const oneSided = parseSetsImport('=== p2 ===\n\nKingambit @ Leftovers\n- Sucker Punch');
    expect(oneSided.p1).toHaveLength(0);
    expect(oneSided.p2).toHaveLength(1);

    expect(() => parseSetsImport('Kingambit @ Leftovers\n- Sucker Punch'))
      .toThrow(/=== p1/);
  });
});
