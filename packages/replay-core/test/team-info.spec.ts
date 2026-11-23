import './champions-mod';
import { test, expect, describe } from 'vitest';
import { selectCuratedSet, type CuratedEvidence } from '../src/set-coherence';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import { enrichTeamInfo, unknownEvs, applyInferredSpreads, enrichPokemonInfo } from '../src/team-info';
import { buildTeamsFromReplay } from '../src/team-builder';
import { resolveItem } from '../src/team/set-resolvers';
import type { PokemonSetAssumption, SmogonSetAssumptions } from '../src/smogon/sets-lookup';
import type { PokemonUsageStats, SmogonUsageStats } from '../src/smogon/stats-types';
import type { RevealedPokemonInfo, PokemonEvs, OpponentTeamInfo } from '../src/types';
import { toId } from '../src/ids';
import { rulesDex } from '../src/rules-dex';
import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import type { SpreadCandidate } from '../src/spread-inference';
import { slotMoveKey } from '../src/team/move-slots';

/**
 * The item after a proven rule-out: when the log rules out the item of the set the evidence picks, that set gives way, and the item
 * the build plays is a guess the log supports (the Boots tell) or else the most used item the log still allows, marked as a guess.
 * The next published set's item is no evidence: in 2663102863 the Leftovers Gholdengo became a Choice Specs Gholdengo that way.
 */

const curated = (species: string, moves: string[], item: string): PokemonSetAssumption => ({
  species, sourceDetail: 's', item: { value: item, sourceDetail: 's' },
  moves: moves.map(value => ({ value, sourceDetail: 's' })),
});
const plot = () => curated('Gholdengo', ['Protect', 'Nasty Plot', 'Make It Rain', 'Shadow Ball'], 'Leftovers');
const specs = () => curated('Gholdengo', ['Make It Rain', 'Shadow Ball', 'Power Gem', 'Trick'], 'Choice Specs');
const usageOf: Record<string, number> = { makeitrain: 0.99, shadowball: 0.95, protect: 0.6, nastyplot: 0.57, trick: 0.27, powergem: 0.1 };
const evidence = (over: Partial<CuratedEvidence>): CuratedEvidence => ({
  dex: rulesDex(9),
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

/** The Nasty Plot set as published: its item slot lists Leftovers, then Metal Coat. */
const plotSlot = (): PokemonSetAssumption => ({
  ...plot(), item: { value: 'Leftovers', sourceDetail: 's', options: ['Leftovers', 'Metal Coat'] },
});

describe('an item slot is read like a move slot (sets as published, round 64 R1)', () => {
  test('a set whose first listed item is ruled out stays a candidate and plays its next listed item', () => {
    const picked = selectCuratedSet([plotSlot(), specs()], evidence({ ruledOutItems: ['leftovers'], usageItem: 'Choice Specs' }));
    expect(picked?.moves.map(move => move.value)).toEqual(['Protect', 'Nasty Plot', 'Make It Rain', 'Shadow Ball']);
    expect(picked?.item?.value).toBe('Metal Coat');
  });

  test('a revealed item on a later option counts toward the fit', () => {
    const picked = selectCuratedSet([specs(), plotSlot()], evidence({
      revealedItem: 'metalcoat', usageProbability: moveId => (moveId === 'trick' || moveId === 'powergem' ? 0.9 : 0.3),
    }));
    expect(picked?.item?.value).toBe('Metal Coat');
    expect(picked?.moves.map(move => move.value)).toContain('Nasty Plot');
  });

  test('only when every listed item is ruled out does the most used allowed item replace it', () => {
    const picked = selectCuratedSet([plotSlot(), specs()], evidence({ ruledOutItems: ['leftovers', 'metalcoat'], usageItem: 'Grassy Seed' }));
    expect(picked?.item).toMatchObject({ value: 'Grassy Seed', sourceDetail: 'Leftovers and Metal Coat ruled out, most used other item' });
  });

  test('a set whose first listed item is allowed is returned as published (the same object)', () => {
    const first = plotSlot();
    expect(selectCuratedSet([first, specs()], evidence({ ruledOutItems: ['metalcoat'] }))).toBe(first);
  });
});

function buildSlot(log: string) {
  const usageStats = stats(usage('Gholdengo', Object.entries({
    'Make It Rain': 0.99, 'Shadow Ball': 0.95, Protect: 0.6, 'Nasty Plot': 0.57, Trick: 0.27, 'Power Gem': 0.1,
  }), [['Choice Specs', 0.25], ['Leftovers', 0.19], ['Grassy Seed', 0.19], ['Metal Coat', 0.03]]));
  const setAssumptions = sets(plotSlot(), specs());
  const raw = inferOpponentTeam(log, 'p2');
  raw.pokemon.find(mon => mon.species === 'Gholdengo')!.ruledOut = { items: ['leftovers'], abilities: [] };
  const p2Info = enrichTeamInfo(raw, usageStats, setAssumptions);
  const team = buildTeamsFromReplay(log, { p2Info, usageStats, setAssumptions }).p2Team;
  const built = team.find(set => set.species === 'Gholdengo')!;
  return { built, panel: p2Info.pokemon.find(mon => mon.species === 'Gholdengo')! };
}

describe('2663102863: Leftovers ruled out, the Nasty Plot set plays its published Metal Coat', () => {
  test('doubles: the build and the panel keep the Nasty Plot set with Metal Coat', () => {
    const { built, panel } = buildSlot(doubles('Gholdengo', ['Make It Rain']));
    expect(built.item).toBe('Metal Coat');
    expect(built.moves).toContain('Nasty Plot');
    expect(panel.item.value).toBe('Metal Coat');
  });

  test('singles: the build and the panel keep the Nasty Plot set with Metal Coat', () => {
    const { built, panel } = buildSlot(singles('Gholdengo', ['Make It Rain']));
    expect(built.item).toBe('Metal Coat');
    expect(panel.item.value).toBe('Metal Coat');
  });
});

describe('item-tell', () => {
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
      // The inference asks the simulator as the build does: no guess at all.
      expect(tell.value).not.toBe('Heavy-Duty Boots');
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
      expect(buildClefable(log).tell.value).not.toBe('Heavy-Duty Boots');
      expect(buildClefable(log).built).toBe('Life Orb');
    });
  });
});

