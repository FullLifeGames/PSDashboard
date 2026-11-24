import { readFileSync } from 'node:fs';
import { test, expect, describe } from 'vitest';
import {
  rulesDex,
  parseReplayLogWithObservations,
  type SmogonUsageStats,
  buildTeamsFromReplay,
  getBranchSimulatorFormat,
  parseReplayLog,
  replayBringOnly,
  calcEvs,
  calcIvs,
  evBudget,
  type DamageObservation,
  type PokemonEvs,
} from '@fulllifegames/replay-core';
import {
  buildChoiceLockContext,
  buildChoiceLockTrails,
  corroborateChoiceItem,
  protocolChoiceLock,
  type ItemCorroboration,
} from '../src/choice-lock';
import { reconstructBranchRuntime } from '../src/branch-engine';
import { searchOptions } from '../src/search';
import { createRootPosition, serializeBattleStable } from '../src/forward-model';
import { Battle as LiveBattle, Teams, Battle, type PokemonSet, toID } from '@pkmn/sim';
import { collectForcedSwitchSpecies, getMainChoice, parseTurnBlocks } from '../src/branch/protocol-choices';
import { Field, Generations, Move, Pokemon, calculate } from '@smogon/calc';
import { loadSimMods } from '../src/forward/sim-mods';
import type { OpponentTeamInfo, RevealedPokemonInfo } from '@fulllifegames/replay-core';
import { battleOf } from './power-oracle';
import { set as moveSet } from './move-oracle';

const log = (lines: string[]) => lines.join('\n');

