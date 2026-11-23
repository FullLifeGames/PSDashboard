import { describe, expect, test } from 'vitest';
import { Move, calculate } from '@smogon/calc';
import { applyInferredSpreads, KNOCKOUT_BOOST_ITEM_DETAIL, NO_BOOST_ITEM_DETAIL } from '../src/team-info';
import { buildTeamsFromReplay, solveReplaySpreads } from '../src/team-builder';
import { itemClauseLimit, speedKnowledgeFor } from '../src/team/inferred-items';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import { buildCalcPokemon, calcBaseStats, type SpeciesDex } from '../src/calc-build';
import { calcGenerationFor } from '../src/calc-gen';
import type { SmogonUsageStats } from '../src/smogon/stats-types';
import type { DamageObservation, PokemonEvs } from '../src/types';
import { Dex } from '@pkmn/sim';
import * as championsMod from '@pkmn/mods/champions';
import { rulesDex } from '../src/rules-dex';
import { boostItemIds } from '../src/spreads/boost-items';
import { toId } from '../src/ids';

/**
 * Round 89 (#75 step 2): the build hands the solver what the log lets it offer. The usage list of the species, in usage order, less the items the
 * log refutes (a Choice lock two different moves break), and the format's Item Clause read from the log's own `|rule|` line (else the simulator's
 * rule table of the `|tier|`; a Custom Game has none). The solved item rides out on the candidate, into the built set and the panel.
 */
const evs = (spread: Partial<PokemonEvs>): PokemonEvs => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...spread });
const usage = (species: string, items: string[], nature: string, spread: PokemonEvs): SmogonUsageStats['pokemon'][string] => ({
  species, rawCount: 100, abilities: [], moves: [],
  items: items.map((value, index) => ({ value, probability: 0.5 - index * 0.1, sourceDetail: 'test' })),
  spreads: [{ value: 'test', probability: 1, sourceDetail: 'test', nature, evs: spread }],
});
const gen = calcGenerationFor(9);
const body = (species: string, nature: string, spread: PokemonEvs, item?: string) => buildCalcPokemon(gen, species, { level: 100, nature, evs: spread, item });
const wall = body('Alakazam', 'Hardy', evs({}));
const best = (item?: string, nature = 'Timid') => Math.max(...(calculate(gen, body('Gengar', nature, evs({ spa: 252 }), item), wall, new Move(gen, 'Sludge Bomb')).damage as number[]).flat().map(Number)) / wall.maxHP();
const knockout = (): DamageObservation => ({
  attackerSpecies: 'Gengar', defenderSpecies: 'Alakazam', attackerSide: 'p2', moveId: 'sludgebomb', observedFraction: 1, lethal: true,
  attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '', doubles: true,
  defenderShown: { before: { hp: 100, maxhp: 100 } },
});
const stats = (gengar: string[]): SmogonUsageStats => ({
  format: 'gen9doublesou', month: '2026-08', source: 'test',
  pokemon: {
    gengar: usage('Gengar', gengar, 'Timid', evs({ spa: 252, spe: 252, hp: 4 })),
    garchomp: usage('Garchomp', ['Leftovers'], 'Jolly', evs({ atk: 252, spe: 252, hp: 4 })),
  },
});
const HEAD = [
  '|player|p1|Alice|', '|player|p2|Bob|', '|gametype|doubles', '|gen|9', '|tier|[Gen 9] Doubles OU',
  '|poke|p1|Alakazam, M|', '|poke|p2|Gengar, M|', '|poke|p2|Garchomp, M|',
];
const START = ['|start', '|switch|p1a: Alakazam|Alakazam, M|100/100', '|switch|p2a: Gengar|Gengar, M|100/100', '|switch|p2b: Garchomp|Garchomp, M|100/100', '|turn|1'];
const logOf = (rules: string[] = [], events: string[] = []) => [...HEAD, ...rules, ...START, ...events].join('\n');
const RULE = ['|rule|Item Clause: Limit 1 of each item'];
/** Gengar used two different moves in a row: a Choice lock would have held it to the first. */
const lockedLog = () => [...HEAD, ...START.slice(0, 4), '|turn|1', '|move|p2a: Gengar|Shadow Ball|p1a: Alakazam', '|turn|2',
  '|move|p2a: Gengar|Sludge Bomb|p1a: Alakazam', '|turn|3'].join('\n');

