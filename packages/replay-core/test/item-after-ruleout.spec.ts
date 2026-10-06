import { test, expect, describe } from 'vitest';
import { selectCuratedSet, type CuratedEvidence } from '../src/set-coherence';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import { enrichTeamInfo } from '../src/team-info';
import { buildTeamsFromReplay } from '../src/team-builder';
import { resolveItem } from '../src/team/set-resolvers';
import type { PokemonSetAssumption, SmogonSetAssumptions } from '../src/smogon/sets-lookup';
import type { PokemonUsageStats, SmogonUsageStats } from '../src/smogon/stats-types';
import type { RevealedPokemonInfo } from '../src/types';
import { unknownEvs } from '../src/team-info';
import { toId } from '../src/ids';

/**
 * The item after a proven rule-out (round 64, T120, spec decision 19):
 * when the log rules out the item of the set the evidence picks, that set
 * gives way, and the item the build plays is a guess the log supports (the
 * Boots tell) or else the most used item the log still allows, marked as a
 * guess. The next published set's item is no evidence: in 2663102863 the
 * Leftovers Gholdengo became a Choice Specs Gholdengo that way.
 */

const curated = (species: string, moves: string[], item: string): PokemonSetAssumption => ({
  species, sourceDetail: 's', item: { value: item, sourceDetail: 's' },
  moves: moves.map(value => ({ value, sourceDetail: 's' })),
});
const plot = () => curated('Gholdengo', ['Protect', 'Nasty Plot', 'Make It Rain', 'Shadow Ball'], 'Leftovers');
const specs = () => curated('Gholdengo', ['Make It Rain', 'Shadow Ball', 'Power Gem', 'Trick'], 'Choice Specs');
const usageOf: Record<string, number> = { makeitrain: 0.99, shadowball: 0.95, protect: 0.6, nastyplot: 0.57, trick: 0.27, powergem: 0.1 };
const evidence = (over: Partial<CuratedEvidence>): CuratedEvidence => ({
  revealedMoves: ['makeitrain'], revealedItem: '', revealedAbility: '',
  ruledOutItems: [], ruledOutAbilities: [],
  usageProbability: moveId => usageOf[moveId] ?? 0,
  ...over,
});

describe('selectCuratedSet: the item after a rule-out', () => {
  test('the set the log contradicts gives way, and its successor plays the most used allowed item, marked as a guess', () => {
    const picked = selectCuratedSet([plot(), specs()], evidence({ ruledOutItems: ['leftovers'], usageItem: 'Grassy Seed' }));
    expect(picked?.moves.map(move => move.value)).toEqual(['Make It Rain', 'Shadow Ball', 'Power Gem', 'Trick']);
    expect(picked?.item?.value).toBe('Grassy Seed');
    expect(picked?.item?.sourceDetail).toBe('Leftovers ruled out, most used other item');
  });

  test('a guess the log supports comes before the usage majority (the Boots tell)', () => {
    const picked = selectCuratedSet([plot(), specs()], evidence({
      ruledOutItems: ['leftovers'], guessedItem: 'Heavy-Duty Boots', usageItem: 'Grassy Seed',
    }));
    expect(picked?.item?.value).toBe('Heavy-Duty Boots');
  });

  test('a guess the log rules out is no replacement', () => {
    const picked = selectCuratedSet([plot(), specs()], evidence({
      ruledOutItems: ['leftovers', 'heavydutyboots'], guessedItem: 'Heavy-Duty Boots', usageItem: 'Grassy Seed',
    }));
    expect(picked?.item?.value).toBe('Grassy Seed');
  });

  test('without a rule-out on the picked set nothing changes (the same object)', () => {
    const first = plot();
    expect(selectCuratedSet([first, specs()], evidence({ usageItem: 'Grassy Seed' }))).toBe(first);
  });

  test('without usage data the successor keeps its own item', () => {
    const second = specs();
    expect(selectCuratedSet([plot(), second], evidence({ ruledOutItems: ['leftovers'] }))).toBe(second);
  });
});

describe('the evidence still comes first', () => {
  test('a Choice Scarf the move order inferred beats the replacement', () => {
    const info: RevealedPokemonInfo = {
      species: 'Gholdengo', moves: [{ name: 'Make It Rain', source: 'revealed' }],
      ability: { value: '', source: 'unknown' }, item: { value: '', source: 'unknown' },
      teraType: { value: '', source: 'unknown' }, evs: unknownEvs(), level: 100, gender: '',
      ruledOut: { items: ['leftovers'], abilities: [] },
    };
    const replaced = selectCuratedSet([plot(), specs()], evidence({ ruledOutItems: ['leftovers'], usageItem: 'Grassy Seed' }));
    expect(resolveItem(info, replaced, null, undefined, 'Choice Scarf')).toBe('Choice Scarf');
    expect(resolveItem(info, replaced, null, undefined)).toBe('Grassy Seed');
  });
});

