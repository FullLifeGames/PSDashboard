import { describe, expect, test } from 'vitest';
import { Move, calculate } from '@smogon/calc';
import { applyInferredSpreads, NO_BOOST_ITEM_DETAIL } from '../src/team-info';
import { buildTeamsFromReplay, solveReplaySpreads } from '../src/team-builder';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import { buildCalcPokemon } from '../src/calc-build';
import { calcGenerationFor } from '../src/calc-gen';
import { boostItemIds } from '../src/spreads/boost-items';
import { toId } from '../src/ids';
import type { SmogonUsageStats } from '../src/smogon/stats-types';
import type { DamageObservation, PokemonEvs } from '../src/types';
import { rulesDex } from '../src/rules-dex';

/**
 * Round 69 (T26): the item that replaces a guessed boost item the damage lines refuted is the build's own next
 * choice (usage marginal, curated set), never another boost item the solver did not price and never the Choice
 * Scarf. The built set, the solved candidate and the panel overlay carry the same item.
 */
const evs = (spread: Partial<PokemonEvs>): PokemonEvs => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...spread });
const usage = (species: string, items: string[], nature: string, spread: PokemonEvs): SmogonUsageStats['pokemon'][string] => ({
  species, rawCount: 100, abilities: [], moves: [],
  items: items.map((value, index) => ({ value, probability: 0.5 - index * 0.1, sourceDetail: 'test' })),
  spreads: [{ value: 'test', probability: 1, sourceDetail: 'test', nature, evs: spread }],
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