const set = (species: string, item: string, moves: string[]): PokemonSet => ({
  name: species, species, item, ability: 'No Ability', moves,
  nature: 'Hardy',
  evs: { hp: 0, atk: 252, def: 0, spa: 252, spd: 0, spe: 4 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  level: 100, gender: '',
});

describe('protocol choice-lock trails', () => {
  test('a single repeated move since entry locks; a second distinct move disproves', () => {
    const trails = buildChoiceLockTrails(log([
      '|switch|p1a: Keldeo|Keldeo|100/100',
      '|switch|p2a: Chansey|Chansey|100/100',
      '|turn|1',
      '|move|p1a: Keldeo|Hydro Pump|p2a: Chansey',
      '|turn|2',
      '|move|p1a: Keldeo|Hydro Pump|p2a: Chansey',
      '|turn|3',
      '|move|p1a: Keldeo|Secret Sword|p2a: Chansey',
      '|turn|4',
    ]));
    expect(protocolChoiceLock(trails, 'p1', 2, rulesDex(9))).toEqual({ species: 'Keldeo', moveId: 'hydropump' });
    expect(protocolChoiceLock(trails, 'p1', 3, rulesDex(9))).toEqual({ species: 'Keldeo', moveId: 'hydropump' });
    expect(protocolChoiceLock(trails, 'p1', 4, rulesDex(9))).toBeNull();
    expect(protocolChoiceLock(trails, 'p1', 1, rulesDex(9))).toBeNull();
    expect(protocolChoiceLock(trails, 'p2', 3, rulesDex(9))).toBeNull();
  });

  test('a re-entry resets the trail', () => {
    const trails = buildChoiceLockTrails(log([
      '|switch|p1a: Keldeo|Keldeo|100/100',
      '|turn|1',
      '|move|p1a: Keldeo|Hydro Pump|p2a: Chansey',
      '|turn|2',
      '|switch|p1a: Lando|Landorus-Therian|100/100',
      '|turn|3',
      '|switch|p1a: Keldeo|Keldeo|100/100',
      '|turn|4',
    ]));
    expect(protocolChoiceLock(trails, 'p1', 4, rulesDex(9))).toBeNull();
  });

  test('a Trick-handed Choice item locks the next move; any other item event disturbs the trail', () => {
    // The sim's Choice Scarf drops the old lock on arrival and locks the next move (items.ts onStart / onModifyMove).
    const trails = buildChoiceLockTrails(log([
      '|switch|p1a: Plume|Vileplume|100/100',
      '|turn|1',
      '|-item|p1a: Plume|Choice Scarf|[from] move: Trick',
      '|move|p1a: Plume|Sludge Bomb|p2a: Chansey',
      '|turn|2',
      '|-enditem|p1a: Plume|Choice Scarf|[from] move: Knock Off|[of] p2a: Chansey',
      '|turn|3',
    ]));
    expect(protocolChoiceLock(trails, 'p1', 2, rulesDex(9))).toEqual({ species: 'Vileplume', moveId: 'sludgebomb', handedOver: true });
    expect(protocolChoiceLock(trails, 'p1', 3, rulesDex(9))).toBeNull();
  });

  test('|cant| does not break the trail; |drag| counts as entry', () => {
    const trails = buildChoiceLockTrails(log([
      '|drag|p1a: Keldeo|Keldeo|100/100',
      '|turn|1',
      '|move|p1a: Keldeo|Hydro Pump|p2a: Chansey',
      '|turn|2',
      '|cant|p1a: Keldeo|par',
      '|turn|3',
    ]));
    expect(protocolChoiceLock(trails, 'p1', 3, rulesDex(9))).toEqual({ species: 'Keldeo', moveId: 'hydropump' });
  });
});

describe('choice-item damage corroboration', () => {
  // Bands measured (gen6, Keldeo Hydro Pump vs the shared spread on Mew, ±0.02 HP-bar slack): Specs 0.766-0.947,
  // Mystic Water 0.608-0.762, unboosted 0.502-0.639; disjoint, so each pinned fraction sits inside exactly one band.
  const teams = {
    p1Team: [set('Keldeo', 'Choice Specs', ['Hydro Pump'])],
    p2Team: [set('Mew', '', ['Protect'])],
  };
  const observation = (fraction: number) => [{
    attackerSpecies: 'Keldeo', defenderSpecies: 'Mew', attackerSide: 'p1' as const,
    moveId: 'hydropump', observedFraction: fraction, lethal: false,
    attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '',
  }];

  test('an observation only the ×1.5 boost explains corroborates', () => {
    expect(corroborateChoiceItem('p1', 'Keldeo', 'Choice Specs', teams, observation(0.85), 6)).toBe('corroborated');
  });

  test('an observation only the unboosted damage explains contradicts', () => {
    expect(corroborateChoiceItem('p1', 'Keldeo', 'Choice Specs', teams, observation(0.55), 6)).toBe('contradicted');
  });

  test('a knock-out reads as a lower bound: below the choice band it neither contradicts nor corroborates', () => {
    const lethal = observation(0.55).map(obs => ({ ...obs, lethal: true }));
    // 0.55 sits in the unboosted band; a KO at 0.55 only says "at least 0.55", which both hypotheses explain.
    expect(corroborateChoiceItem('p1', 'Keldeo', 'Choice Specs', teams, lethal, 6)).toBe('ambiguous');
  });

  test('a knock-out above the unboosted maximum still corroborates the choice item', () => {
    const lethal = observation(0.85).map(obs => ({ ...obs, lethal: true }));
    expect(corroborateChoiceItem('p1', 'Keldeo', 'Choice Specs', teams, lethal, 6)).toBe('corroborated');
  });

  test('no usable observations stays ambiguous (stamp proceeds on the guess)', () => {
    expect(corroborateChoiceItem('p1', 'Keldeo', 'Choice Specs', teams, [], 6)).toBe('ambiguous');
  });
});

describe('choice-lock context', () => {
  const contextLog = [
    '|player|p1|Alice|', '|player|p2|Bob|', '|gen|6', '|tier|[Gen 6] OU',
    '|poke|p1|Keldeo|', '|poke|p2|Chansey|',
    '|start',
    '|switch|p1a: Keldeo|Keldeo|100/100',
    '|switch|p2a: Chansey|Chansey|100/100',
    '|turn|1',
  ].join('\n');

  test('revealed choice items are eligible without corroboration; guessed ones consult damage', () => {
    const teams = {
      p1Team: [set('Keldeo', 'Choice Specs', ['Hydro Pump'])],
      p2Team: [set('Chansey', '', ['Protect'])],
    };
    const context = buildChoiceLockContext(contextLog, teams, []);
    expect(context.eligibility.p1['keldeo']).toBe(true);
    expect(context.eligibility.p2['chansey']).toBeFalsy();
    expect(context.trails.p1.get(1)).toBeTruthy();
  });

  test('a contradicted guessed choice item loses eligibility', () => {
    const teams = {
      p1Team: [set('Keldeo', 'Choice Specs', ['Hydro Pump'])],
      p2Team: [set('Mew', '', ['Protect'])],
    };
    const context = buildChoiceLockContext(contextLog, teams, [{
      attackerSpecies: 'Keldeo', defenderSpecies: 'Mew', attackerSide: 'p1',
      moveId: 'hydropump', observedFraction: 0.55, lethal: false,
      attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '',
    }]);
    expect(context.eligibility.p1['keldeo']).toBe(false);
  });
});

test('649664: after its t23 Hydro Pump, Keldeo @ Specs is a locked side (the corpus gap\'s mechanism)', { timeout: 240000 }, async () => {
  const replay = JSON.parse(readFileSync(new URL('./fixtures/smogtours-gen6ou-649664.json', import.meta.url), 'utf-8')) as {
    id: string; format: string; formatid?: string; players: string[]; log: string;
  };
  const { snapshots, observations, speedOrders } = parseReplayLogWithObservations(replay.log);
  const usageStats = JSON.parse(readFileSync(new URL('./fixtures/usage-gen6ou-649664.json', import.meta.url), 'utf-8')) as SmogonUsageStats;
  const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders, usageStats });
  const choiceLocks = buildChoiceLockContext(replay.log, { p1Team, p2Team }, observations);
  const runtime = await reconstructBranchRuntime({
    format: getBranchSimulatorFormat(replay),
    p1Team,
    p2Team,
    replayLog: replay.log,
    targetTurn: 24,
    snapshot: snapshots[Math.min(23, snapshots.length - 1)] ?? null,
    capturePositions: {
      snapshotFor: boundary => snapshots[Math.min(boundary - 1, snapshots.length - 1)] ?? null,
      onPosition: () => {},
    },
    choiceLocks,
  });
  const battle = runtime.battleStream.battle!;
  const root = createRootPosition(serializeBattleStable(battle));
  const keldeoSide = battle.sides[0].active[0]?.species.name === 'Keldeo' ? 'p1' as const
    : battle.sides[1].active[0]?.species.name === 'Keldeo' ? 'p2' as const : null;
  expect(keldeoSide).not.toBeNull();
  const moves = searchOptions(root, keldeoSide!).map(option => option.choice).filter(choice => choice.startsWith('move '));
  expect(moves).toEqual(['move hydropump']);
});

