import { describe, expect, test } from 'vitest';
import { toID } from '@pkmn/sim';
import { buildTeamsFromReplay } from '../src/team-builder';
import { abilitiesAreFree, legalAbility } from '../src/team/dex-legal';

/**
 * Round 60 (T93): the log names an ability by its display name. "As One" is
 * no ability id of the gen 9 dex ("As One (Glastrier)", "As One (Spectrier)"),
 * and the sim plays an unknown id as no ability at all (no Unnerve, no boost
 * after a KO). Ogerpon and Terapagos carried the ability of a battle-only
 * forme (Embody Aspect, Teraform Zero) on their base forme.
 */

const vgcLog = (tier: string) => [
  '|gametype|doubles', '|gen|9', `|tier|${tier}`,
  '|poke|p1|Calyrex-Ice, L50|', '|poke|p1|Ogerpon-Wellspring, L50, F|', '|poke|p1|Terapagos, L50, M|',
  '|poke|p2|Calyrex-Shadow, L50|', '|poke|p2|Incineroar, L50, M|',
  '|start',
  '|switch|p1a: Calyrex|Calyrex-Ice, L50|100/100', '|switch|p1b: Terapagos|Terapagos, L50, M|100/100',
  '|switch|p2a: Calyrex|Calyrex-Shadow, L50|100/100', '|switch|p2b: Incineroar|Incineroar, L50, M|100/100',
  '|-ability|p1a: Calyrex|As One', '|-ability|p1a: Calyrex|Unnerve',
  '|-activate|p1b: Terapagos|ability: Tera Shift', '|detailschange|p1b: Terapagos|Terapagos-Terastal, L50, M',
  '|-ability|p2a: Calyrex|As One', '|-ability|p2a: Calyrex|Unnerve',
  '|turn|1',
  '|-terastallize|p1b: Terapagos|Stellar', '|detailschange|p1b: Terapagos|Terapagos-Stellar, L50, M, tera:Stellar',
  '|-ability|p1b: Terapagos|Teraform Zero',
  '|move|p1a: Calyrex|Protect|p1a: Calyrex',
  '|turn|2',
  '|switch|p1a: Ogerpon|Ogerpon-Wellspring, L50, F|100/100',
  '|-terastallize|p1a: Ogerpon|Water', '|detailschange|p1a: Ogerpon|Ogerpon-Wellspring-Tera, L50, F, tera:Water',
  '|-ability|p1a: Ogerpon|Embody Aspect (Wellspring)|boost', '|-boost|p1a: Ogerpon|spd|1',
  '|turn|3',
].join('\n');

const abilityOf = (team: { species: string; ability: string }[], species: string) =>
  toID(team.find(set => set.species === species)?.ability ?? '');

describe('dex-legal abilities (round 60, T93)', () => {
  test('every built set carries an ability the dex knows for its species', () => {
    const { p1Team, p2Team } = buildTeamsFromReplay(vgcLog('[Gen 9] VGC 2026 Reg I'));
    expect({
      calyrexIce: abilityOf(p1Team, 'Calyrex-Ice'),
      calyrexShadow: abilityOf(p2Team, 'Calyrex-Shadow'),
      terapagos: abilityOf(p1Team, 'Terapagos'),
      ogerpon: abilityOf(p1Team, 'Ogerpon-Wellspring'),
    }).toEqual({ calyrexIce: 'asoneglastrier', calyrexShadow: 'asonespectrier', terapagos: 'terashift', ogerpon: 'waterabsorb' });
  });

  test('a custom game keeps a battle-only ability, but an unknown name still becomes the dex ability', () => {
    const { p1Team, p2Team } = buildTeamsFromReplay(vgcLog('[Gen 9] Custom Game'));
    expect(abilityOf(p2Team, 'Calyrex-Shadow')).toBe('asonespectrier');
    expect(abilityOf(p1Team, 'Terapagos')).toBe('teraformzero');
  });

  test('an ability the species already has keeps its exact string', () => {
    const log = [
      '|gametype|singles', '|gen|9', '|tier|[Gen 9] OU', '|poke|p2|Garchomp, F|', '|start',
      '|switch|p2a: Chomp|Garchomp, F|100/100', '|-ability|p2a: Chomp|Rough Skin', '|turn|1',
    ].join('\n');
    const { p2Team } = buildTeamsFromReplay(log);
    expect(p2Team.find(set => set.species === 'Garchomp')?.ability).toBe('Rough Skin');
  });
});