const usage = (species: string, moves: [string, number][], items: [string, number][]): PokemonUsageStats => ({
  species, rawCount: 1000, abilities: [], spreads: [],
  items: items.map(([value, probability]) => ({ value, probability, sourceDetail: 'u' })),
  moves: moves.map(([value, probability]) => ({ value, probability, sourceDetail: 'u' })),
});
const stats = (...entries: PokemonUsageStats[]): SmogonUsageStats => ({
  format: 'test', month: 'm', source: 's', pokemon: Object.fromEntries(entries.map(entry => [toId(entry.species), entry])),
});
const sets = (...entries: PokemonSetAssumption[]): SmogonSetAssumptions => {
  const [first, ...alternatives] = entries;
  return { format: 'test', source: 's', pokemon: { [toId(first.species)]: { ...first, alternatives } } };
};

const singles = (species: string, moves: string[]) => [
  '|player|p1|Alice|', '|player|p2|Bob|', '|gen|9', '|tier|test',
  '|poke|p1|Skarmory|item', `|poke|p2|${species}|item`, '|start',
  '|switch|p1a: Skarmory|Skarmory|100/100', `|switch|p2a: Mon|${species}|100/100`,
  ...moves.flatMap((move, index) => [`|turn|${index + 1}`, `|move|p2a: Mon|${move}|p1a: Skarmory`]),
].join('\n');
const doubles = (species: string, moves: string[]) => [
  '|player|p1|Alice|', '|player|p2|Bob|', '|gametype|doubles', '|gen|9', '|tier|test',
  '|poke|p1|Skarmory|item', '|poke|p1|Blissey|item', `|poke|p2|${species}|item`, '|poke|p2|Incineroar|item', '|start',
  '|switch|p1a: Skarmory|Skarmory|100/100', '|switch|p1b: Blissey|Blissey|100/100',
  `|switch|p2a: Mon|${species}|100/100`, '|switch|p2b: Cat|Incineroar|100/100',
  ...moves.flatMap((move, index) => [`|turn|${index + 1}`, `|move|p2a: Mon|${move}|p1a: Skarmory`]),
].join('\n');

/** The app's chain without a spread solve, with Leftovers ruled out on the inferred info. */
function build(log: string) {
  const usageStats = stats(usage('Gholdengo', Object.entries({
    'Make It Rain': 0.99, 'Shadow Ball': 0.95, Protect: 0.6, 'Nasty Plot': 0.57, Trick: 0.27, 'Power Gem': 0.1,
  }), [['Leftovers', 0.3], ['Grassy Seed', 0.25], ['Choice Specs', 0.2]]));
  const setAssumptions = sets(plot(), specs());
  const raw = inferOpponentTeam(log, 'p2');
  const gholdengo = raw.pokemon.find(mon => mon.species === 'Gholdengo')!;
  gholdengo.ruledOut = { items: ['leftovers'], abilities: [] };
  const p2Info = enrichTeamInfo(raw, usageStats, setAssumptions);
  const team = buildTeamsFromReplay(log, { p2Info, usageStats, setAssumptions }).p2Team;
  return {
    built: team.find(set => set.species === 'Gholdengo')!.item,
    panel: p2Info.pokemon.find(mon => mon.species === 'Gholdengo')!.item,
  };
}

describe('the panel and the build play the same item after a rule-out', () => {
  test('singles: Leftovers ruled out, the most used allowed item Grassy Seed, not the next set\'s Choice Specs', () => {
    const { built, panel } = build(singles('Gholdengo', ['Make It Rain']));
    expect(built).toBe('Grassy Seed');
    expect(panel).toMatchObject({ value: 'Grassy Seed', source: 'guessed', sourceDetail: 'Leftovers ruled out, most used other item' });
  });

  test('doubles: Leftovers ruled out, the most used allowed item Grassy Seed, not the next set\'s Choice Specs', () => {
    const { built, panel } = build(doubles('Gholdengo', ['Make It Rain']));
    expect(built).toBe('Grassy Seed');
    expect(panel).toMatchObject({ value: 'Grassy Seed', source: 'guessed', sourceDetail: 'Leftovers ruled out, most used other item' });
  });
});