type Replay = { id: string; format: string; formatid?: string; players: string[]; log: string };
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf-8')) as Replay;

const mon = (species: string, item: string, ability: string, moves: string[], spe = 0): PokemonSet => ({
  name: species, species, item, ability, moves, nature: 'Serious', gender: '', level: 100,
  evs: { hp: 252, atk: 0, def: 4, spa: 0, spd: 0, spe }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
});

function make(format: string, p1: PokemonSet[], p2: PokemonSet[]): Battle {
  const battle = new LiveBattle({ formatid: format as never, seed: [1, 2, 3, 4], p1: { name: 'A', team: Teams.pack(p1) }, p2: { name: 'B', team: Teams.pack(p2) } });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
  }
  return battle;
}

function readTurn(format: string, p1: PokemonSet[], p2: PokemonSet[], choices: [string, string]) {
  const played = make(format, p1, p2);
  played.choose('p1', choices[0]);
  played.choose('p2', choices[1]);
  const lines = played.log.filter((line, index, all) => !line.startsWith('|split|') && !all[index - 1]?.startsWith('|split|'));
  return parseTurnBlocks(lines.join('\n')).turns.find(entry => entry.turn === 1)!.preUpkeep;
}

const landorus = (moves: string[]) => mon('Landorus-Therian', 'Leftovers', 'Intimidate', moves);
const taunter = mon('Landorus-Therian', 'Leftovers', 'Intimidate', ['Taunt', 'Stealth Rock'], 252);
const tauntTurn = ['|move|p2a: Landorus|Taunt|p1a: Landorus', '|-start|p1a: Landorus|move: Taunt', '|cant|p1a: Landorus|move: Taunt|Taunt'];

describe('a |cant| move the body lacks goes out as a move the same blocker stops', () => {
  test('singles: the body\'s status move stands in for the blocked Taunt', () => {
    const board = make('gen9customgame', [landorus(['U-turn', 'Earthquake', 'Stealth Rock', 'Stone Edge'])], [taunter]);
    expect(getMainChoice(tauntTurn, 'p1', board as never)).toBe('move 3');
  });

  test('singles: without a move of that category the slowest move stands in', () => {
    const board = make('gen9customgame', [landorus(['U-turn', 'Earthquake', 'Stone Edge'])], [taunter]);
    expect(getMainChoice(tauntTurn, 'p1', board as never)).toMatch(/^move [1-3]$/);
  });

  test('doubles: the partner keeps its protocol move; neither fragment is rejected', () => {
    const board = make('gen9doublescustomgame',
      [landorus(['U-turn', 'Earthquake', 'Stealth Rock', 'Stone Edge']), mon('Amoonguss', 'Leftovers', 'Regenerator', ['Spore', 'Protect'])],
      [taunter, mon('Chansey', 'Eviolite', 'Natural Cure', ['Soft-Boiled'])]);
    const events = [...tauntTurn, '|move|p1b: Amoonguss|Protect|p1b: Amoonguss'];
    expect(getMainChoice(events, 'p1', board as never)).toBe('move 3, move 2');
  });
});

