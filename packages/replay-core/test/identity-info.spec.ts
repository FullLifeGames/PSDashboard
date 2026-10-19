import { describe, expect, test } from 'vitest';
import { buildTeamsFromReplay, inferOpponentTeam } from '../src/index.ts';
import type { RevealedPokemonInfo } from '../src/types.ts';

/**
 * Round 72, T238: the inference books the name and the shiny flag the replay showed for a body, so the simulator can
 * write the replay's own switch lines. Singles name a body `p2a`, doubles `p1a` or `p1b`; the side key drops the slot.
 * The sources are the first `switch`, `drag` or `replace` line of a body and an Open Team Sheet; team preview
 * (`|poke|`) carries no nickname and no shiny flag, so a body it alone names stays unset.
 */

const header = (kind: 'singles' | 'doubles') => [`|gametype|${kind}`, '|player|p1|A|1|', '|player|p2|B|2|', '|gen|9', '|tier|[Gen 9] Custom Game'];
const preview = ['|clearpoke', '|poke|p1|Pikachu, L50, F|', '|poke|p1|Landorus-Therian, L50, M|', '|poke|p2|Garchomp, L50, F|', '|poke|p2|Clefable, L50, F|', '|teampreview', '|start'];

const infoOf = (log: string, side: 'p1' | 'p2', species: string): RevealedPokemonInfo => {
  const info = inferOpponentTeam(log, side).pokemon.find(mon => mon.species === species);
  if (!info) throw new Error(`no ${species} on ${side}`);
  return info;
};
const identity = (info: RevealedPokemonInfo) => ({ nickname: info.nickname, shiny: info.shiny });

describe('the inference books the replay\'s name and shiny flag', () => {
  test('singles: a switch of p2a names the body; a body only in team preview stays unset', () => {
    const log = [...header('singles'), ...preview, '|switch|p1a: Mouse|Pikachu, L50, F|110/110', '|switch|p2a: Bitey|Garchomp, L50, F, shiny|183/183'].join('\n');
    expect(identity(infoOf(log, 'p2', 'Garchomp'))).toEqual({ nickname: 'Bitey', shiny: true });
    expect(identity(infoOf(log, 'p1', 'Pikachu'))).toEqual({ nickname: 'Mouse', shiny: false });
    expect(identity(infoOf(log, 'p2', 'Clefable'))).toEqual({ nickname: undefined, shiny: undefined });
    expect(identity(infoOf(log, 'p1', 'Landorus-Therian'))).toEqual({ nickname: undefined, shiny: undefined });
  });

  test('doubles: p1a and p1b book alike, from a switch and from a drag', () => {
    const log = [...header('doubles'), ...preview,
      '|switch|p1a: Mouse|Pikachu, L50, F|110/110', '|switch|p1b: NOT ICT|Landorus-Therian, L50, M, shiny|164/164',
      '|switch|p2a: Bitey|Garchomp, L50, F|183/183', '|drag|p2b: Clef|Clefable, L50, F, shiny|170/170'].join('\n');
    expect(identity(infoOf(log, 'p1', 'Pikachu'))).toEqual({ nickname: 'Mouse', shiny: false });
    expect(identity(infoOf(log, 'p1', 'Landorus-Therian'))).toEqual({ nickname: 'NOT ICT', shiny: true });
    expect(identity(infoOf(log, 'p2', 'Garchomp'))).toEqual({ nickname: 'Bitey', shiny: false });
    expect(identity(infoOf(log, 'p2', 'Clefable'))).toEqual({ nickname: 'Clef', shiny: true });
  });

  test('a replace line (Illusion) names the real body, the disguise books to the body it shows', () => {
    const log = [...header('singles'), '|clearpoke', '|poke|p1|Pikachu, L50, F|', '|poke|p1|Zoroark, L50, F|', '|poke|p1|Clefable, L50, F|', '|poke|p2|Garchomp, L50, M|', '|teampreview', '|start',
      '|switch|p1a: Mouse|Pikachu, L50, F|110/110', '|switch|p2a: Bitey|Garchomp, L50, M|183/183',
      '|switch|p1a: Clef|Clefable, L50, F|135/135', '|replace|p1a: Fox|Zoroark, L50, F, shiny'].join('\n');
    expect(identity(infoOf(log, 'p1', 'Clefable'))).toEqual({ nickname: 'Clef', shiny: false });
    expect(identity(infoOf(log, 'p1', 'Zoroark'))).toEqual({ nickname: 'Fox', shiny: true });
  });

  test('an Open Team Sheet names a body the log never showed, and the log wins when both exist', () => {
    const sheet = '|showteam|p2|Bitey|Garchomp||NoAbility|Tackle|Serious||F||S|50|]Clef|Clefable||NoAbility|Tackle|Serious||F|||50|';
    const log = [...header('singles'), sheet, ...preview, '|switch|p1a: Mouse|Pikachu, L50, F|110/110', '|switch|p2a: Landshark|Garchomp, L50, F, shiny|183/183'].join('\n');
    expect(identity(infoOf(log, 'p2', 'Garchomp'))).toEqual({ nickname: 'Landshark', shiny: true });
    expect(identity(infoOf(log, 'p2', 'Clefable'))).toEqual({ nickname: 'Clef', shiny: false });
    const sheetOnly = [...header('singles'), sheet, ...preview].join('\n');
    expect(identity(infoOf(sheetOnly, 'p2', 'Garchomp'))).toEqual({ nickname: 'Bitey', shiny: true });
  });

  test('a name that is the species\' own stays unset, and the shiny flag is still booked', () => {
    const log = [...header('singles'), ...preview, '|switch|p1a: Landorus|Landorus-Therian, L50, M, shiny|164/164', '|switch|p2a: Garchomp|Garchomp, L50, F|183/183'].join('\n');
    expect(identity(infoOf(log, 'p1', 'Landorus-Therian'))).toEqual({ nickname: undefined, shiny: true });
    expect(identity(infoOf(log, 'p2', 'Garchomp'))).toEqual({ nickname: undefined, shiny: false });
  });

  test('a name that is the species of another body of the side stays unset (a lookup by name would find the wrong body)', () => {
    const log = [...header('singles'), ...preview, '|switch|p1a: Landorus-Therian|Pikachu, L50, F|110/110', '|switch|p2a: Bitey|Garchomp, L50, F|183/183',
      '|switch|p1a: Pikachu|Landorus-Therian, L50, M|164/164'].join('\n');
    expect(infoOf(log, 'p1', 'Pikachu').nickname).toBeUndefined();
    expect(infoOf(log, 'p1', 'Landorus-Therian').nickname).toBeUndefined();
  });

  test('two bodies that share one name both book it', () => {
    const log = [...header('doubles'), ...preview, '|switch|p1a: Twin|Pikachu, L50, F|110/110', '|switch|p1b: Twin|Landorus-Therian, L50, M|164/164'].join('\n');
    expect(infoOf(log, 'p1', 'Pikachu').nickname).toBe('Twin');
    expect(infoOf(log, 'p1', 'Landorus-Therian').nickname).toBe('Twin');
  });
});

