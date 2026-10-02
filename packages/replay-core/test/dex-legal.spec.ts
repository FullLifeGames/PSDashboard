import { describe, expect, test } from 'vitest';
import { toID } from '@pkmn/sim';
import { buildTeamsFromReplay } from '../src/team-builder';

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