describe('a |cant| with [of] names the blocker, not the slot\'s click', () => {
  test('singles: Bruxish\'s Dazzling stops Sucker Punch; Bruxish\'s own move is its choice', () => {
    const p1 = [mon('Bruxish', 'Leftovers', 'Dazzling', ['Psychic Fangs'])];
    const p2 = [mon('Kingambit', 'Leftovers', 'Defiant', ['Sucker Punch'], 252)];
    const events = readTurn('gen9customgame', p1, p2, ['move psychicfangs', 'move suckerpunch']);
    expect(events.some(line => line.startsWith('|cant|p1a: Bruxish|ability: Dazzling|Sucker Punch|[of]'))).toBe(true);
    expect(getMainChoice(events, 'p1', make('gen9customgame', p1, p2) as never)).toBe('move 1');
  });

  test('doubles: Farigiraf\'s Armor Tail stops Fake Out on its partner; Farigiraf\'s own move is its choice', () => {
    const p1 = [mon('Farigiraf', 'Leftovers', 'Armor Tail', ['Protect', 'Hyper Voice']), mon('Amoonguss', 'Leftovers', 'Regenerator', ['Spore'])];
    const p2 = [mon('Incineroar', 'Leftovers', 'Blaze', ['Fake Out'], 252), mon('Chansey', 'Eviolite', 'Natural Cure', ['Soft-Boiled'])];
    const events = readTurn('gen9doublescustomgame', p1, p2, ['move hypervoice, move spore 1', 'move fakeout 2, move softboiled']);
    expect(events.some(line => line.startsWith('|cant|p1a: Farigiraf|ability: Armor Tail|Fake Out|[of]'))).toBe(true);
    expect(getMainChoice(events, 'p1', make('gen9doublescustomgame', p1, p2) as never)).toBe('move 2, move 1 +1');
  });

  test('a blocker\'s |cant| line is no action of its slot: a later switch there stays the side\'s choice', () => {
    const events = ['|cant|p1a: Farigiraf|ability: Armor Tail|Fake Out|[of] p2a: Incineroar', '|switch|p1a: Corviknight|Corviknight|100/100'];
    expect(collectForcedSwitchSpecies(events, [], 'p1', rulesDex(9))).toEqual([]);
  });
});

describe('scene: 752301, Landorus\'s Taunt shows only in a |cant| line', () => {
  test('Landorus is taunted at boundary 2, Samurott enters untaunted at boundary 3, no choice is rejected', { timeout: 240000 }, async () => {
    const replay = fixture('smogtours-gen9ou-752301.json');
    const { snapshots, observations, speedOrders } = parseReplayLogWithObservations(replay.log);
    const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders });
    p1Team.find(set => set.species === 'Landorus-Therian')!.moves = ['U-turn', 'Earthquake', 'Stealth Rock', 'Stone Edge'];
    const snapshotFor = (turn: number) => snapshots[Math.min(turn - 1, snapshots.length - 1)] ?? null;
    const seen = new Map<number, { active: string; taunted: boolean }>();
    const runtime = await reconstructBranchRuntime({
      format: getBranchSimulatorFormat(replay), p1Team, p2Team, replayLog: replay.log,
      bringOnly: replayBringOnly(replay, parseReplayLog(replay.log)) ?? undefined,
      targetTurn: 4, snapshot: snapshotFor(4),
      choiceLocks: buildChoiceLockContext(replay.log, { p1Team, p2Team }, observations),
      capturePositions: {
        snapshotFor,
        onPosition: (turn, battle) => {
          const active = battle.sides[0].active[0]!;
          if (!seen.has(turn)) seen.set(turn, { active: active.species.name, taunted: 'taunt' in active.volatiles });
        },
      },
    });
    expect(runtime.choiceErrors.count).toBe(0);
    expect(seen.get(2)).toEqual({ active: 'Landorus-Therian', taunted: true });
    expect(seen.get(3)).toEqual({ active: 'Samurott-Hisui', taunted: false });
  });
});

