import { test, expect } from '@playwright/test';
import { applyPastedTeam, countMatchingSpecies, parsePastedTeam } from '../src/lib/team-paste';
import { parseTeamText } from '../src/lib/team-parser';
import type { OpponentTeamInfo } from '../src/types';

const showdownExport = [
  'Shinyhead (Toxtricity) (M) @ Throat Spray',
  'Ability: Punk Rock',
  'Tera Type: Normal',
  'EVs: 4 Def / 252 SpA / 252 Spe',
  'Modest Nature',
  '- Boomburst',
  '- Overdrive',
  '- Volt Switch',
  '- Shift Gear',
  '',
  'Skarmory @ Rocky Helmet',
  'Ability: Sturdy',
  'EVs: 252 HP / 252 Def / 4 SpD',
  '- Roost',
  '- Spikes',
  '- Body Press',
  '- Whirlwind',
].join('\n');

const baseInfo: OpponentTeamInfo = {
  pokemon: [
    {
      species: 'Toxtricity',
      moves: [{ name: 'Boomburst', source: 'revealed' }],
      ability: { value: '', source: 'unknown' },
      item: { value: '', source: 'unknown' },
      teraType: { value: '', source: 'unknown' },
      evs: { value: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, source: 'unknown' },
      level: 100,
      gender: 'M',
    },
    {
      species: 'Garchomp',
      moves: [],
      ability: { value: '', source: 'unknown' },
      item: { value: '', source: 'unknown' },
      teraType: { value: '', source: 'unknown' },
      evs: { value: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, source: 'unknown' },
      level: 100,
      gender: '',
    },
  ],
};

test.describe('team paste pipeline (G15)', () => {
  test('parses nature, IVs, and level lines (perfect-information import)', () => {
    const sets = parsePastedTeam([
      'Garchomp @ Loaded Dice',
      'Ability: Rough Skin',
      'Level: 78',
      'Tera Type: Steel',
      'EVs: 252 Atk / 4 SpD / 252 Spe',
      'Jolly Nature',
      'IVs: 0 SpA / 29 Spe',
      '- Earthquake',
      '- Scale Shot',
    ].join('\n'));

    expect(sets).toHaveLength(1);
    expect(sets[0].nature).toBe('Jolly');
    expect(sets[0].level).toBe(78);
    expect(sets[0].ivs).toEqual({ hp: 31, atk: 31, def: 31, spa: 0, spd: 31, spe: 29 });
  });

  test('overlays nature, IVs, and level as manual knowledge', () => {
    const info: OpponentTeamInfo = {
      pokemon: [{
        species: 'Garchomp',
        moves: [],
        ability: { value: '', source: 'unknown' },
        item: { value: '', source: 'unknown' },
        teraType: { value: '', source: 'unknown' },
        evs: { value: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, source: 'unknown' },
        level: 100,
        gender: '',
      }],
    };
    const sets = parsePastedTeam('Garchomp\nJolly Nature\nLevel: 78\nIVs: 0 Atk\n- Earthquake');

    const { info: applied } = applyPastedTeam(info, sets);

    expect(applied.pokemon[0].nature).toEqual({ value: 'Jolly', source: 'manual' });
    expect(applied.pokemon[0].ivs?.source).toBe('manual');
    expect(applied.pokemon[0].ivs?.value.atk).toBe(0);
    expect(applied.pokemon[0].level).toBe(78);
  });

  test('strips "(consumed)" annotations from pasted item lines', () => {
    const sets = parsePastedTeam('Sneasler @ Heavy-Duty Boots (consumed)\n- Close Combat');
    expect(sets[0].item).toBe('Heavy-Duty Boots');

    // A pure placeholder never becomes a set item.
    const placeholder = parsePastedTeam('Sneasler @ (has item)\n- Close Combat');
    expect(placeholder[0].item).toBeUndefined();
  });

  test('parses Showdown exports including nicknames, items, and EVs', () => {
    const sets = parsePastedTeam(showdownExport);
    expect(sets).toHaveLength(2);
    expect(sets[0]).toEqual(expect.objectContaining({
      species: 'Toxtricity',
      nickname: 'Shinyhead',
      item: 'Throat Spray',
      ability: 'Punk Rock',
      teraType: 'Normal',
    }));
    expect(sets[0].evs).toEqual({ hp: 0, atk: 0, def: 4, spa: 252, spd: 0, spe: 252 });
    expect(sets[0].moves).toEqual(['Boomburst', 'Overdrive', 'Volt Switch', 'Shift Gear']);
  });

  test('rejects garbage pastes instead of pretending a team loaded', () => {
    expect(parsePastedTeam('asdf asdf')).toEqual([]);
    expect(parsePastedTeam('')).toEqual([]);
    expect(parsePastedTeam('Pikachu @ Light Ball\nAbility: Static')).toEqual([]);
  });

  test('parses German exports after parseTeamText normalization', () => {
    const german = [
      'Toxtricity @ Throat Spray',
      'Fähigkeit: Punk Rock',
      'EVs: 4 Vert / 252 SpA / 252 Init',
      '- Boomburst',
    ].join('\n');
    const sets = parsePastedTeam(parseTeamText(german));
    expect(sets).toHaveLength(1);
    expect(sets[0].evs).toEqual(expect.objectContaining({ def: 4, spa: 252, spe: 252 }));
  });

  test('overlays matched species as manual knowledge and counts matches', () => {
    const sets = parsePastedTeam(showdownExport);
    expect(countMatchingSpecies(baseInfo, sets)).toBe(1);

    const { info, matched } = applyPastedTeam(baseInfo, sets);
    expect(matched).toBe(1);

    const toxtricity = info.pokemon.find(pokemon => pokemon.species === 'Toxtricity');
    expect(toxtricity?.item).toEqual({ value: 'Throat Spray', source: 'manual' });
    expect(toxtricity?.ability).toEqual({ value: 'Punk Rock', source: 'manual' });
    expect(toxtricity?.moves.every(move => move.source === 'manual')).toBe(true);
    expect(toxtricity?.evs.source).toBe('manual');

    // Unmatched species stay untouched.
    const garchomp = info.pokemon.find(pokemon => pokemon.species === 'Garchomp');
    expect(garchomp?.item.source).toBe('unknown');
  });
});
