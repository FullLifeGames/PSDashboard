import { test, expect, describe } from 'vitest';
import { buildSetsExport, parseSetsImport } from '../src/lib/sets-io';
import type { OpponentTeamInfo } from '../packages/replay-core/src/types';

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

  test('accepts a one-sided import and rejects headerless text with guidance', () => {
    const oneSided = parseSetsImport('=== p2 ===\n\nKingambit @ Leftovers\n- Sucker Punch');
    expect(oneSided.p1).toHaveLength(0);
    expect(oneSided.p2).toHaveLength(1);

    expect(() => parseSetsImport('Kingambit @ Leftovers\n- Sucker Punch'))
      .toThrow(/=== p1/);
  });
});