describe('fixed Tera type and item (round 60, T79)', () => {
  const doublesLog = (tier: string, extra: string[] = []) => [
    '|gametype|doubles', '|gen|9', `|tier|${tier}`,
    '|poke|p2|Ogerpon-Cornerstone, L50, F|', '|poke|p2|Ogerpon-Wellspring, L50, F|', '|poke|p2|Terapagos, L50, M|',
    '|start',
    '|switch|p2a: Ogerpon|Ogerpon-Cornerstone, L50, F|100/100', '|switch|p2b: Terapagos|Terapagos, L50, M|100/100',
    ...extra,
    '|turn|1',
  ].join('\n');

  test('a species with a fixed Tera type and item carries them when the log shows none', () => {
    const { p2Team } = buildTeamsFromReplay(doublesLog('[Gen 9] Doubles OU'));
    const cornerstone = p2Team.find(set => set.species === 'Ogerpon-Cornerstone')!;
    expect(cornerstone.teraType).toBe('Rock');
    expect(toID(cornerstone.item)).toBe('cornerstonemask');
    const wellspring = p2Team.find(set => set.species === 'Ogerpon-Wellspring')!;
    expect(wellspring.teraType).toBe('Water');
    expect(toID(wellspring.item)).toBe('wellspringmask');
    expect(p2Team.find(set => set.species === 'Terapagos')!.teraType).toBe('Stellar');
  });

  test('a custom game keeps what the build had', () => {
    const { p2Team } = buildTeamsFromReplay(doublesLog('[Gen 9] Doubles Custom Game'));
    expect(p2Team.find(set => set.species === 'Ogerpon-Cornerstone')!.teraType).toBeUndefined();
  });

  test('a Tera forme coming back in maps to its species through the dex (749895: no second Ogerpon)', () => {
    const log = [
      '|gametype|singles', '|gen|9', '|tier|[Gen 9] OU', '|poke|p2|Ogerpon, F|', '|poke|p2|Garchomp, F|', '|start',
      '|switch|p2a: Ogerpon|Ogerpon, F|100/100', '|turn|1',
      '|-terastallize|p2a: Ogerpon|Grass', '|detailschange|p2a: Ogerpon|Ogerpon-Teal-Tera, F, tera:Grass',
      '|-ability|p2a: Ogerpon|Embody Aspect (Teal)|boost', '|turn|2',
      '|switch|p2a: Chomp|Garchomp, F|100/100', '|turn|3',
      '|switch|p2a: Ogerpon|Ogerpon-Teal-Tera, F, tera:Grass|100/100', '|turn|4',
    ].join('\n');
    const { p2Team } = buildTeamsFromReplay(log);
    expect(p2Team.map(set => set.species)).toEqual(['Ogerpon', 'Garchomp']);
  });
});

describe('legality follows the replay\'s format and generation (round 60 review)', () => {
  test('a battle-only forme\'s ability falls back to the species\' ability of that generation', () => {
    const set = { name: 'Gengar', species: 'Gengar', item: '', ability: 'Shadow Tag', moves: [], nature: '', gender: '', evs: {}, ivs: {}, level: 100 };
    expect(legalAbility(set as never, { gen: 6, custom: false })).toBe('Levitate');
    expect(legalAbility(set as never, { gen: 9, custom: false })).toBe('Cursed Body');
  });

  test('the sim\'s rule table decides which formats allow any ability; an unknown format falls back to the custom-game name', () => {
    expect(abilitiesAreFree('|tier|[Gen 9] Balanced Hackmons')).toBe(true);
    expect(abilitiesAreFree('|tier|[Gen 9] Custom Game')).toBe(true);
    expect(abilitiesAreFree('|tier|[Gen 9] OU')).toBe(false);
    expect(abilitiesAreFree('|tier|[Gen 9] VGC 2026 Reg I')).toBe(false);
    expect(abilitiesAreFree('|tier|[Gen 9] Draft Custom Game')).toBe(true);
  });
});
