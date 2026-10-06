import { test, expect, describe } from 'vitest';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import { enrichTeamInfo } from '../src/team-info';
import { buildTeamsFromReplay } from '../src/team-builder';
import { resolveItem } from '../src/team/set-resolvers';
import type { PokemonSetAssumption, SmogonSetAssumptions } from '../src/smogon/sets-lookup';
import type { PokemonUsageStats, SmogonUsageStats } from '../src/smogon/stats-types';
import { toId } from '../src/ids';

/**
 * An item the protocol inference itself tells (round 64, T120, decision 19):
 * a Pokémon that switches into Stealth Rock without damage shows Heavy-Duty
 * Boots. That reading is evidence, so the build plays it ahead of the chosen
 * Smogon set's item, as the panel already shows it. Precedence: revealed or
 * consumed, the solver's item, the tell, the chosen set's item, usage.
 * Scene: 2658671385 p2 Great Tusk, built with the set's Rocky Helmet.
 */

const usage = (species: string, moves: [string, number][], items: [string, number][]): PokemonUsageStats => ({
  species, rawCount: 1000, abilities: [], spreads: [],
  items: items.map(([value, probability]) => ({ value, probability, sourceDetail: 'u' })),
  moves: moves.map(([value, probability]) => ({ value, probability, sourceDetail: 'u' })),
});
const stats = (...entries: PokemonUsageStats[]): SmogonUsageStats => ({
  format: 'test', month: 'm', source: 's', pokemon: Object.fromEntries(entries.map(entry => [toId(entry.species), entry])),
});
const helmetSet: PokemonSetAssumption = {
  species: 'Great Tusk', sourceDetail: 's', item: { value: 'Rocky Helmet', sourceDetail: 's' },
  moves: ['Headlong Rush', 'Rapid Spin', 'Ice Spinner', 'Knock Off'].map(value => ({ value, sourceDetail: 's' })),
};
const sets: SmogonSetAssumptions = { format: 'test', source: 's', pokemon: { greattusk: helmetSet } };
const usageStats = stats(usage('Great Tusk',
  [['Headlong Rush', 0.9], ['Rapid Spin', 0.8], ['Ice Spinner', 0.7], ['Knock Off', 0.5]],
  [['Rocky Helmet', 0.4], ['Booster Energy', 0.3], ['Heavy-Duty Boots', 0.2]]));

/** p1 lays Stealth Rock, p2 brings Great Tusk in on them without damage, then it attacks. */
const singles = [
  '|player|p1|Alice|', '|player|p2|Bob|', '|gen|9', '|tier|test',
  '|poke|p1|Skarmory|item', '|poke|p2|Blissey|item', '|poke|p2|Great Tusk|item', '|start',
  '|switch|p1a: Skarmory|Skarmory|100/100', '|switch|p2a: Blissey|Blissey|100/100',
  '|turn|1', '|move|p1a: Skarmory|Stealth Rock|p2a: Blissey', '|-sidestart|p2: Bob|move: Stealth Rock',
  '|turn|2', '|switch|p2a: Tusk|Great Tusk|100/100', '|move|p1a: Skarmory|Roost|p1a: Skarmory',
  '|turn|3', '|move|p2a: Tusk|Headlong Rush|p1a: Skarmory',
].join('\n');
const doubles = [
  '|player|p1|Alice|', '|player|p2|Bob|', '|gametype|doubles', '|gen|9', '|tier|test',
  '|poke|p1|Skarmory|item', '|poke|p1|Blissey|item', '|poke|p2|Chansey|item', '|poke|p2|Incineroar|item', '|poke|p2|Great Tusk|item', '|start',
  '|switch|p1a: Skarmory|Skarmory|100/100', '|switch|p1b: Blissey|Blissey|100/100',
  '|switch|p2a: Chansey|Chansey|100/100', '|switch|p2b: Cat|Incineroar|100/100',
  '|turn|1', '|move|p1a: Skarmory|Stealth Rock|p2a: Chansey', '|-sidestart|p2: Bob|move: Stealth Rock',
  '|turn|2', '|switch|p2a: Tusk|Great Tusk|100/100', '|move|p1a: Skarmory|Roost|p1a: Skarmory',
  '|turn|3', '|move|p2a: Tusk|Headlong Rush|p1a: Skarmory',
].join('\n');

function build(log: string) {
  const raw = inferOpponentTeam(log, 'p2');
  const p2Info = enrichTeamInfo(raw, usageStats, sets);
  const team = buildTeamsFromReplay(log, { p2Info, usageStats, setAssumptions: sets }).p2Team;
  return {
    tell: raw.pokemon.find(mon => mon.species === 'Great Tusk')!.item,
    built: team.find(set => set.species === 'Great Tusk')!.item,
    panel: p2Info.pokemon.find(mon => mon.species === 'Great Tusk')!.item.value,
  };
}

describe('the Heavy-Duty Boots tell beats the chosen set\'s item', () => {
  test('singles, 2658671385 scene: Great Tusk plays the Boots the panel shows, not the set\'s Rocky Helmet', () => {
    const { tell, built, panel } = build(singles);
    expect(tell).toMatchObject({ value: 'Heavy-Duty Boots', source: 'guessed' });
    expect(panel).toBe('Heavy-Duty Boots');
    expect(built).toBe('Heavy-Duty Boots');
  });

  test('doubles: the same tell plays the same way', () => {
    const { built, panel } = build(doubles);
    expect(panel).toBe('Heavy-Duty Boots');
    expect(built).toBe('Heavy-Duty Boots');
  });

  test('guard: the solver\'s item comes before the tell, the tell before the chosen set', () => {
    const info = inferOpponentTeam(singles, 'p2').pokemon.find(mon => mon.species === 'Great Tusk')!;
    expect(resolveItem(info, helmetSet, null, undefined, 'Choice Scarf', 'Heavy-Duty Boots')).toBe('Choice Scarf');
    expect(resolveItem(info, helmetSet, null, undefined, '', 'Heavy-Duty Boots')).toBe('Heavy-Duty Boots');
    expect(resolveItem({ ...info, ruledOut: { items: ['heavydutyboots'], abilities: [] } }, helmetSet, null, undefined, '', 'Heavy-Duty Boots'))
      .toBe('Rocky Helmet');
  });
});