describe('a line without a gender', () => {
  test('a body shown with no gender whose species has one is booked as genderless; a gendered or a genderless species is not', () => {
    const log = [...header('singles'), '|clearpoke', '|poke|p1|Noivern, L50|', '|poke|p1|Magnezone, L50|', '|poke|p1|Ogerpon-Cornerstone, L50, F|', '|poke|p2|Garchomp, L50, F|', '|teampreview', '|start',
      '|switch|p1a: Steve|Noivern, L50|161/161', '|switch|p2a: Bitey|Garchomp, L50, F|183/183', '|switch|p1a: Mag|Magnezone, L50|150/150', '|switch|p1a: Regi|Ogerpon-Cornerstone, L50|180/180'].join('\n');
    expect(infoOf(log, 'p1', 'Noivern').noGender).toBe(true);
    expect(infoOf(log, 'p1', 'Ogerpon-Cornerstone').noGender).toBe(true);
    expect(infoOf(log, 'p1', 'Magnezone').noGender).toBeUndefined();
    expect(infoOf(log, 'p2', 'Garchomp').noGender).toBeUndefined();
    const { p1Team, p2Team } = buildTeamsFromReplay(log);
    expect(p1Team.find(mon => mon.species === 'Noivern')?.gender).toBe('N');
    expect(p2Team.find(mon => mon.species === 'Garchomp')?.gender).toBe('F');
  });
});

describe('the built sets carry the booked name and shiny flag', () => {
  test('singles and doubles alike; an unrevealed body keeps the species and no shiny', () => {
    for (const kind of ['singles', 'doubles'] as const) {
      const log = [...header(kind), ...preview, '|switch|p1a: Mouse|Pikachu, L50, F, shiny|110/110', '|switch|p2a: Bitey|Garchomp, L50, F|183/183'].join('\n');
      const { p1Team, p2Team } = buildTeamsFromReplay(log);
      expect(p1Team.find(mon => mon.species === 'Pikachu')).toEqual(expect.objectContaining({ name: 'Mouse', shiny: true, level: 50, gender: 'F' }));
      expect(p2Team.find(mon => mon.species === 'Garchomp')).toEqual(expect.objectContaining({ name: 'Bitey' }));
      expect(p2Team.find(mon => mon.species === 'Garchomp')?.shiny).toBeFalsy();
      expect(p2Team.find(mon => mon.species === 'Clefable')).toEqual(expect.objectContaining({ name: 'Clefable' }));
      expect(p1Team.find(mon => mon.species === 'Landorus-Therian')?.shiny).toBeFalsy();
    }
  });

  test('the replay\'s name outranks a pasted team\'s nickname for a body it showed', () => {
    const log = [...header('singles'), ...preview, '|switch|p1a: Mouse|Pikachu, L50, F|110/110', '|switch|p2a: Bitey|Garchomp, L50, F|183/183'].join('\n');
    const paste = 'Pikachu Prime (Pikachu) (F) @ Light Ball\nAbility: Static\nLevel: 50\n- Tackle\n\nLandorus Hero (Landorus-Therian) (M)\nAbility: Intimidate\nLevel: 50\n- Tackle';
    const { p1Team } = buildTeamsFromReplay(log, { userTeamText: paste });
    expect(p1Team.find(mon => mon.species === 'Pikachu')?.name).toBe('Mouse');
    // The body the replay never showed keeps the paste's own name.
    expect(p1Team.find(mon => mon.species === 'Landorus-Therian')?.name).toBe('Landorus Hero');
  });
});
