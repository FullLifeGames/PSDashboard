import { test, expect, describe, beforeAll } from 'vitest';
import { Battle, Teams, toID, type PokemonSet, Dex } from '@pkmn/sim';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import {
  enrichTeamInfo,
  applyInferredSpreads,
  guessedEvs,
  guessedField,
  INFERRED_SPREAD_DETAIL,
  ORDER_SPREAD_DETAIL,
  MEASURED_HP_SPREAD_DETAIL,
  revealedField,
  unknownField,
  EMPTY_EVS,
  itemSetValue,
} from '../src/team-info';
import { buildTeamsFromReplay } from '../src/team-builder';
import type { PokemonSetAssumption, SmogonSetAssumptions } from '../src/smogon/sets-lookup';
import type { PokemonUsageStats, SmogonUsageStats } from '../src/smogon/stats-types';
import { toId } from '../src/ids';
import type { SpreadCandidate } from '../src/spread-inference';
import type { OpponentTeamInfo, PokemonEvs, RevealedPokemonInfo, DamageObservation } from '../src/types';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { calculate, Field, Move } from '@smogon/calc';
import { parseReplayLogWithObservations } from '../src/protocol-parser';
import { buildCalcPokemon } from '../src/calc-build';
import { calcGenerationFor } from '../src/calc-gen';
import { buildSolveContext, observationError } from '../src/spreads/fit';
import { judgeItemsByDamage } from '../src/team/item-damage';
import { parsePastedTeam, type PastedSet } from '../src/team-paste';
import { fixtureTexts, GENERATIONS, generatedTeams, withCorners } from './team-text-sources';

/**
 * The Heavy-Duty Boots guess: a Pokémon that enters on Stealth Rock without damage shows Boots only while no ability it may have
 * keeps the rock damage off. The inference asks the simulator, as the build does, so the panel shows no guess the build refuses, and
 * the guess cannot reach the build through the usage fallback or as the replacement after a rule-out. Logs come from @pkmn/sim.
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

describe('no Boots guess while an ability the Pokémon may have keeps the rocks off', () => {
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
    // Brave Bird leaves the Clefable below full HP and no Leftovers heal shows: the Leftovers set gives way.
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
 * Draft leagues play their games as custom games under the usual abilities, so a custom game keeps each species to its own
 * abilities. Noivern (Frisk, Infiltrator, Telepathy) can never have Magic Guard, and an entry on Stealth Rock without damage reads
 * as Heavy-Duty Boots there too (the GPL report's Noivern).
 */