describe('the inference books a |cant| move, so the rebuilt set holds it and the click is the shown move', () => {
  test('singles: a body whose set has the Taunt plays Taunt, not a stand-in', () => {
    const board = make('gen9customgame', [landorus(['Taunt', 'Earthquake', 'Stealth Rock', 'Stone Edge'])], [taunter]);
    expect(getMainChoice(tauntTurn, 'p1', board as never)).toBe('move 1');
  });

  test('doubles: the same click, beside the partner keeping its own move', () => {
    const board = make('gen9doublescustomgame',
      [landorus(['Taunt', 'Earthquake', 'Stealth Rock', 'Stone Edge']), mon('Amoonguss', 'Leftovers', 'Regenerator', ['Spore', 'Protect'])],
      [taunter, mon('Chansey', 'Eviolite', 'Natural Cure', ['Soft-Boiled'])]);
    const events = [...tauntTurn, '|move|p1b: Amoonguss|Protect|p1b: Amoonguss'];
    expect(getMainChoice(events, 'p1', board as never)).toBe('move 1 +1, move 2');
  });

  test('752301: the set built from the log has the Taunt of the cant line, and no choice is rejected without a hand-set move list', { timeout: 240000 }, async () => {
    const replay = fixture('smogtours-gen9ou-752301.json');
    const { snapshots, observations, speedOrders } = parseReplayLogWithObservations(replay.log);
    const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders });
    expect(p1Team.find(set => set.species === 'Landorus-Therian')!.moves).toContain('Taunt');
    const snapshotFor = (turn: number) => snapshots[Math.min(turn - 1, snapshots.length - 1)] ?? null;
    const seen = new Map<number, { active: string; taunted: boolean }>();
    const runtime = await reconstructBranchRuntime({
      format: getBranchSimulatorFormat(replay), p1Team, p2Team, replayLog: replay.log,
      bringOnly: replayBringOnly(replay, parseReplayLog(replay.log)) ?? undefined,
      targetTurn: 4, snapshot: snapshotFor(4),
      choiceLocks: buildChoiceLockContext(replay.log, { p1Team, p2Team }, observations),
      capturePositions: {
        snapshotFor,
        onPosition: (turn, battle) => {
          const active = battle.sides[0].active[0]!;
          if (!seen.has(turn)) seen.set(turn, { active: active.species.name, taunted: 'taunt' in active.volatiles });
        },
      },
    });
    expect(runtime.choiceErrors.count).toBe(0);
    expect(seen.get(2)).toEqual({ active: 'Landorus-Therian', taunted: true });
    expect(seen.get(3)).toEqual({ active: 'Samurott-Hisui', taunted: false });
  });
});

const ALL_31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const gengar: PokemonSet = {
  name: 'Gengar', species: 'Gengar', item: 'Life Orb', ability: 'Cursed Body', moves: ['Shadow Claw'], nature: 'Adamant',
  gender: '', level: 50, evs: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 }, ivs: ALL_31,
};
const alakazam: PokemonSet = {
  name: 'Alakazam', species: 'Alakazam', item: '', ability: 'Magic Guard', moves: ['Psychic'], nature: 'Timid',
  gender: '', level: 50, evs: { hp: 0, atk: 0, def: 0, spa: 32, spd: 2, spe: 32 }, ivs: ALL_31,
};

function bandedFraction(): number {
  const gen = Generations.get(9);
  const budget = evBudget('gen9championsou');
  const body = (set: PokemonSet) => new Pokemon(gen, set.species, {
    level: 50, item: (set.item || undefined) as never, nature: set.nature as never,
    evs: calcEvs(set.evs as PokemonEvs, budget), ivs: calcIvs(set.ivs as PokemonEvs, budget),
  });
  const defender = body(alakazam);
  const rolls = calculate(gen, body(gengar), defender, new Move(gen, 'Shadow Claw'), new Field()).damage as number[];
  return rolls[15] / defender.maxHP();
}

const observations = (): DamageObservation[] => [{
  attackerSpecies: 'Gengar', defenderSpecies: 'Alakazam', attackerSide: 'p1', moveId: 'shadowclaw',
  observedFraction: bandedFraction(), lethal: false, attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '',
}];

// The Champions mod changes moves calc 0.11 still prices at Gen 9 values: Psyshield Bash hits at 90 there, not 70.
await loadSimMods('gen9championsou');
const wyrdeer: PokemonSet = {
  name: 'Wyrdeer', species: 'Wyrdeer', item: 'Life Orb', ability: 'Intimidate', moves: ['Psyshield Bash'], nature: 'Adamant',
  gender: '', level: 50, evs: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 }, ivs: ALL_31,
};
const garchomp: PokemonSet = {
  name: 'Garchomp', species: 'Garchomp', item: '', ability: 'Rough Skin', moves: ['Earthquake'], nature: 'Impish',
  gender: '', level: 50, evs: { hp: 32, atk: 0, def: 32, spa: 0, spd: 2, spe: 0 }, ivs: ALL_31,
};