describe('the item rung through the build (doubles)', () => {
  test('the scene is real: the guessed spread and no item stay below the full HP, Choice Specs and Life Orb reach it', () => {
    expect(best(undefined, 'Modest')).toBeLessThan(0.97);
    expect(best('Choice Specs')).toBeGreaterThanOrEqual(1.01);
    expect(best('Life Orb', 'Modest')).toBeGreaterThanOrEqual(1);
  });

  test('the solved candidate, the built set and the panel carry the same item and the reason', () => {
    const log = logOf();
    const usageStats = stats(['Leftovers', 'Choice Specs', 'Life Orb']);
    expect(buildTeamsFromReplay(log, { usageStats }).p2Team.find(set => set.species === 'Gengar')?.item).toBe('Leftovers');
    const solved = solveReplaySpreads(log, [knockout(), knockout()], { usageStats });
    const gengar = solved.get('p2:gengar');
    expect(gengar?.item).toBe('Choice Specs');
    expect(gengar?.itemReason).toBe('boost');
    const built = buildTeamsFromReplay(log, { usageStats, inferredSpreads: solved }).p2Team.find(set => set.species === 'Gengar');
    expect(built?.item).toBe('Choice Specs');
    const shown = applyInferredSpreads(inferOpponentTeam(log, 'p2'), 'p2', solved).pokemon.find(mon => mon.species === 'Gengar')!.item;
    expect(shown.value).toBe('Choice Specs');
    expect(shown.source).toBe('guessed');
    expect(shown.sourceDetail).toBe(KNOCKOUT_BOOST_ITEM_DETAIL);
  });

  test('an item the log refutes never enters: two different moves rule out the Choice items, Life Orb follows', () => {
    const lockBroken = lockedLog();
    expect(inferOpponentTeam(lockBroken, 'p2').pokemon.find(mon => mon.species === 'Gengar')?.ruledOut?.items).toContain('choicespecs');
    const usageStats = stats(['Leftovers', 'Choice Specs', 'Life Orb']);
    const solved = solveReplaySpreads(lockBroken, [knockout(), knockout()], { usageStats });
    expect(solved.get('p2:gengar')?.item).toBe('Life Orb');
    expect(solved.get('p2:gengar')?.itemReason).toBe('boost');
  });

  test('the Item Clause of the log holds: a teammate that showed the item keeps it from the offer', () => {
    const shows = ['|-damage|p2b: Garchomp|88/100|[from] item: Life Orb'];
    const usageStats = stats(['Leftovers', 'Life Orb', 'Choice Specs']);
    const withClause = solveReplaySpreads(logOf(RULE, shows), [knockout(), knockout()], { usageStats }).get('p2:gengar');
    expect(withClause?.item, 'Life Orb is the partner\'s').toBe('Choice Specs');
    const noClause = solveReplaySpreads(logOf([], shows), [knockout(), knockout()], { usageStats }).get('p2:gengar');
    expect(noClause?.item, 'no clause in a format without one').toBe('Life Orb');
  });
});

describe('what the build offers', () => {
  const infos = (log: string) => ({ p1: inferOpponentTeam(log, 'p1'), p2: inferOpponentTeam(log, 'p2') });
  const nobody = { p1: null, p2: null };

  test('the usage list in usage order, without what the log rules out, with the clause limit', () => {
    const usageStats = stats(['Leftovers', 'Choice Specs', 'Life Orb', 'Focus Sash']);
    const log = lockedLog();
    const knowledge = speedKnowledgeFor(infos(log), nobody, usageStats, 1).get('p2:gengar');
    expect(knowledge?.itemOffers).toEqual(['Leftovers', 'Life Orb', 'Focus Sash']);
    expect(knowledge?.itemLimit).toBe(1);
    expect(speedKnowledgeFor(infos(log), nobody, usageStats).get('p2:gengar')?.itemLimit).toBeUndefined();
    expect(speedKnowledgeFor(infos(log), nobody, null).get('p2:gengar')?.itemOffers ?? []).toEqual([]);
  });

  test('the clause limit: the log\'s rule line first (both spellings), else the simulator\'s rule table of the tier, a Custom Game none', () => {
    const rule = (line: string, tier = '[Gen 9] Doubles OU') => ['|gen|9', `|tier|${tier}`, ...(line ? [line] : [])].join('\n');
    expect(itemClauseLimit(rule('|rule|Item Clause: Limit 1 of each item'))).toBe(1);
    expect(itemClauseLimit(rule('|rule|Item Clause: Limit one of each item'))).toBe(1);
    expect(itemClauseLimit(rule('|rule|Item Clause: Limit 2 of each item'))).toBe(2);
    // No rule line: the simulator's own rule table names the clause (Doubles OU carries none, a VGC format does).
    expect(itemClauseLimit(rule('', '[Gen 9] Custom Game'))).toBeUndefined();
    expect(itemClauseLimit(rule('', '[Gen 9] Doubles OU'))).toBeUndefined();
    expect(itemClauseLimit(rule('', '[Gen 9] VGC 2024 Reg G'))).toBe(1);
    expect(itemClauseLimit(rule('', '[Gen 9] A League Format The Simulator Does Not Know'))).toBeUndefined();
  });
});