describe('a custom game keeps each species to its own abilities', () => {
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

const evs = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number): PokemonEvs => ({ hp, atk, def, spa, spd, spe });
const SET_DETAIL = 'Smogon sets gen9ou';
const guess = evs(0, 252, 0, 0, 4, 252);

const tyranitar = (overrides: Partial<RevealedPokemonInfo> = {}): RevealedPokemonInfo => ({
  species: 'Tyranitar', moves: [], ability: { value: '', source: 'unknown' }, item: { value: '', source: 'unknown' },
  teraType: { value: '', source: 'unknown' }, level: 100, gender: '',
  evs: guessedEvs({ ...guess }, undefined, SET_DETAIL), nature: guessedField('Adamant', undefined, SET_DETAIL),
  ...overrides,
});
const info = (pokemon: RevealedPokemonInfo): OpponentTeamInfo => ({ pokemon: [pokemon] });
const apply = (candidate: SpreadCandidate, pokemon = tyranitar()) =>
  applyInferredSpreads(info(pokemon), 'p2', new Map([['p2:tyranitar', candidate]])).pokemon[0];

describe('the label of an applied spread', () => {
  test.each(['damage', 'order', 'hp', 'prior'] as const)('a candidate with the guess\'s EVs and nature keeps the guess\'s label (%s)', origin => {
    const mon = apply({ evs: { ...guess }, nature: 'Adamant', origin });
    expect(mon.evs.sourceDetail).toBe(SET_DETAIL);
    expect(mon.nature?.sourceDetail).toBe(SET_DETAIL);
  });

  test('changed EVs carry the label of their origin', () => {
    const changed = evs(0, 252, 0, 0, 4, 0);
    expect(apply({ evs: changed, nature: 'Adamant', origin: 'damage' }).evs.sourceDetail).toBe(INFERRED_SPREAD_DETAIL);
    expect(apply({ evs: changed, nature: 'Adamant', origin: 'order' }).evs.sourceDetail).toBe(ORDER_SPREAD_DETAIL);
    expect(apply({ evs: changed, nature: 'Adamant', origin: 'hp' }).evs.sourceDetail).toBe(MEASURED_HP_SPREAD_DETAIL);
    // An entry no evidence solved shows its numbers with the label of the guess they come from.
    const prior = apply({ evs: changed, nature: 'Adamant', origin: 'prior' });
    expect(prior.evs.value).toEqual(changed);
    expect(prior.evs.sourceDetail).toBe(SET_DETAIL);
  });

  test('an entry from before the origin existed reads as fitted from damage', () => {
    expect(apply({ evs: evs(0, 252, 0, 0, 4, 0), nature: 'Adamant' }).evs.sourceDetail).toBe(INFERRED_SPREAD_DETAIL);
  });

  test('EVs and nature are judged apart', () => {
    const mon = apply({ evs: { ...guess }, nature: 'Jolly', origin: 'order' });
    expect(mon.evs.sourceDetail).toBe(SET_DETAIL);
    expect(mon.nature?.value).toBe('Jolly');
    expect(mon.nature?.sourceDetail).toBe(ORDER_SPREAD_DETAIL);
    const evsOnly = apply({ evs: evs(0, 252, 0, 0, 4, 0), nature: 'Adamant', origin: 'damage' });
    expect(evsOnly.evs.sourceDetail).toBe(INFERRED_SPREAD_DETAIL);
    expect(evsOnly.nature?.sourceDetail).toBe(SET_DETAIL);
  });

  test('a manual or revealed spread is never relabelled', () => {
    const manual = tyranitar({ evs: { value: { ...guess }, source: 'manual' }, nature: { value: 'Adamant', source: 'manual' } });
    const mon = apply({ evs: evs(0, 0, 0, 252, 0, 252), nature: 'Timid', origin: 'damage' }, manual);
    expect(mon.evs.source).toBe('manual');
    expect(mon.nature?.source).toBe('manual');
  });
});

describe('consumed-item', () => {
  const usage = (species: string, items: [string, number][]): PokemonUsageStats => ({
    species, rawCount: 1000, abilities: [], spreads: [], moves: [],
    items: items.map(([value, probability]) => ({ value, probability, sourceDetail: 'u' })),
  });
  const stats = (...entries: PokemonUsageStats[]): SmogonUsageStats => ({
    format: 'test', month: 'm', source: 's', pokemon: Object.fromEntries(entries.map(entry => [toId(entry.species), entry])),
  });

  /** 649664's shape: preview item markers, a Fighting move into Tyranitar, the berry eaten. */
  const singles = [
    '|player|p1|Alpha|', '|player|p2|Beta|', '|teamsize|p1|2', '|teamsize|p2|2', '|gen|6', '|tier|[Gen 6] OU',
    '|poke|p1|Tyranitar, F|item', '|poke|p1|Ferrothorn, F|item', '|poke|p2|Medicham, M|item', '|poke|p2|Latias, F|item', '|start',
    '|switch|p1a: Tyranitar|Tyranitar, F|404/404', '|switch|p2a: Medicham|Medicham, M|261/261',
    '|turn|1',
    '|move|p2a: Medicham|Drain Punch|p1a: Tyranitar', '|-enditem|p1a: Tyranitar|Chople Berry|[eat]',
    '|-enditem|p1a: Tyranitar|Chople Berry|[weaken]', '|-supereffective|p1a: Tyranitar', '|-damage|p1a: Tyranitar|250/404',
    '|move|p1a: Tyranitar|Crunch|p2a: Medicham', '|-damage|p2a: Medicham|150/261',
    '|turn|2',
  ].join('\n');

  const doubles = [
    '|player|p1|Alpha|', '|player|p2|Beta|', '|gametype|doubles', '|teamsize|p1|2', '|teamsize|p2|2', '|gen|7', '|tier|[Gen 7] Doubles OU',
    '|poke|p1|Tyranitar, F|item', '|poke|p1|Ferrothorn, F|item', '|poke|p2|Medicham, M|item', '|poke|p2|Latias, F|item', '|start',
    '|switch|p1a: Tyranitar|Tyranitar, F|100/100', '|switch|p1b: Ferrothorn|Ferrothorn, F|100/100',
    '|switch|p2a: Medicham|Medicham, M|100/100', '|switch|p2b: Latias|Latias, F|100/100',
    '|turn|1',
    '|move|p2a: Medicham|Drain Punch|p1a: Tyranitar', '|-enditem|p1a: Tyranitar|Chople Berry|[eat]',
    '|-enditem|p1a: Tyranitar|Chople Berry|[weaken]', '|-supereffective|p1a: Tyranitar', '|-damage|p1a: Tyranitar|62/100',
    '|turn|2',
  ].join('\n');

  const tyranitarUsage = stats(usage('Tyranitar', [['Tyranitarite', 0.5], ['Chople Berry', 0.2], ['Leftovers', 0.1]]));

  describe('a consumed item behind the preview marker', () => {
    test.each([['singles', singles], ['doubles', doubles]])('%s: the inference records the eaten Chople Berry, and panel and build play it, not Tyranitarite', (_, log) => {
      const raw = inferOpponentTeam(log, 'p1');
      expect(raw.pokemon.find(mon => mon.species === 'Tyranitar')!.item).toEqual({ value: 'Chople Berry (consumed)', source: 'revealed' });
      const p1Info = enrichTeamInfo(raw, tyranitarUsage, null);
      expect(p1Info.pokemon.find(mon => mon.species === 'Tyranitar')!.item.value).toBe('Chople Berry (consumed)');
      const team = buildTeamsFromReplay(log, { p1Info, usageStats: tyranitarUsage }).p1Team;
      expect(team.find(set => set.species === 'Tyranitar')!.item).toBe('Chople Berry');
    });
  });
});

const log = readFileSync(join(__dirname, 'fixtures', 'gen9natdexdraft-2713067801.txt'), 'utf-8');
const userEvs: PokemonEvs = { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 };
const solved = (nature: string): Map<string, SpreadCandidate> => new Map([[
  'p1:quaquaval', { evs: { hp: 140, atk: 112, def: 0, spa: 0, spd: 4, spe: 252 }, nature, origin: 'order' } as SpreadCandidate,
]]);

/** The reporter's edit: EVs typed in (manual), the nature the panel showed (guessed Jolly). */
function editedInfo(evsSource: 'manual' | 'revealed', nature: ReturnType<typeof guessedField> | undefined): OpponentTeamInfo {
  const info = inferOpponentTeam(log, 'p1');
  const mon = info.pokemon.find(pokemon => pokemon.species === 'Quaquaval')!;
  mon.evs = { value: { ...userEvs }, source: evsSource };
  if (nature) mon.nature = nature; else delete mon.nature;
  return info;
}
const quaquaval = (info: OpponentTeamInfo, spread: Map<string, SpreadCandidate>) =>
  buildTeamsFromReplay(log, { p1Info: info, inferredSpreads: spread }).p1Team.find(set => set.species === 'Quaquaval')!;

const speedOf = (set: { nature?: string; evs: PokemonEvs; ivs: PokemonEvs }) => {
  const nature = Dex.natures.get(set.nature ?? 'Hardy');
  const base = Math.floor((2 * 85 + set.ivs.spe + Math.floor(set.evs.spe / 4)) + 5);
  return Math.floor(nature.plus === 'spe' ? base * 1.1 : nature.minus === 'spe' ? base * 0.9 : base);
};

describe('a body with set EVs plays the nature its info shows', () => {
  test.each(['manual', 'revealed'] as const)('the solver\'s Hardy never replaces the shown Jolly (%s EVs)', source => {
    const set = quaquaval(editedInfo(source, guessedField('Jolly', undefined, 'fits observed damage')), solved('Hardy'));
    expect(set.nature).toBe('Jolly');
    expect(set.evs).toEqual(userEvs);
    // Cramorant plays Modest 252 Spe at 269: Quaquaval stays strictly ahead, as both turns of the log show.
    expect(speedOf(set as never)).toBe(295);
  });

  test('a nature the user typed still wins', () => {
    const set = quaquaval(editedInfo('manual', { value: 'Adamant', source: 'manual' }), solved('Hardy'));
    expect(set.nature).toBe('Adamant');
  });

  test('a body with no nature in its info keeps the solver\'s answer', () => {
    expect(quaquaval(editedInfo('manual', undefined), solved('Hardy')).nature).toBe('Hardy');
  });

  test('guessed EVs still take the solver\'s nature and EVs together', () => {
    const info = inferOpponentTeam(log, 'p1');
    const mon = info.pokemon.find(pokemon => pokemon.species === 'Quaquaval')!;
    mon.nature = guessedField('Jolly', undefined, 'fits observed damage');
    const set = quaquaval(info, solved('Hardy'));
    expect(set.nature).toBe('Hardy');
    expect(set.evs.hp).toBe(140);
  });
});

describe('logged-entry-stage', () => {
  type Kind = 'singles' | 'doubles';
  const FORMAT: Record<Kind, string> = { singles: 'gen9ou', doubles: 'gen9doublesou' };
  const MOVE: Record<Kind, string> = { singles: 'Earthquake', doubles: 'Stomping Tantrum' };
  const ALL_31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
  const sp = (spread: Partial<PokemonEvs>): PokemonEvs => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...spread });
  const set = (species: string, item: string, ability: string, moves: string[], nature: string, spread: Partial<PokemonEvs>): PokemonSet => ({
    name: species, species, item, ability, moves, nature, evs: sp(spread), ivs: { ...ALL_31 }, level: 100, gender: '',
  });
  const GARCHOMP_SPREAD = sp({ atk: 252, spe: 252 });
  const garchomp = (move: string) => set('Garchomp', '', 'Rough Skin', [move], 'Jolly', GARCHOMP_SPREAD);
  // No item: nothing heals Zamazenta between the hit and the end of the turn, so its HP loss is the hit.
  const zamazenta = () => set('Zamazenta', '', 'Dauntless Shield', ['Splash'], 'Jolly', {});
  const blissey = () => set('Blissey', '', 'Natural Cure', ['Protect'], 'Calm', { hp: 252 });

  interface Scene {
    log: string;
    damage: number;
    maxHp: number;
  }

  /** One turn: Garchomp (p1) hits Zamazenta (p2); null when the roll crit (the parser records no crit) or the simulator drew no hit. */
  function sceneOf(kind: Kind, seed: number): Scene | null {
    const doubles = kind === 'doubles';
    const battle = new Battle({
      formatid: toID(FORMAT[kind]), seed: [1, 2, 3, seed],
      p1: { name: 'Alpha', team: Teams.pack(doubles ? [garchomp(MOVE[kind]), blissey()] : [garchomp(MOVE[kind])]) },
      p2: { name: 'Beta', team: Teams.pack(doubles ? [zamazenta(), blissey()] : [zamazenta()]) },
    });
    if (battle.requestState === 'teampreview') {
      battle.choose('p1', 'default');
      battle.choose('p2', 'default');
    }
    const target = battle.p2.active[0];
    const maxHp = target.maxhp;
    battle.choose('p1', doubles ? `move ${toID(MOVE[kind])} 1, move protect` : `move ${toID(MOVE[kind])}`);
    battle.choose('p2', doubles ? 'move splash, move protect' : 'move splash');
    const lines = battle.log;
    const log = lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
    if (/\|-crit\|/.test(log) || target.hp >= maxHp) return null;
    return { log, damage: maxHp - target.hp, maxHp };
  }

  function scenesOf(kind: Kind, count: number): Scene[] {
    const scenes: Scene[] = [];
    for (let seed = 1; scenes.length < count && seed <= 200; seed++) {
      const scene = sceneOf(kind, seed);
      if (scene && !scenes.some(known => known.damage === scene.damage)) scenes.push(scene);
    }
    return scenes;
  }

  function hitObservation(log: string): DamageObservation {
    const { observations } = parseReplayLogWithObservations(log);
    const found = observations.filter(obs => obs.defenderSpecies === 'Zamazenta');
    expect(found).toHaveLength(1);
    return found[0];
  }

  /** The calculator's rolls of the hit for a defender carrying the given boosts, built as the solver builds it. */
  function rollsOf(defenderBoosts: Record<string, number>, kind: Kind): number[] {
    const gen = calcGenerationFor(9);
    const attacker = buildCalcPokemon(gen, 'Garchomp', { level: 100, ability: 'Rough Skin', nature: 'Jolly', evs: GARCHOMP_SPREAD, boosts: {} });
    const defender = buildCalcPokemon(gen, 'Zamazenta', { level: 100, ability: 'Dauntless Shield', nature: 'Jolly', evs: sp({}), boosts: defenderBoosts });
    const result = calculate(gen, attacker, defender, new Move(gen, MOVE[kind]), new Field({ gameType: kind === 'doubles' ? 'Doubles' : 'Singles' }));
    return (Array.isArray(result.damage) ? (result.damage as number[]).flat() : [Number(result.damage)]).map(Number);
  }

  const zamazentaInfo = (): RevealedPokemonInfo => ({
    species: 'Zamazenta', moves: [], ability: revealedField('Dauntless Shield'), item: revealedField(''), teraType: unknownField(),
    evs: guessedEvs(sp({})), nature: guessedField('Jolly'), level: 100, gender: '',
  });
  const teamsOf = () => ({ p1: { pokemon: [] as RevealedPokemonInfo[] }, p2: { pokemon: [zamazentaInfo()] } });

  describe('a Dauntless Shield stage the log shows is priced once', () => {
    for (const kind of ['singles', 'doubles'] as const) {
      test(`${kind}: the log shows the entry stage once`, () => {
        const scene = scenesOf(kind, 1)[0];
        expect(scene.log).toMatch(/\|-ability\|p2a: Zamazenta\|Dauntless Shield\|boost/);
        expect(scene.log.match(/\|-boost\|p2a: Zamazenta\|def\|/g)).toHaveLength(1);
        expect(scene.log).toMatch(/\|-boost\|p2a: Zamazenta\|def\|1/);
      });

      test(`${kind}: the calculator's rolls at the logged boosts contain the simulator's damage, a second stage does not`, () => {
        const scenes = scenesOf(kind, 6);
        expect(scenes.length).toBeGreaterThanOrEqual(4);
        for (const scene of scenes) {
          // The boosts the solver (singles observation) and the judge (the logged hit, both game types) hand the calculator.
          const hit = inferOpponentTeam(scene.log, 'p1').pokemon.find(mon => mon.species === 'Garchomp')?.hits?.[0];
          expect(hit?.defender.boosts).toEqual({ def: 1 });
          expect(hitObservation(scene.log).defenderBoosts).toEqual(hit?.defender.boosts);
          const once = rollsOf(hit!.defender.boosts, kind);
          expect(once).toContain(scene.damage);
          // The double count of calculator 0.11: Def +1 from the log plus the calculator's own +1.
          const twice = rollsOf({ def: 2 }, kind);
          expect(twice).not.toContain(scene.damage);
          expect(Math.max(...twice)).toBeLessThan(Math.min(...once));
        }
      });

      test(`${kind}: the item judge reads the hit at the logged stage and rules out no item that explains it`, () => {
        for (const scene of scenesOf(kind, 4)) {
          const attacker = inferOpponentTeam(scene.log, 'p1').pokemon.find(mon => mon.species === 'Garchomp');
          const hit = attacker?.hits?.[0];
          expect(hit?.defender.boosts).toEqual({ def: 1 });
          expect(hit?.doubles).toBe(kind === 'doubles');
          // Garchomp holds nothing: the hit is explained bare and by Leftovers, so the judge rules out none of the candidates.
          expect(judgeItemsByDamage(attacker!, ['Life Orb', 'Choice Band', 'Leftovers', 'Sitrus Berry'], teamsOf())).toEqual([]);
        }
      });
    }

    for (const kind of ['singles', 'doubles'] as const) {
      test(`${kind}: the solver reads the played spread of the hit with no error, one with the stage counted twice with some`, () => {
        for (const scene of scenesOf(kind, 4)) {
          const obs = hitObservation(scene.log);
          expect(obs.doubles).toBe(kind === 'doubles');
          expect(Math.abs(obs.observedFraction - scene.damage / scene.maxHp)).toBeLessThan(0.01);
          const sets = { p1: [garchomp(MOVE[kind])], p2: [zamazenta()] };
          const ctx = buildSolveContext([obs], sets, FORMAT[kind], []);
          expect(observationError(ctx, obs, 'p2:zamazenta', { evs: sp({}), nature: 'Jolly' })).toBe(0);
          // The same hit read as a defender with Def +2: what a double count makes of the played spread.
          const doubled: DamageObservation = { ...obs, defenderBoosts: { def: 2 } };
          expect(observationError(ctx, doubled, 'p2:zamazenta', { evs: sp({}), nature: 'Jolly' })).toBeGreaterThan(0);
        }
      });
    }
  });
});