function bashFraction(): number {
  const gen = Generations.get(9);
  const budget = evBudget('gen9championsou');
  const body = (set: PokemonSet) => new Pokemon(gen, set.species, {
    level: 50, item: (set.item || undefined) as never, nature: set.nature as never,
    evs: calcEvs(set.evs as PokemonEvs, budget), ivs: calcIvs(set.ivs as PokemonEvs, budget),
  });
  const defender = body(garchomp);
  const move = new Move(gen, 'Psyshield Bash', { overrides: { basePower: 90 } });
  const rolls = calculate(gen, body(wyrdeer), defender, move, new Field()).damage as number[];
  return rolls[15] / defender.maxHP();
}

describe('Choice item check on a Champions game', () => {
  test('a banded hit with a move the mod changes is judged at the power of the mod', () => {
    const observation: DamageObservation[] = [{
      attackerSpecies: 'Wyrdeer', defenderSpecies: 'Garchomp', attackerSide: 'p1', moveId: 'psyshieldbash',
      observedFraction: bashFraction(), lethal: false, attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '',
    }];
    expect(corroborateChoiceItem('p1', 'Wyrdeer', 'Life Orb', { p1Team: [wyrdeer], p2Team: [garchomp] }, observation, 9, 'champions'))
      .toBe('corroborated');
  });

  test('a guessed Life Orb on Stat Points is judged as the server rolls it', () => {
    expect(corroborateChoiceItem('p1', 'Gengar', 'Life Orb', { p1Team: [gengar], p2Team: [alakazam] }, observations(), 9, 'champions'))
      .toBe('corroborated');
  });

  test('outside Champions the same spread reads as EVs', () => {
    expect(corroborateChoiceItem('p1', 'Gengar', 'Life Orb', { p1Team: [gengar], p2Team: [alakazam] }, observations(), 9))
      .not.toBe('corroborated');
  });
});

describe('choice-lock-defender-item', () => {
  const set = moveSet;
  interface Scene { attacker: () => PokemonSet; move: string; defender: (item: string) => PokemonSet; bulkItem: string; choice: string }
  const SCENES: Record<string, Scene> = {
    'Choice Specs into Assault Vest': {
      attacker: () => set('Latios', ['psychic', 'splash'], { item: 'Choice Specs', ability: 'Levitate' }),
      move: 'psychic', bulkItem: 'Assault Vest', choice: 'Choice Specs',
      defender: item => set('Corviknight', ['tackle'], { item, ability: 'Pressure' }),
    },
    'Choice Band into Eviolite': {
      attacker: () => set('Garchomp', ['dragonclaw', 'splash'], { item: 'Choice Band', ability: 'Sand Veil' }),
      move: 'dragonclaw', bulkItem: 'Eviolite', choice: 'Choice Band',
      defender: item => set('Dusclops', ['tackle'], { item, ability: 'Pressure' }),
    },
  };

  function hitFraction(format: string, scene: Scene, item: string): number {
    const doubles = format.includes('doubles');
    const partner = () => set('Blissey', ['splash'], { ability: 'Natural Cure' });
    const battle = battleOf(format, doubles ? [scene.attacker(), partner()] : [scene.attacker()],
      doubles ? [scene.defender(item), partner()] : [scene.defender(item)]);
    const target = battle.sides[1].active[0];
    const before = target.hp;
    battle.makeChoices(doubles ? `move ${scene.move} 1, move splash` : `move ${scene.move}`, doubles ? 'move tackle 1, move splash' : 'move tackle');
    expect(battle.log.join('\n')).not.toMatch(/\|-crit\|/);
    expect(before).toBe(target.maxhp);
    return (before - target.hp) / target.maxhp;
  }

  const observation = (scene: Scene, fraction: number) => [{
    attackerSpecies: scene.attacker().species, defenderSpecies: scene.defender('').species, attackerSide: 'p1' as const,
    moveId: scene.move, observedFraction: fraction, lethal: false,
    attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '',
  }];

  function defenderInfo(scene: Scene, item: { value: string; source: 'revealed' | 'guessed' | 'unknown' }, ruledOut: string[] = []): Record<'p1' | 'p2', OpponentTeamInfo> {
    const field = (value: string, source: string) => ({ value, source, probability: 1 }) as RevealedPokemonInfo['item'];
    const mon = {
      species: scene.defender('').species, moves: [], ability: field('', 'unknown'), item: field(item.value, item.source), teraType: field('', 'unknown'),
      evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, level: 100, gender: '', ruledOut: { abilities: [], items: ruledOut },
    } as unknown as RevealedPokemonInfo;
    return { p1: { pokemon: [] }, p2: { pokemon: [mon] } };
  }

  describe('the defender of the Choice item check has an item range', () => {
    for (const format of ['gen9customgame', 'gen9doublescustomgame']) {
      const kind = format.includes('doubles') ? 'doubles' : 'singles';
      for (const [name, scene] of Object.entries(SCENES)) {
        const check = (defender: PokemonSet, defenders?: Record<'p1' | 'p2', OpponentTeamInfo>) => corroborateChoiceItem(
          'p1', scene.attacker().species, scene.choice, { p1Team: [scene.attacker()], p2Team: [defender] },
          observation(scene, hitFraction(format, scene, scene.bulkItem)), 9, undefined, defenders);

        test(`${kind}: ${name}, a defender built with the bulk item leaves the Choice item standing (ambiguous, not contradicted)`, () => {
          expect(hitFraction(format, scene, scene.bulkItem)).toBeGreaterThan(0.05);
          expect(check(scene.defender(scene.bulkItem))).toBe('ambiguous');
        });

        test(`${kind}: ${name}, a defender built with no item keeps the item-less reading`, () => {
          expect(check(scene.defender(''))).toBe('contradicted');
        });

        test(`${kind}: ${name}, the item the log showed is the only one the defender gets`, () => {
          const shownBulk = defenderInfo(scene, { value: scene.bulkItem, source: 'revealed' });
          expect(check(scene.defender('Leftovers'), shownBulk)).toBe('corroborated');
          const shownOther = defenderInfo(scene, { value: 'Leftovers', source: 'revealed' });
          expect(check(scene.defender(scene.bulkItem), shownOther)).toBe('contradicted');
        });

        test(`${kind}: ${name}, an item the log ruled out leaves the range`, () => {
          const ruled = defenderInfo(scene, { value: '', source: 'unknown' }, [scene.bulkItem.toLowerCase().replace(/ /g, '')]);
          expect(check(scene.defender(scene.bulkItem), ruled)).toBe('contradicted');
          const open = defenderInfo(scene, { value: '', source: 'unknown' });
          expect(check(scene.defender(scene.bulkItem), open)).toBe('ambiguous');
        });
      }
    }
  });
});

