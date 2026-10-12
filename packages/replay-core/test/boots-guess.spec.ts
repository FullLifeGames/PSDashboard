import { test, expect, describe } from 'vitest';
import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import { enrichTeamInfo } from '../src/team-info';
import { buildTeamsFromReplay } from '../src/team-builder';
import type { PokemonSetAssumption, SmogonSetAssumptions } from '../src/smogon/sets-lookup';
import type { PokemonUsageStats, SmogonUsageStats } from '../src/smogon/stats-types';
import { toId } from '../src/ids';

/**
 * The Heavy-Duty Boots guess (round 67, T130, decision 18): a Pokémon that
 * enters on Stealth Rock without damage shows Boots only while no ability it
 * may have keeps the rock damage off. The inference asks the simulator, as
 * the build does since round 64, so the panel stops showing a guess the build
 * refuses, and the guess cannot reach the build through the usage fallback or
 * as the replacement after a rule-out. Logs come from @pkmn/sim.
 */

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

const usage = (species: string, moves: [string, number][], items: [string, number][]): PokemonUsageStats => ({
  species, rawCount: 1000, abilities: [], spreads: [],
  items: items.map(([value, probability]) => ({ value, probability, sourceDetail: 'u' })),
  moves: moves.map(([value, probability]) => ({ value, probability, sourceDetail: 'u' })),
});
const stats = (...entries: PokemonUsageStats[]): SmogonUsageStats => ({
  format: 'test', month: 'm', source: 's', pokemon: Object.fromEntries(entries.map(entry => [toId(entry.species), entry])),
});
const set = (species: string, item: string, moves: string[]): PokemonSetAssumption => ({
  species, sourceDetail: 's', item: { value: item, sourceDetail: 's' }, moves: moves.map(value => ({ value, sourceDetail: 's' })),
});
const clefableUsage = stats(usage('Clefable',
  [['Moonblast', 0.9], ['Calm Mind', 0.6], ['Moonlight', 0.5], ['Flamethrower', 0.4]],
  [['Life Orb', 0.5], ['Leftovers', 0.3], ['Heavy-Duty Boots', 0.1]]));
const noSets: SmogonSetAssumptions = { format: 'test', source: 's', pokemon: {} };

const clefable = (item = 'Life Orb', ability = 'Magic Guard') => mon('Clefable', item, ability, ['Moonblast', 'Calm Mind']);
const rocks = () => mon('Skarmory', '', 'Sturdy', ['Stealth Rock', 'Roost', 'Brave Bird']);

/** p1 lays Stealth Rock, p2 brings `entrant` in on it, then `entrant` attacks (or takes `hit` first). */
function singlesEntry(entrant: PokemonSet, hit = 'roost'): string {
  return play([rocks()], [mon('Chansey', '', 'Natural Cure', ['Soft-Boiled']), entrant],
    [['move stealthrock', 'move softboiled'], ['move roost', 'switch 2'], [`move ${hit}`, 'move moonblast']]);
}

function doublesEntry(entrant: PokemonSet): string {
  return play(
    [rocks(), mon('Blissey', '', 'Natural Cure', ['Soft-Boiled'])],
    [mon('Chansey', '', 'Natural Cure', ['Soft-Boiled']), mon('Talonflame', '', 'Gale Wings', ['Roost']), entrant],
    [
      ['move stealthrock, move softboiled', 'move softboiled, move roost'],
      ['move roost, move softboiled', 'switch 3, move roost'],
      ['move roost, move softboiled', 'move moonblast 1, move roost'],
    ],
    true,
  );
}

const rawItem = (log: string, species = 'Clefable') =>
  inferOpponentTeam(log, 'p2').pokemon.find(entry => entry.species === species)!.item;

function panelAndBuild(log: string, usageStats: SmogonUsageStats, sets: SmogonSetAssumptions) {
  const p2Info = enrichTeamInfo(inferOpponentTeam(log, 'p2'), usageStats, sets);
  const team = buildTeamsFromReplay(log, { p2Info, usageStats, setAssumptions: sets }).p2Team;
  return {
    panel: p2Info.pokemon.find(entry => entry.species === 'Clefable')!.item.value,
    built: team.find(entry => entry.species === 'Clefable')!.item,
  };
}