const STAT_KEYS: Record<string, keyof PokemonEvs> = { hp: 'hp', atk: 'atk', def: 'def', spa: 'spa', spd: 'spd', spe: 'spe' };

function legacyStatLine(line: string, prefix: RegExp, base: PokemonEvs, max: number): PokemonEvs | undefined {
  const values: PokemonEvs = { ...base };
  let any = false;
  for (const part of line.replace(prefix, '').split('/')) {
    const match = part.trim().match(/^(\d+)\s+(HP|Atk|Def|SpA|SpD|Spe)$/i);
    if (!match) continue;
    const key = STAT_KEYS[match[2].toLowerCase()];
    if (!key) continue;
    values[key] = Math.min(max, Math.max(0, parseInt(match[1], 10)));
    any = true;
  }
  return any ? values : undefined;
}

function legacyHeader(header: string): { species: string; nickname?: string; item?: string } | null {
  const [nameSide, itemSide] = header.split('@').map(part => part.trim());
  if (!nameSide) return null;
  let working = nameSide.replace(/\s*\((M|F)\)\s*$/i, '').trim();
  let nickname: string | undefined;
  const nickMatch = working.match(/^(.*)\(([^()]+)\)\s*$/);
  if (nickMatch) {
    nickname = nickMatch[1].trim() || undefined;
    working = nickMatch[2].trim();
  }
  if (!working) return null;
  return { species: working, nickname, item: itemSide ? itemSetValue(itemSide) || undefined : undefined };
}