const spread = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number): PokemonEvs => ({ hp, atk, def, spa, spd, spe });

const published = (ivs?: PokemonSetAssumption['ivs']): PokemonSetAssumption => ({
  species: 'Sinistcha', sourceDetail: 'Smogon sets',
  item: { value: 'Sitrus Berry', sourceDetail: 'Smogon sets' },
  ability: { value: 'Hospitality', sourceDetail: 'Smogon sets' },
  moves: ['Rage Powder', 'Trick Room', 'Matcha Gotcha', 'Protect'].map(value => ({ value, sourceDetail: 'Smogon sets' })),
  spread: { value: 'Bold', sourceDetail: 'Smogon sets', nature: 'Quiet', evs: spread(252, 0, 4, 252, 0, 0) },
  ...(ivs ? { ivs } : {}),
});
const assumptions = (format: string, entry: PokemonSetAssumption): SmogonSetAssumptions =>
  ({ format, source: 'test', pokemon: { sinistcha: entry } });

const sinistcha = (overrides: Partial<RevealedPokemonInfo> = {}): RevealedPokemonInfo => ({
  species: 'Sinistcha', moves: [], ability: { value: '', source: 'unknown' }, item: { value: '', source: 'unknown' },
  teraType: { value: '', source: 'unknown' }, evs: { value: spread(0, 0, 0, 0, 0, 0), source: 'unknown' },
  level: 100, gender: '', ...overrides,
});