describe('no Boots guess while an ability the Pokémon may have keeps the rocks off (T130)', () => {
  test('singles: the simulator keeps the rock damage off a Magic Guard Clefable, and the inference guesses nothing', () => {
    const log = singlesEntry(clefable());
    expect(log).toMatch(/\|switch\|p2a: Clefable/);
    expect(log).not.toMatch(/\|-damage\|p2a: Clefable\|[^\n]*\[from\] Stealth Rock/);
    expect(rawItem(log).value).not.toBe('Heavy-Duty Boots');
  });

  test('doubles: the same Clefable gets no Boots guess', () => {
    const log = doublesEntry(clefable());
    expect(log).toMatch(/\|switch\|p2a: Clefable/);
    expect(rawItem(log).value).not.toBe('Heavy-Duty Boots');
  });

  test('singles: the panel shows the item the build plays', () => {
    const sets: SmogonSetAssumptions = {
      format: 'test', source: 's', pokemon: { clefable: set('Clefable', 'Life Orb', ['Moonblast', 'Calm Mind', 'Moonlight', 'Flamethrower']) },
    };
    expect(panelAndBuild(singlesEntry(clefable()), clefableUsage, sets)).toEqual({ panel: 'Life Orb', built: 'Life Orb' });
  });

  test('doubles: the panel shows the item the build plays', () => {
    const sets: SmogonSetAssumptions = {
      format: 'test', source: 's', pokemon: { clefable: set('Clefable', 'Life Orb', ['Moonblast', 'Calm Mind', 'Moonlight', 'Flamethrower']) },
    };
    expect(panelAndBuild(doublesEntry(clefable()), clefableUsage, sets)).toEqual({ panel: 'Life Orb', built: 'Life Orb' });
  });

  test('without a published set the guess does not reach the build through the usage fallback', () => {
    expect(panelAndBuild(singlesEntry(clefable()), clefableUsage, noSets)).toEqual({ panel: 'Life Orb', built: 'Life Orb' });
  });

  test('after a rule-out the guess is no replacement: the usage majority the log allows plays', () => {
    // Brave Bird leaves the Clefable below full HP and no Leftovers heal shows (T80): the Leftovers set gives way.
    const log = singlesEntry(clefable(), 'bravebird');
    expect(inferOpponentTeam(log, 'p2').pokemon.find(entry => entry.species === 'Clefable')!.ruledOut?.items).toContain('leftovers');
    const sets: SmogonSetAssumptions = {
      format: 'test', source: 's', pokemon: {
        clefable: {
          ...set('Clefable', 'Leftovers', ['Moonblast', 'Calm Mind', 'Moonlight', 'Flamethrower']),
          alternatives: [set('Clefable', 'Sticky Barb', ['Moonblast', 'Knock Off', 'Moonlight', 'Flamethrower'])],
        },
      },
    };
    expect(panelAndBuild(log, clefableUsage, sets)).toEqual({ panel: 'Life Orb', built: 'Life Orb' });
  });
});

describe('the guess stands where no possible ability keeps the rocks off (guards)', () => {
  test('singles: a Corviknight that takes no rock damage still shows Boots', () => {
    const log = singlesEntry(mon('Corviknight', 'Heavy-Duty Boots', 'Pressure', ['Brave Bird', 'Roost']));
    expect(rawItem(log, 'Corviknight')).toMatchObject({ value: 'Heavy-Duty Boots', source: 'guessed' });
  });

  test('singles: a Clefable that reveals Unaware shows Boots again', () => {
    const log = play(
      [rocks()],
      [mon('Chansey', '', 'Natural Cure', ['Soft-Boiled']), mon('Clefable', 'Heavy-Duty Boots', 'Unaware', ['Moonblast'])],
      [['move stealthrock', 'move softboiled'], ['move roost', 'switch 2'], ['move roost', 'move moonblast']],
    );
    const withUnaware = `${log}\n|-ability|p2a: Clefable|Unaware`;
    expect(rawItem(withUnaware)).toMatchObject({ value: 'Heavy-Duty Boots', source: 'guessed' });
  });
});

/**
 * Round 67 gate (11.10.): draft leagues play their games as custom games under the usual abilities, so a custom game
 * keeps each species to its own abilities. Noivern (Frisk, Infiltrator, Telepathy) can never have Magic Guard, and an
 * entry on Stealth Rock without damage reads as Heavy-Duty Boots there too (the GPL report's Noivern, eval-gpl t35).
 */
describe('a custom game keeps each species to its own abilities (round 67 gate)', () => {
  test('a Noivern on Stealth Rock without damage reads as Heavy-Duty Boots in a custom game', () => {
    const noivern = mon('Noivern', 'Heavy-Duty Boots', 'Infiltrator', ['Draco Meteor', 'Hurricane']);
    const log = play([rocks()], [mon('Chansey', '', 'Natural Cure', ['Soft-Boiled']), noivern],
      [['move stealthrock', 'move softboiled'], ['move roost', 'switch 2'], ['move roost', 'move dracometeor']])
      .replace('|tier|[Gen 9] OU', '|tier|[Gen 9] Custom Game');
    expect(log).toMatch(/\|tier\|\[Gen 9\] Custom Game/);
    expect(log).not.toMatch(/\|-damage\|p2a: Noivern\|[^\n]*\[from\] Stealth Rock/);
    expect(rawItem(log, 'Noivern').value).toBe('Heavy-Duty Boots');
  });
});