function legacyParsePastedTeam(teamText: string): PastedSet[] {
  const sets: PastedSet[] = [];
  for (const block of teamText.replace(/\r\n?/g, '\n').split(/\n\s*\n+/)) {
    const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    const moves = lines.filter(line => line.startsWith('- ')).map(line => line.slice(2).trim()).filter(Boolean);
    if (moves.length === 0) continue;
    const header = legacyHeader(lines[0]);
    if (!header) continue;
    const abilityLine = lines.find(line => /^Ability:/i.test(line));
    const teraLine = lines.find(line => /^Tera Type:/i.test(line));
    const evLine = lines.find(line => /^EVs:/i.test(line));
    const natureLine = lines.find(line => /^[A-Za-z]+\s+Nature$/i.test(line));
    const ivLine = lines.find(line => /^IVs:/i.test(line));
    const levelLine = lines.find(line => /^Level:\s*\d+$/i.test(line));
    sets.push({
      ...header,
      ability: abilityLine?.replace(/^Ability:/i, '').trim() || undefined,
      teraType: teraLine?.replace(/^Tera Type:/i, '').trim() || undefined,
      evs: evLine ? legacyStatLine(evLine, /^EVs:/i, EMPTY_EVS, 252) : undefined,
      nature: natureLine?.replace(/\s+Nature$/i, '').trim() || undefined,
      ivs: ivLine ? legacyStatLine(ivLine, /^IVs:/i, { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, 31) : undefined,
      level: levelLine ? parseInt(levelLine.replace(/^Level:/i, '').trim(), 10) : undefined,
      moves: moves.slice(0, 4),
    });
  }
  return sets;
}

/** F1: the hand parser's bracket form of a typed Hidden Power, in the library's (the Dex's) spelling. */
const dexSpelling = (sets: PastedSet[]): PastedSet[] =>
  sets.map(set => ({ ...set, moves: set.moves.map(move => move.replace(/^(Hidden Power) \[(\w+)\]$/, '$1 $2')) }));

const fixtures = fixtureTexts();

describe('parsePastedTeam reads like the hand parser did, through Teams.import', () => {
  const generated = new Map<number, PokemonSet[][]>();
  beforeAll(async () => {
    for (const gen of GENERATIONS) generated.set(gen, await generatedTeams(gen, 6));
  }, 120_000);

  test('the fixtures hold View-team exports', () => {
    expect(fixtures.exports.length).toBeGreaterThanOrEqual(1);
  });

  test.each(fixtures.exports.map((e, i) => [`${e.tag} #${i}`, e.text] as const))('replay export %s', (_tag, text) => {
    expect(parsePastedTeam(text)).toEqual(dexSpelling(legacyParsePastedTeam(text)));
  });

  test.each(GENERATIONS)('simulator-generated teams of generation %i, plain and with corner cases', (gen) => {
    const teams = generated.get(gen)!;
    expect(teams.length).toBeGreaterThanOrEqual(6);
    for (const team of teams) {
      for (const text of [Teams.export(team), Teams.export(withCorners(team))]) {
        const sets = legacyParsePastedTeam(text);
        expect(sets.length).toBeGreaterThan(0);
        expect(parsePastedTeam(text)).toEqual(dexSpelling(sets));
      }
    }
  });

  test('awkward pastes: clamps, empty lines, placeholders, five moves, a set without moves', () => {
    const pastes = [
      'Garchomp @ Loaded Dice\nAbility: Rough Skin\nLevel: 78\nTera Type: Steel\nEVs: 252 Atk / 4 SpD / 252 Spe\nJolly Nature\nIVs: 0 SpA / 29 Spe\n- Earthquake\n- Scale Shot\n- Swords Dance\n- Protect\n- Outrage',
      'Garchomp\nEVs: 300 HP / 0 Atk\nIVs: 40 Def\n- Earthquake',
      'Sneasler @ Heavy-Duty Boots (consumed)\n- Close Combat',
      'Sneasler @ (has item)\n- Close Combat',
      'Nick (Urshifu-Rapid-Strike) (F) @ Mystic Water\nAbility: Unseen Fist\n- Surging Strikes',
      'Gengar (M)\nEVs:\n- Shadow Ball',
      'Charizard-Mega-Y @ Charizardite Y\nAbility: Drought\n- Solar Beam\n\n\n\nTyranitar\n- Crunch',
      'Pikachu @ Light Ball\nAbility: Static',
      'Pikachu @ Light Ball\nAbility: Static\n\nRaichu\n- Thunderbolt',
      'asdf asdf',
      '',
    ];
    for (const text of pastes) expect(parsePastedTeam(text), text).toEqual(dexSpelling(legacyParsePastedTeam(text)));
  });

  test('Windows line endings read like Unix ones', () => {
    const text = Teams.export(generated.get(9)![0]);
    expect(parsePastedTeam(text.replace(/\n/g, '\r\n'))).toEqual(parsePastedTeam(text));
  });

  test('F1: a typed Hidden Power reads as the Dex names it', () => {
    const sets = parsePastedTeam('Starmie\n- Hidden Power [Fire]\n- Surf\n\nSalamence\n- Hidden Power Ice\n- Dragon Dance');
    expect(sets.map(set => set.moves[0])).toEqual(['Hidden Power Fire', 'Hidden Power Ice']);
  });

  test('an IVs line with no stat reads as the default spread', () => {
    expect(parsePastedTeam('Gengar\nIVs: x\n- Shadow Ball')[0].ivs).toEqual({ hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 });
  });

  test('a species the Dex does not know reads as its id', () => {
    expect(parsePastedTeam('Species Only (M)\n- Tackle').map(set => set.species)).toEqual(['speciesonly']);
  });
});
