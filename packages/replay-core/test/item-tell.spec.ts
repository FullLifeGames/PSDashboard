import { test, expect, describe } from 'vitest';
import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
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

/** A sim-generated spectator log (gen 9 OU or Doubles OU), as in item-evidence.spec.ts. */
function play(p1: PokemonSet[], p2: PokemonSet[], turns: [string, string][], doubles = false): string {
  const battle = new Battle({
    formatid: toID(doubles ? 'gen9doublesou' : 'gen9ou'), seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) },
  });
  battle.choose('p1', 'team 1');
  battle.choose('p2', 'team 1');
  for (const [p1Choice, p2Choice] of turns) {
    battle.choose('p1', p1Choice);
    battle.choose('p2', p2Choice);
  }
  const lines = battle.log;
  return lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
}
const mon = (species: string, item: string, ability: string, moves: string[]): PokemonSet => ({
  name: species, species, item, ability, moves, nature: 'Hardy', level: 100, gender: '',
  evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
});

describe('the tell is no evidence while an ability the Pokémon may have keeps the rocks off (review of round 64)', () => {
  const clefableSet: PokemonSetAssumption = {
    species: 'Clefable', sourceDetail: 's', item: { value: 'Life Orb', sourceDetail: 's' },
    moves: ['Moonblast', 'Fire Blast', 'Calm Mind', 'Moonlight'].map(value => ({ value, sourceDetail: 's' })),
  };
  const clefableSets: SmogonSetAssumptions = { format: 'test', source: 's', pokemon: { clefable: clefableSet } };
  const clefableUsage = stats(usage('Clefable',
    [['Moonblast', 0.9], ['Fire Blast', 0.6], ['Calm Mind', 0.5], ['Moonlight', 0.5]],
    [['Life Orb', 0.5], ['Leftovers', 0.3], ['Heavy-Duty Boots', 0.1]]));
  // Magic Guard keeps the rock damage off and hides the Life Orb recoil as well.
  const clefable = () => mon('Clefable', 'Life Orb', 'Magic Guard', ['Moonblast']);
  const buildClefable = (log: string) => {
    const raw = inferOpponentTeam(log, 'p2');
    const p2Info = enrichTeamInfo(raw, clefableUsage, clefableSets);
    const team = buildTeamsFromReplay(log, { p2Info, usageStats: clefableUsage, setAssumptions: clefableSets }).p2Team;
    return { tell: raw.pokemon.find(entry => entry.species === 'Clefable')!.item, built: team.find(set => set.species === 'Clefable')!.item };
  };

  test('singles: a Magic Guard Clefable enters on Stealth Rock without damage and plays its set\'s Life Orb, not Boots', () => {
    const log = play(
      [mon('Skarmory', '', 'Sturdy', ['Stealth Rock', 'Roost'])],
      [mon('Chansey', '', 'Natural Cure', ['Soft-Boiled']), clefable()],
      [['move stealthrock', 'move softboiled'], ['move roost', 'switch 2'], ['move roost', 'move moonblast']],
    );
    expect(log).toMatch(/\|switch\|p2a: Clefable/);
    expect(log).not.toMatch(/\|-damage\|p2a: Clefable\|[^\n]*\[from\] Stealth Rock/);
    expect(log).not.toMatch(/\[from\] item: Life Orb/);
    const { tell, built } = buildClefable(log);
    expect(tell).toMatchObject({ value: 'Heavy-Duty Boots', source: 'guessed' });
    expect(built).toBe('Life Orb');
  });

  test('doubles: the same Clefable plays its set\'s Life Orb', () => {
    const log = play(
      [mon('Skarmory', '', 'Sturdy', ['Stealth Rock', 'Roost']), mon('Blissey', '', 'Natural Cure', ['Soft-Boiled'])],
      [mon('Chansey', '', 'Natural Cure', ['Soft-Boiled']), mon('Talonflame', '', 'Gale Wings', ['Roost']), clefable()],
      [
        ['move stealthrock, move softboiled', 'move softboiled, move roost'],
        ['move roost, move softboiled', 'switch 3, move roost'],
        ['move roost, move softboiled', 'move moonblast 1, move roost'],
      ],
      true,
    );
    expect(log).toMatch(/\|switch\|p2a: Clefable/);
    expect(buildClefable(log).tell).toMatchObject({ value: 'Heavy-Duty Boots', source: 'guessed' });
    expect(buildClefable(log).built).toBe('Life Orb');
  });
});
