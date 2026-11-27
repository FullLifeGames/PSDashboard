import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { Dex, TeamValidator, toID, type PokemonSet } from '@pkmn/sim';
import * as championsMod from '@pkmn/mods/champions';
import { buildTeamsFromReplay } from '../src/team-builder';
import { registerChampionsDex, rulesDex } from '../src/rules-dex';
import { unknownEvs, unknownField } from '../src/team-info';
import { resolveAbility } from '../src/team/set-resolvers';
import { abilitiesAreFree, firstAllowedAbility, formatAbilityBans, legalAbility } from '../src/team/dex-legal';
import type { RevealedPokemonInfo } from '../src/types';

if (!Dex.formats.get('gen9championscustomgame').exists) registerChampionsDex(championsMod as never, championsMod.Formats as never);

// The log names display names: 'As One' is no id of the Gen 9 Dex, and the sim plays an unknown id as no ability.

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

describe('dex-legal abilities', () => {
  test('every built set carries an ability the dex knows for its species', () => {
    const { p1Team, p2Team } = buildTeamsFromReplay(vgcLog('[Gen 9] VGC 2026 Reg I'));
    expect({
      calyrexIce: abilityOf(p1Team, 'Calyrex-Ice'),
      calyrexShadow: abilityOf(p2Team, 'Calyrex-Shadow'),
      terapagos: abilityOf(p1Team, 'Terapagos'),
      ogerpon: abilityOf(p1Team, 'Ogerpon-Wellspring'),
    }).toEqual({ calyrexIce: 'asoneglastrier', calyrexShadow: 'asonespectrier', terapagos: 'terashift', ogerpon: 'waterabsorb' });
  });

  test('a format with free abilities keeps a battle-only ability, but an unknown name still becomes the dex ability', () => {
    const { p1Team, p2Team } = buildTeamsFromReplay(vgcLog('[Gen 9] Balanced Hackmons'));
    expect(abilityOf(p2Team, 'Calyrex-Shadow')).toBe('asonespectrier');
    expect(abilityOf(p1Team, 'Ogerpon-Wellspring')).toBe('embodyaspectwellspring');
    expect(abilityOf(p1Team, 'Terapagos')).toBe('terashift');
  });

  test('a custom game reads abilities like a standard format', () => {
    const { p1Team, p2Team } = buildTeamsFromReplay(vgcLog('[Gen 9] Custom Game'));
    expect(abilityOf(p1Team, 'Ogerpon-Wellspring')).toBe('waterabsorb');
    expect(abilityOf(p2Team, 'Calyrex-Shadow')).toBe('asonespectrier');
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

describe('fixed Tera type and item', () => {
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

  test('a format with free abilities keeps what the build had', () => {
    const { p2Team } = buildTeamsFromReplay(doublesLog('[Gen 9] Balanced Hackmons'));
    expect(p2Team.find(set => set.species === 'Ogerpon-Cornerstone')!.teraType).toBeUndefined();
  });

  test('a custom game carries the fixed Tera type and item like a standard format', () => {
    const { p2Team } = buildTeamsFromReplay(doublesLog('[Gen 9] Doubles Custom Game'));
    const cornerstone = p2Team.find(set => set.species === 'Ogerpon-Cornerstone')!;
    expect(cornerstone.teraType).toBe('Rock');
    expect(toID(cornerstone.item)).toBe('cornerstonemask');
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

describe('legality follows the replay\'s format and generation', () => {
  test('a battle-only forme\'s ability falls back to the species\' ability of that generation', () => {
    const set = { name: 'Gengar', species: 'Gengar', item: '', ability: 'Shadow Tag', moves: [], nature: '', gender: '', evs: {}, ivs: {}, level: 100 };
    expect(legalAbility(set as never, { gen: 6, freeAbilities: false })).toBe('Levitate');
    expect(legalAbility(set as never, { gen: 9, freeAbilities: false })).toBe('Cursed Body');
  });

  test('the sim\'s rule table decides which formats allow any ability; a custom game and an unknown format keep the usual abilities', () => {
    expect(abilitiesAreFree('|tier|[Gen 9] Balanced Hackmons')).toBe(true);
    expect(abilitiesAreFree('|tier|[Gen 9] Hackmons Cup')).toBe(true);
    expect(abilitiesAreFree('|tier|[Gen 9] Custom Game')).toBe(false);
    expect(abilitiesAreFree('|tier|[Gen 9] Doubles Custom Game')).toBe(false);
    expect(abilitiesAreFree('|tier|[Gen 9] OU')).toBe(false);
    expect(abilitiesAreFree('|tier|[Gen 9] VGC 2026 Reg I')).toBe(false);
    expect(abilitiesAreFree('|tier|[Gen 9] Draft Custom Game')).toBe(false);
  });
});

describe('the default ability is one the format\'s validator accepts', () => {
  const ruleLines = (file: string) => (JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8')) as { log: string }).log.match(/^\|rule\|.*$/gm) ?? [];
  const DRAFT_RULES = ruleLines('gen9natdexdraft-2713067801.json');
  const VGC_RULES = ruleLines('gen9championsvgc2026regmbbo3-2634204248.json');
  const CORPUS_TIERS = [
    '[Gen 9] Doubles OU', '[Gen 9 Champions] VGC 2026 Reg M-B (Bo3)', '[Gen 9] VGC 2026 Reg I', '[Gen 9 Champions] OU', '[Gen 9] OU',
    '[Gen 9] VGC 2026 Reg F', '[Gen 9] VGC 2024 Reg H', '[Gen 9] VGC 2025 Reg G', '[Gen 9] VGC 2024 Reg G', '[Gen 9] VGC 2025 Reg I',
    '[Gen 9] RU', '[Gen 9] VGC 2025 Reg H', '[Gen 9 Champions] VGC 2026 Reg M-C', '[Gen 9] VGC 2025 Reg J', '[Gen 9 Champions] VGC 2026 Reg M-A',
    '[Gen 9 Champions] VGC 2026 Reg M-B', '[Gen 9] Ubers', '[Gen 9 Champions] VGC 2026 Reg M-A (Bo3)', '[Gen 8] Ubers', '[Gen 7] Ubers',
    '[Gen 8] UU', '[Gen 8] RU', '[Gen 8] OU', '[Gen 7] UU', '[Gen 7] RU', '[Gen 7] OU', '[Gen 6] Ubers', '[Gen 6] RU', '[Gen 6] OU',
    '[Gen 5] Ubers', '[Gen 5] RU', '[Gen 4] Ubers', '[Gen 4] OU', '[Gen 3] RU', '[Gen 2] OU', '[Gen 3] Ubers', '[Gen 9] UU',
    '[Gen 8] OU (DLC 1)', '[Gen 7] RU (suspect test)', '[Gen 3] UU',
  ];
  const logOf = (tier: string, rules: string[]) => [`|gen|${/^\[Gen (\d+)/.exec(tier)![1]}`, `|tier|${tier}`, ...rules].join('\n');
  const tierOwnsRules = (tier: string) => Dex.formats.get(tier).exists && !Dex.formats.get(tier).id.endsWith('customgame');
  const info = (species: string) => ({
    species, moves: [], ability: unknownField(), item: unknownField(), teraType: unknownField(), evs: unknownEvs(), level: 100, gender: '',
  }) as RevealedPokemonInfo;
  const family = (tier: string) => (/Champions/.test(tier) ? 'Champions' : /VGC/.test(tier) ? 'VGC' : /Doubles/.test(tier) ? 'doubles' : 'singles');

  const SCENES: { tier: string; rules: string[] }[] = [
    ...CORPUS_TIERS.flatMap(tier => (tierOwnsRules(tier) ? [{ tier, rules: [] }] : [{ tier, rules: VGC_RULES }, { tier, rules: DRAFT_RULES }])),
    { tier: '[Gen 9] NatDex Draft', rules: DRAFT_RULES }, { tier: '[Gen 9] Custom Game', rules: [] },
    { tier: '[Gen 9] Doubles Custom Game', rules: DRAFT_RULES }, { tier: '[Gen 9] Balanced Hackmons', rules: [] },
  ];

  test('every species of every tier of the corpus defaults to its first slot that the simulator\'s validator lets in', () => {
    const wrong: string[] = [];
    const movedBy: Record<string, number> = {};
    const bannedIn = new Set<string>();
    for (const { tier, rules } of SCENES) {
      const log = logOf(tier, rules);
      const gen = Number(/^\[Gen (\d+)/.exec(tier)![1]);
      const dex = rulesDex(gen, /Champions/.test(tier) ? 'champions' : undefined);
      const base = `gen${gen}${/Champions/.test(tier) ? 'champions' : ''}customgame`;
      const validators = tierOwnsRules(tier)
        ? [new TeamValidator(Dex.formats.get(tier))]
        : rules.map(line => /^\|rule\|([^:|]+): /.exec(line)?.[1]).filter((name): name is string => !!name && Dex.formats.get(name).effectType === 'ValidatorRule')
          .map(name => new TeamValidator(`${base}@@@${name}`));
      const probe = { name: 'probe', species: 'probe' } as unknown as PokemonSet;
      const rejected = new Map<string, boolean>();
      const banned = (name: string) => {
        const id = toID(name);
        if (!rejected.has(id)) rejected.set(id, validators.some(validator => validator.checkAbility(probe, dex.abilities.get(id), {}) !== null));
        return rejected.get(id)!;
      };
      const bans = formatAbilityBans(log);
      if (bans.size > 0 && rules !== DRAFT_RULES) bannedIn.add(family(tier));
      for (const { id } of dex.abilities.all()) if (banned(id) !== bans.has(id)) wrong.push(`${tier} bans ${id}`);
      for (const entry of dex.species.all().filter(species => species.exists && species.gen <= gen && species.num > 0)) {
        const slots = [entry.abilities[0], entry.abilities[1], entry.abilities.H].filter((name): name is string => !!name);
        if (slots.length === 0) continue;
        const expected = slots.find(name => !banned(name)) ?? slots[0];
        if (resolveAbility(dex, info(entry.name), null, null, undefined, bans) !== expected) wrong.push(`${tier} ${rules.length ? `(${rules.length} rule lines) ` : ''}${entry.name}`);
        if (expected !== slots[0]) { const key = rules === DRAFT_RULES ? 'draft rule lines' : family(tier); movedBy[key] = (movedBy[key] ?? 0) + 1; }
      }
    }
    expect(wrong).toEqual([]);
    expect([...bannedIn].sort()).toEqual(['Champions', 'VGC', 'doubles', 'singles']);
    for (const kind of ['Champions', 'doubles', 'singles', 'draft rule lines']) expect(movedBy[kind]).toBeGreaterThan(0);
  });

  test('the scene: Garchomp without a usage entry plays Rough Skin where Sand Veil is banned, Tatsugiri Storm Drain where Commander is', () => {
    const read = (tier: string, species: string) => {
      const log = logOf(tier, []);
      return resolveAbility(rulesDex(9, /Champions/.test(tier) ? 'champions' : undefined), info(species), null, null, undefined, formatAbilityBans(log));
    };
    expect(read('[Gen 9] OU', 'Garchomp')).toBe('Rough Skin');
    expect(read('[Gen 9] Doubles OU', 'Garchomp')).toBe('Rough Skin');
    expect(read('[Gen 9] Doubles OU', 'Tatsugiri-Droopy')).toBe('Storm Drain');
    expect(read('[Gen 9 Champions] OU', 'Garchomp')).toBe('Rough Skin');
    expect(read('[Gen 9] Custom Game', 'Garchomp')).toBe('Sand Veil');
  });

  test('the draft league\'s rule lines ban Sand Veil although Evasion Clause already contains Evasion Abilities Clause', () => {
    expect(formatAbilityBans(logOf('[Gen 9] NatDex Draft', DRAFT_RULES)).has('sandveil')).toBe(true);
    expect(formatAbilityBans(logOf('[Gen 9] NatDex Draft', DRAFT_RULES.filter(line => !/Evasion Clause/.test(line)))).has('sandveil')).toBe(true);
    expect(formatAbilityBans(logOf('[Gen 9] NatDex Draft', DRAFT_RULES.filter(line => !/Evasion Abilities Clause/.test(line)))).has('sandveil')).toBe(true);
  });

  test('a custom game without a rule that bans abilities, and a log with colon-less rule lines, ban nothing', () => {
    expect(formatAbilityBans(logOf('[Gen 9] Custom Game', [])).size).toBe(0);
    expect(formatAbilityBans(logOf('[Gen 9] Custom Game', ['|rule|Evasion Abilities Clause'])).size).toBe(0);
    expect(formatAbilityBans(logOf('[Gen 9] Custom Game', VGC_RULES)).size).toBe(0);
  });

  test('every slot skipped keeps slot 0, else the first slot that passes', () => {
    const dex = rulesDex(9);
    expect(firstAllowedAbility(dex, 'Garchomp', () => true)).toBe('Sand Veil');
    expect(firstAllowedAbility(dex, 'Garchomp', id => id === 'sandveil')).toBe('Rough Skin');
    expect(firstAllowedAbility(dex, 'Garchomp', id => id !== 'roughskin')).toBe('Rough Skin');
  });

  test('the special slot S counts only where the caller names it (Rockruff: Own Tempo)', () => {
    const dex = rulesDex(9);
    const skipsHidden = (id: string) => id !== 'owntempo';
    expect(firstAllowedAbility(dex, 'Rockruff', skipsHidden)).toBe('Keen Eye');
    expect(firstAllowedAbility(dex, 'Rockruff', skipsHidden, ['0', '1', 'H', 'S'])).toBe('Own Tempo');
  });
});