describe('choice-lock-hit-field', () => {
  const mon = (species: string, item: string, ability: string, moves: string[], extra: Partial<PokemonSet> = {}): PokemonSet => ({
    name: species, species, item, ability, moves, nature: 'Hardy', gender: '', level: 100,
    evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, ...extra,
  });
  const BLISSEY = () => mon('Blissey', '', 'Natural Cure', ['Splash'], { evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 252, spe: 0 } });

  function turnOf(format: string, attacker: PokemonSet, defender: PokemonSet, move: string, setup: string[] = [], seed = 4): string {
    const battle = new Battle({ formatid: toID(format) as never, seed: [1, 2, 3, seed], p1: { name: 'Alpha', team: Teams.pack([attacker]) }, p2: { name: 'Beta', team: Teams.pack([defender]) } });
    battle.choose('p1', 'team 1');
    battle.choose('p2', 'team 1');
    for (const click of setup) {
      expect(battle.choose('p1', 'move splash')).toBe(true);
      expect(battle.choose('p2', click)).toBe(true);
    }
    expect(battle.choose('p1', move)).toBe(true);
    expect(battle.choose('p2', 'move splash')).toBe(true);
    const lines = battle.log;
    return lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
  }

  function verdict(guess: string, truth: string, make: (item: string) => PokemonSet, defender: PokemonSet, move: string): ItemCorroboration {
    const log = turnOf('gen9customgame', make(truth), defender, move);
    const observations = parseReplayLogWithObservations(log).observations.filter(obs => obs.attackerSide === 'p1');
    expect(observations).toHaveLength(1);
    const built = make(guess);
    return corroborateChoiceItem('p1', built.species, guess, { p1Team: [built], p2Team: [defender] }, observations, 9);
  }

  describe('singles: the verdict follows the item the body really held', () => {
    // Rain doubles the water move by half, as Choice Specs do.
    const politoed = (item: string) => mon('Politoed', item, 'Drizzle', ['Surf', 'Splash'], { nature: 'Modest', evs: { hp: 252, atk: 0, def: 0, spa: 252, spd: 0, spe: 0 } });

    test('weather: Choice Specs corroborated when held, contradicted when the rain alone did it', () => {
      expect(verdict('Choice Specs', 'Choice Specs', politoed, BLISSEY(), 'move surf')).toBe('corroborated');
      expect(verdict('Choice Specs', '', politoed, BLISSEY(), 'move surf')).toBe('contradicted');
    });

    // Great Tusk's Protosynthesis in sun lifts Attack by 30 percent, a Choice Band's 1.5 reads like it.
    const tusk = (item: string) => mon('Great Tusk', item, 'Protosynthesis', ['Close Combat', 'Splash'], { nature: 'Adamant', evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 0, spe: 0 } });
    const TORKOAL = mon('Torkoal', '', 'Drought', ['Splash'], { evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 0, spe: 0 } });
    function sunVerdict(truth: string): ItemCorroboration {
      const log = turnOf('gen9customgame', tusk(truth), TORKOAL, 'move closecombat');
      const observations = parseReplayLogWithObservations(log).observations.filter(obs => obs.attackerSide === 'p1');
      expect(observations[0].attackerParadox?.stat).toBe('atk');
      return corroborateChoiceItem('p1', 'Great Tusk', 'Choice Band', { p1Team: [tusk('Choice Band')], p2Team: [TORKOAL] }, observations, 9);
    }

    test('Paradox stat: Choice Band corroborated when held, contradicted when the Protosynthesis alone did it', () => {
      expect(sunVerdict('Choice Band')).toBe('corroborated');
      expect(sunVerdict('')).toBe('contradicted');
    });

    // A Terastallized Gengar hits with the doubled same-type bonus.
    const gengar = (item: string) => mon('Gengar', item, 'Cursed Body', ['Shadow Ball', 'Splash'], { teraType: 'Ghost', level: 60, nature: 'Modest', evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 0, spe: 0 } });
    const CLEFABLE = mon('Clefable', '', 'Unaware', ['Splash']);
    // Specs and Spell Tag (1.5 against 1.2) overlap at the slack's extreme rolls; the seed gives a middle roll.
    const TERA_SEED = 2;
    function teraVerdict(truth: string): ItemCorroboration {
      const log = turnOf('gen9customgame', gengar(truth), CLEFABLE, 'move shadowball terastallize', [], TERA_SEED);
      const observations = parseReplayLogWithObservations(log).observations.filter(obs => obs.attackerSide === 'p1');
      expect(observations[0].attackerTera).toBe('Ghost');
      return corroborateChoiceItem('p1', 'Gengar', 'Choice Specs', { p1Team: [gengar('Choice Specs')], p2Team: [CLEFABLE] }, observations, 9);
    }

    test('Terastallization: Choice Specs corroborated when held, contradicted when the Tera bonus alone did it', () => {
      expect(teraVerdict('Choice Specs')).toBe('corroborated');
      expect(teraVerdict('')).toBe('contradicted');
    });
  });

  describe('doubles: hits bypass the check', () => {
    test('a doubles hit gives no verdict, whatever the item (the guard stays until the check prices the doubles field)', () => {
      const doublesLog = (item: string) => {
        const attacker = mon('Politoed', item, 'Drizzle', ['Surf', 'Splash'], { nature: 'Modest', evs: { hp: 252, atk: 0, def: 0, spa: 252, spd: 0, spe: 0 } });
        const teams = { p1: [attacker, BLISSEY()], p2: [BLISSEY(), mon('Chansey', '', 'Natural Cure', ['Splash'])] };
        const battle = new Battle({ formatid: toID('gen9doublescustomgame') as never, seed: [1, 2, 3, 4], p1: { name: 'Alpha', team: Teams.pack(teams.p1) }, p2: { name: 'Beta', team: Teams.pack(teams.p2) } });
        battle.choose('p1', 'team 12');
        battle.choose('p2', 'team 12');
        expect(battle.choose('p1', 'move surf, move splash')).toBe(true);
        expect(battle.choose('p2', 'move splash, move splash')).toBe(true);
        const lines = battle.log;
        return { log: lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n'), attacker };
      };
      const { log, attacker } = doublesLog('');
      const observations = parseReplayLogWithObservations(log).observations.filter(obs => obs.attackerSide === 'p1' && obs.attackerSpecies === 'Politoed');
      expect(observations.length).toBeGreaterThan(0);
      expect(observations.every(obs => obs.doubles)).toBe(true);
      const guessed = { ...attacker, item: 'Choice Specs' };
      expect(corroborateChoiceItem('p1', 'Politoed', 'Choice Specs', { p1Team: [guessed], p2Team: [BLISSEY()] }, observations, 9)).toBe('ambiguous');
    });
  });
});