Dex.mod('champions', championsMod as unknown as NonNullable<Parameters<typeof Dex.mod>[1]>);

const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const;

describe('a calculator body carries the Dex values', () => {
  test('Obliteryx 2.0: a gen 9 body has the Dex Special Defense of 78, where the calculator lists 90', () => {
    const gen = calcGenerationFor(9);
    expect(gen.species.get('obliteryx' as never)?.baseStats.spd).toBe(90);
    expect(buildCalcPokemon(gen, 'Obliteryx').species.baseStats.spd).toBe(78);
    expect(calcBaseStats(gen, 'Obliteryx')?.spd).toBe(78);
  });

  test.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 0])('generation %i: every species the calculator lists builds with the Dex base stats and types', num => {
    const gen = calcGenerationFor(num);
    const dex = rulesDex(num) as unknown as SpeciesDex;
    const wrong: string[] = [];
    for (const listed of gen.species) {
      const row = dex.species.get(listed.name);
      if (!row.exists) continue;
      const built = buildCalcPokemon(gen, listed.name, {}, dex);
      const stats = STATS.filter(stat => built.species.baseStats[stat] !== row.baseStats[stat]);
      if (stats.length > 0 || built.types.join('/') !== row.types.join('/')) wrong.push(`${listed.name} ${stats.join(',')} ${built.types.join('/')}`);
    }
    expect(wrong).toEqual([]);
  });
});