for (const format of ['gen9ou', 'gen9doublesou']) {
  describe(`IVs in the enriched info (${format})`, () => {
    test('a Trick Room set shows its published IVs as a guess', () => {
      const mon = enrichPokemonInfo(sinistcha(), null, assumptions(format, published({ atk: 0, spe: 0 })));
      expect(mon.ivs?.source).toBe('guessed');
      expect(mon.ivs?.value).toEqual({ hp: 31, atk: 0, def: 31, spa: 31, spd: 31, spe: 0 });
    });

    test('a set without IVs leaves the info without IVs', () => {
      expect(enrichPokemonInfo(sinistcha(), null, assumptions(format, published())).ivs).toBeUndefined();
    });

    test('IVs the user set stay', () => {
      const manual = { value: spread(31, 31, 31, 31, 31, 31), source: 'manual' as const };
      const mon = enrichPokemonInfo(sinistcha({ ivs: manual }), null, assumptions(format, published({ atk: 0, spe: 0 })));
      expect(mon.ivs).toEqual(manual);
    });

    test('the info the build reads plays the same IVs as the info shows', () => {
      const log = [
        '|player|p1|Alice|', '|player|p2|Bob|', '|gen|9', `|tier|[Gen 9] ${format === 'gen9ou' ? 'OU' : 'Doubles OU'}`,
        ...(format === 'gen9ou' ? [] : ['|gametype|doubles']),
        '|poke|p1|Garchomp, M|', '|poke|p2|Sinistcha, F|',
      ].join('\n');
      const setAssumptions = assumptions(format, published({ atk: 0, spe: 0 }));
      const built = buildTeamsFromReplay(log, { setAssumptions }).p2Team.find(set => set.species === 'Sinistcha')!;
      const shown = enrichTeamInfo({ pokemon: [sinistcha()] }, null, setAssumptions).pokemon[0];
      expect(shown.ivs?.value).toEqual({ ...{ hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, ...built.ivs });
      expect(built.ivs?.spe).toBe(0);
    });
  });
}

describe('IVs in a Champions format', () => {
  test('the build plays IV 31 whatever the set lists, so the panel shows none', () => {
    const mon = enrichPokemonInfo(sinistcha(), null, assumptions('championsvgc2026', published({ atk: 0 })));
    expect(mon.ivs).toBeUndefined();
  });
});

describe('IVs the solver carries', () => {
  const candidate = (ivs: PokemonEvs): SpreadCandidate => ({ evs: spread(252, 0, 4, 252, 0, 0), nature: 'Quiet', origin: 'order', ivs });

  test('the Speed IV a seen order took back replaces the published one', () => {
    const shown = enrichPokemonInfo(sinistcha(), null, assumptions('gen9ou', published({ atk: 0, spe: 0 })));
    const applied = applyInferredSpreads({ pokemon: [shown] }, 'p1', new Map([['p1:sinistcha', candidate(spread(31, 0, 31, 31, 31, 31))]])).pokemon[0];
    expect(applied.ivs?.source).toBe('guessed');
    expect(applied.ivs?.value).toEqual(spread(31, 0, 31, 31, 31, 31));
  });

  test('a candidate without IVs leaves the shown IVs alone', () => {
    const shown = enrichPokemonInfo(sinistcha(), null, assumptions('gen9ou', published({ atk: 0, spe: 0 })));
    const applied = applyInferredSpreads({ pokemon: [shown] }, 'p1', new Map([['p1:sinistcha', { ...candidate(spread(0, 0, 0, 0, 0, 0)), ivs: undefined }]])).pokemon[0];
    expect(applied.ivs).toEqual(shown.ivs);
  });

  test('IVs the user set are never replaced', () => {
    const manual = { value: spread(31, 31, 31, 31, 31, 31), source: 'manual' as const };
    const applied = applyInferredSpreads({ pokemon: [sinistcha({ ivs: manual })] }, 'p1', new Map([['p1:sinistcha', candidate(spread(31, 0, 31, 31, 31, 0))]])).pokemon[0];
    expect(applied.ivs).toEqual(manual);
  });
});

describe('set-fidelity', () => {
  const usage = (species: string, moves: [string, number][], items: [string, number][] = []): PokemonUsageStats => ({
    species, rawCount: 1000, abilities: [], spreads: [],
    items: items.map(([value, probability]) => ({ value, probability, sourceDetail: 'u' })),
    moves: moves.map(([value, probability]) => ({ value, probability, sourceDetail: 'u' })),
  });
  const stats = (...entries: PokemonUsageStats[]): SmogonUsageStats => ({
    format: 'test', month: 'm', source: 's', pokemon: Object.fromEntries(entries.map(entry => [toId(entry.species), entry])),
  });
  const smogonSet = (species: string, moves: (string | string[])[], item: string): PokemonSetAssumption => ({
    species, sourceDetail: 's', item: { value: item, sourceDetail: 's' },
    moves: moves.map(slot => Array.isArray(slot)
      ? { value: slot[0], sourceDetail: 's', options: slot }
      : { value: slot, sourceDetail: 's' }),
  });
  const sets = (...entries: PokemonSetAssumption[]): SmogonSetAssumptions => ({
    format: 'test', source: 's', pokemon: Object.fromEntries(entries.map(entry => [toId(entry.species), entry])),
  });

  function build(log: string, species: string, usageStats: SmogonUsageStats, setAssumptions: SmogonSetAssumptions | null, info?: OpponentTeamInfo) {
    const p2Info = info ?? enrichTeamInfo(inferOpponentTeam(log, 'p2'), usageStats, setAssumptions);
    const team = buildTeamsFromReplay(log, { p2Info, usageStats, setAssumptions }).p2Team;
    const keys = (moves: string[]) => moves.map(move => slotMoveKey(rulesDex(9), move)).sort();
    return {
      built: keys(team.find(set => set.species === species)!.moves),
      panel: keys(p2Info.pokemon.find(mon => mon.species === species)!.moves.map(move => move.name)),
    };
  }
  const keysOf = (...moves: string[]) => moves.map(move => slotMoveKey(rulesDex(9), move)).sort();

  const singles = (gen: number, species: string, moves: string[], extra: string[] = []) => [
    '|player|p1|Alice|', '|player|p2|Bob|', `|gen|${gen}`, '|tier|test',
    '|poke|p1|Skarmory|item', `|poke|p2|${species}|item`, '|start',
    '|switch|p1a: Skarmory|Skarmory|100/100', `|switch|p2a: Mon|${species}|100/100`, ...extra,
    ...moves.flatMap((move, index) => [`|turn|${index + 1}`, `|move|p2a: Mon|${move}|p1a: Skarmory`]),
  ].join('\n');
  const doubles = (species: string, moves: string[], extra: string[] = []) => [
    '|player|p1|Alice|', '|player|p2|Bob|', '|gametype|doubles', '|gen|9', '|tier|test',
    '|poke|p1|Skarmory|item', '|poke|p1|Blissey|item', `|poke|p2|${species}|item`, '|poke|p2|Incineroar|item', '|start',
    '|switch|p1a: Skarmory|Skarmory|100/100', '|switch|p1b: Blissey|Blissey|100/100',
    `|switch|p2a: Mon|${species}|100/100`, '|switch|p2b: Cat|Incineroar|100/100', ...extra,
    ...moves.flatMap((move, index) => [`|turn|${index + 1}`, `|move|p2a: Mon|${move}|p1a: Skarmory`]),
  ].join('\n');

  describe('the chosen set before every guess (T89, T28)', () => {
    test('singles, 648453: Tornadus-T builds Knock Off, not the second option Heat Wave', () => {
      const log = singles(6, 'Tornadus-Therian', ['U-turn', 'Hidden Power', 'Hurricane']);
      const usageStats = stats(usage('Tornadus-Therian', [['U-turn', 0.9], ['Hurricane', 0.9], ['Heat Wave', 0.5], ['Knock Off', 0.45], ['Hidden Power Ice', 0.4]]));
      const setAssumptions = sets(smogonSet('Tornadus-Therian', ['Hurricane', ['Heat Wave', 'Hidden Power Ice'], 'Knock Off', 'U-turn'], 'Assault Vest'));
      const { built, panel } = build(log, 'Tornadus-Therian', usageStats, setAssumptions);
      expect(built).toEqual(keysOf('U-turn', 'Hidden Power', 'Hurricane', 'Knock Off'));
      expect(panel).toEqual(built);
    });

    test('doubles: Tornadus with Rain Dance seen keeps the fixed Protect, not Taunt', () => {
      const log = doubles('Tornadus', ['Bleakwind Storm', 'Tailwind', 'Rain Dance']);
      const usageStats = stats(usage('Tornadus', [['Bleakwind Storm', 0.9], ['Tailwind', 0.9], ['Taunt', 0.6], ['Protect', 0.5], ['Rain Dance', 0.3]]));
      const setAssumptions = sets(smogonSet('Tornadus', ['Bleakwind Storm', 'Tailwind', ['Taunt', 'Rain Dance', 'Sunny Day'], 'Protect'], 'Covert Cloak'));
      const { built, panel } = build(log, 'Tornadus', usageStats, setAssumptions);
      expect(built).toEqual(keysOf('Bleakwind Storm', 'Tailwind', 'Rain Dance', 'Protect'));
      expect(panel).toEqual(built);
    });

    test('singles: the chosen set\'s second Dark attack survives row 2 in the panel and the build (Samurott-Hisui)', () => {
      const log = singles(9, 'Samurott-Hisui', ['Ceaseless Edge']);
      const usageStats = stats(usage('Samurott-Hisui', [['Ceaseless Edge', 0.9], ['Razor Shell', 0.7], ['Sacred Sword', 0.5], ['Sucker Punch', 0.45], ['Knock Off', 0.4]]));
      const setAssumptions = sets(smogonSet('Samurott-Hisui', ['Ceaseless Edge', 'Razor Shell', 'Sucker Punch', 'Knock Off'], 'Assault Vest'));
      const { built, panel } = build(log, 'Samurott-Hisui', usageStats, setAssumptions);
      expect(built).toEqual(keysOf('Ceaseless Edge', 'Razor Shell', 'Sucker Punch', 'Knock Off'));
      expect(panel).toEqual(built);
    });

    test('singles: a guess the enrichment left in the info stands behind the chosen set (Kyurem with Specs)', () => {
      const log = singles(9, 'Kyurem', []);
      const usageStats = stats(usage('Kyurem', [['Icicle Spear', 0.19], ['Dragon Dance', 0.16]]));
      const setAssumptions = sets(smogonSet('Kyurem', ['Ice Beam', 'Freeze-Dry', 'Earth Power', 'Draco Meteor'], 'Choice Specs'));
      const info = inferOpponentTeam(log, 'p2');
      info.pokemon[0].moves.push({ name: 'Icicle Spear', source: 'guessed' });
      const { built } = build(log, 'Kyurem', usageStats, setAssumptions, info);
      expect(built).toEqual(keysOf('Ice Beam', 'Freeze-Dry', 'Earth Power', 'Draco Meteor'));
    });

    test('doubles: a short pool reaches past the first ten usage moves (Latios with Choice Scarf)', () => {
      const log = doubles('Latios', ['Draco Meteor', 'Ice Beam'], ['|-item|p2a: Mon|Choice Scarf|[from] ability: Frisk|[of] p1a: Skarmory']);
      const usageStats = stats(usage('Latios', [
        ['Heal Pulse', 0.7], ['Simple Beam', 0.62], ['Ally Switch', 0.61], ['Dragon Cheer', 0.49], ['Luster Purge', 0.32],
        ['Draco Meteor', 0.2], ['Dragon Pulse', 0.19], ['Protect', 0.15], ['Tailwind', 0.11], ['Icy Wind', 0.09],
        ['Psyshock', 0.08], ['Thunderbolt', 0.07],
      ]));
      const { built, panel } = build(log, 'Latios', usageStats, null);
      expect(built).toEqual(keysOf('Draco Meteor', 'Ice Beam', 'Luster Purge', 'Thunderbolt'));
      expect(panel).toEqual(built);
    });

    test('singles: an item knocked off or consumed still picks its set (Dragonite\'s Choice Band keeps Outrage)', () => {
      // Gen 9 previews carry no item marker.
      const log = singles(9, 'Dragonite', ['Ice Spinner'], ['|-enditem|p2a: Mon|Choice Band|[from] move: Knock Off|[of] p1a: Skarmory'])
        .replace('|poke|p2|Dragonite|item', '|poke|p2|Dragonite|');
      const usageStats = stats(usage('Dragonite', [['Earthquake', 0.77], ['Dragon Dance', 0.75], ['Extreme Speed', 0.67], ['Roost', 0.56], ['Ice Spinner', 0.33], ['Fire Punch', 0.21], ['Outrage', 0.14]]));
      const setAssumptions = sets({
        ...smogonSet('Dragonite', ['Dragon Dance', ['Extreme Speed', 'Ice Spinner'], 'Earthquake', ['Ice Spinner', 'Roost', 'Encore']], 'Heavy-Duty Boots'),
        alternatives: [smogonSet('Dragonite', ['Outrage', 'Extreme Speed', ['Earthquake', 'Ice Spinner'], ['Fire Punch', 'Ice Spinner']], 'Choice Band')],
      });
      const { built, panel } = build(log, 'Dragonite', usageStats, setAssumptions);
      expect(built).toEqual(keysOf('Ice Spinner', 'Outrage', 'Extreme Speed', 'Fire Punch'));
      expect(panel).toEqual(built);
    });

    test('doubles: a forme without its own usage entry reads its base when the Dex says they battle alike (Gastrodon-East)', () => {
      const log = doubles('Gastrodon-East', ['Ice Beam', 'Earth Power']);
      const usageStats = stats(usage('Gastrodon', [['Recover', 0.8], ['Earth Power', 0.7], ['Ice Beam', 0.6], ['Clear Smog', 0.5], ['Protect', 0.4]]));
      const { built, panel } = build(log, 'Gastrodon-East', usageStats, null);
      expect(built).toEqual(keysOf('Ice Beam', 'Earth Power', 'Recover', 'Clear Smog'));
      expect(panel).toEqual(built);
    });

    test('singles: Maushold-Four reads Maushold\'s usage; Rotom-Wash never reads Rotom\'s', () => {
      const maushold = build(singles(9, 'Maushold-Four', ['Tidy Up']), 'Maushold-Four',
        stats(usage('Maushold', [['Population Bomb', 0.9], ['Tidy Up', 0.8], ['Bite', 0.6], ['Protect', 0.5], ['Encore', 0.3]])), null);
      expect(maushold.built).toEqual(keysOf('Tidy Up', 'Population Bomb', 'Bite', 'Protect'));
      // Rotom-Wash differs from Rotom in type and stats: Rotom's moves would be a different Pokémon's.
      const rotom = build(singles(9, 'Rotom-Wash', ['Hydro Pump']), 'Rotom-Wash',
        stats(usage('Rotom', [['Shadow Ball', 0.9], ['Thunderbolt', 0.8], ['Will-O-Wisp', 0.6], ['Nasty Plot', 0.5]])), null);
      expect(rotom.built).toEqual(keysOf('Hydro Pump'));
    });

    // The usage tail must not join row 1's boost context: a boost at a fraction of a percent struck the guessed special attacks of
    // every set no chosen Smogon set covered.
    const tail = (top: [string, number][]): [string, number][] => [...top, ['Dragon Dance', 0.002], ['Swords Dance', 0.001]];

    test('singles: a boost in the usage tail leaves Kingdra its special attacks', () => {
      const log = singles(9, 'Kingdra', ['Hydro Pump']);
      const usageStats = stats(usage('Kingdra', tail([
        ['Hydro Pump', 0.9], ['Draco Meteor', 0.8], ['Weather Ball', 0.6], ['Hurricane', 0.5], ['Rain Dance', 0.3],
        ['Protect', 0.2], ['Surf', 0.15], ['Ice Beam', 0.1], ['Flip Turn', 0.08], ['Focus Energy', 0.05],
      ]), [['Life Orb', 0.6]]));
      const { built, panel } = build(log, 'Kingdra', usageStats, null);
      expect(built).toEqual(keysOf('Hydro Pump', 'Draco Meteor', 'Weather Ball', 'Hurricane'));
      expect(panel).toEqual(built);
    });

    test('doubles: a boost in the usage tail leaves Kyurem with Life Orb its special attacks', () => {
      const log = doubles('Kyurem', ['Freeze-Dry']);
      const usageStats = stats(usage('Kyurem', tail([
        ['Freeze-Dry', 0.9], ['Earth Power', 0.8], ['Draco Meteor', 0.7], ['Flash Cannon', 0.5], ['Protect', 0.4],
        ['Icy Wind', 0.3], ['Blizzard', 0.2], ['Glaciate', 0.1], ['Ice Beam', 0.08], ['Substitute', 0.05],
      ]), [['Life Orb', 0.6]]));
      const { built, panel } = build(log, 'Kyurem', usageStats, null);
      expect(built).toEqual(keysOf('Freeze-Dry', 'Earth Power', 'Draco Meteor', 'Flash Cannon'));
      expect(panel).toEqual(built);
    });

    test('fewer than four moves only when the pool holds fewer than four allowed ones (no usage, no set)', () => {
      const log = singles(9, 'Decidueye', ['Shadow Sneak', 'Swords Dance']);
      const { built } = build(log, 'Decidueye', stats(), null);
      expect(built).toEqual(keysOf('Shadow Sneak', 'Swords Dance'));
    });
  });
});