for (const formatid of ['gen9ou', 'gen9doublesou']) {
  describe(`a dropped boost item resolves to the build's next choice (${formatid})`, () => {
    const stats: SmogonUsageStats = {
      format: formatid, month: '2026-08', source: 'test',
      pokemon: {
        gengar: usage('Gengar', ['Choice Specs', 'Life Orb', 'Choice Scarf', 'Focus Sash', 'Leftovers'], 'Timid', evs({ spa: 252, spe: 252, hp: 4 })),
        garchomp: usage('Garchomp', ['Leftovers'], 'Calm', evs({ hp: 252, spd: 252, spe: 4 })),
      },
    };
    const log = [
      '|player|p1|Alice|', '|player|p2|Bob|', '|gen|9', `|tier|[Gen 9] ${formatid === 'gen9ou' ? 'OU' : 'Doubles OU'}`,
      '|poke|p1|Garchomp, M|', '|poke|p2|Gengar, M|',
      '|start', '|switch|p1a: Garchomp|Garchomp, M|100/100', '|switch|p2a: Gengar|Gengar, M|100/100', '|turn|1',
    ].join('\n');
    // Shadow Ball from a Timid 252 SpA Gengar without an item on a Calm 252 HP / 252 SpD Garchomp: three rolls.
    const gen = calcGenerationFor(9);
    const body = (species: string, nature: string, spread: PokemonEvs) => buildCalcPokemon(gen, species, { level: 100, nature, evs: spread });
    const wall = body('Garchomp', 'Calm', evs({ hp: 252, spd: 252, spe: 4 }));
    const rolls = (calculate(gen, body('Gengar', 'Timid', evs({ spa: 252, spe: 252, hp: 4 })), wall, new Move(gen, 'Shadow Ball')).damage as number[]).flat();
    const observations: DamageObservation[] = [3, 8, 12].map(index => ({
      attackerSpecies: 'Gengar', defenderSpecies: 'Garchomp', attackerSide: 'p2', moveId: toId('Shadow Ball'),
      observedFraction: rolls[index] / wall.maxHP(), lethal: false, attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '',
    }));

    test('the solved candidate carries the replacement, built set and panel overlay agree', () => {
      const guessed = buildTeamsFromReplay(log, { usageStats: stats }).p2Team.find(set => set.species === 'Gengar');
      expect(guessed?.item).toBe('Choice Specs');
      const solved = solveReplaySpreads(log, observations, { usageStats: stats });
      const gengar = solved.get('p2:gengar');
      expect(gengar?.itemReason).toBe('no-boost');
      expect(gengar?.item).toBe('Focus Sash');
      expect(boostItemIds(rulesDex(9)).has(toId(gengar?.item ?? ''))).toBe(false);
      const built = buildTeamsFromReplay(log, { usageStats: stats, inferredSpreads: solved }).p2Team.find(set => set.species === 'Gengar');
      expect(built?.item).toBe('Focus Sash');
      expect(built?.evs.spa).toBe(252);
      const shown = applyInferredSpreads(inferOpponentTeam(log, 'p2'), 'p2', solved).pokemon.find(mon => mon.species === 'Gengar')!.item;
      expect(shown.value).toBe('Focus Sash');
      expect(shown.source).toBe('guessed');
      expect(shown.sourceDetail).toBe(NO_BOOST_ITEM_DETAIL);
    });

    test('a solve with only boost items in the lists keeps the empty item through the Scarf resolver', () => {
      const onlyBoost: SmogonUsageStats = { ...stats, pokemon: { ...stats.pokemon, gengar: usage('Gengar', ['Choice Specs', 'Life Orb'], 'Timid', evs({ spa: 252, spe: 252, hp: 4 })) } };
      const solved = solveReplaySpreads(log, observations, { usageStats: onlyBoost });
      expect(solved.get('p2:gengar')?.item).toBe('');
      expect(solved.get('p2:gengar')?.itemReason).toBe('no-boost');
      const built = buildTeamsFromReplay(log, { usageStats: onlyBoost, inferredSpreads: solved }).p2Team.find(set => set.species === 'Gengar');
      expect(built?.item).toBe('');
    });

    test('an unresolved drop never lets a boost item or the Scarf back into the set', () => {
      const raw = new Map([['p2:gengar', { evs: evs({ spa: 252, spe: 252, hp: 4 }), nature: 'Timid', item: '', itemReason: 'no-boost' as const }]]);
      const built = buildTeamsFromReplay(log, { usageStats: stats, inferredSpreads: raw }).p2Team.find(set => set.species === 'Gengar');
      expect(boostItemIds(rulesDex(9)).has(toId(built?.item ?? ''))).toBe(false);
      expect(built?.item).not.toBe('Choice Scarf');
    });
  });
}

describe('a dropped boost item with no other item to take its place leaves the item empty', () => {
  const stats: SmogonUsageStats = {
    format: 'gen9ou', month: '2026-08', source: 'test',
    pokemon: { gengar: usage('Gengar', ['Choice Specs', 'Life Orb'], 'Timid', evs({ spa: 252, spe: 252, hp: 4 })) },
  };
  const log = [
    '|player|p1|Alice|', '|player|p2|Bob|', '|gen|9', '|tier|[Gen 9] OU',
    '|poke|p1|Garchomp, M|', '|poke|p2|Gengar, M|',
    '|start', '|switch|p1a: Garchomp|Garchomp, M|100/100', '|switch|p2a: Gengar|Gengar, M|100/100', '|turn|1',
  ].join('\n');

  test('the candidate keeps the empty item, the set fields none and the panel shows the item unknown', () => {
    const raw = new Map([['p2:gengar', { evs: evs({ spa: 252, spe: 252, hp: 4 }), nature: 'Timid', item: '', itemReason: 'no-boost' as const }]]);
    const built = buildTeamsFromReplay(log, { usageStats: stats, inferredSpreads: raw }).p2Team.find(set => set.species === 'Gengar');
    expect(built?.item).toBe('');
    const shown = applyInferredSpreads(inferOpponentTeam(log, 'p2'), 'p2', raw).pokemon.find(mon => mon.species === 'Gengar')!.item;
    expect(shown.value).toBe('');
    expect(shown.source).toBe('unknown');
    expect(shown.sourceDetail).toBe(NO_BOOST_ITEM_DETAIL);
  });
});
