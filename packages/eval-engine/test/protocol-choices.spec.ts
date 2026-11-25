import { readFileSync } from 'node:fs';
import { test, expect, describe } from 'vitest';
import { Battle as LiveBattle, Teams, type Battle, type PokemonSet, toID } from '@pkmn/sim';
import {
  buildTeamsFromReplay,
  getBranchSimulatorFormat,
  parseReplayLog,
  parseReplayLogWithObservations,
  replayBringOnly,
  rulesDex,
} from '@fulllifegames/replay-core';
import { buildChoiceLockContext } from '../src/choice-lock';
import { reconstructBranchRuntime } from '../src/branch-engine';
import { collectForcedSwitchSpecies, getMainChoice, parseTurnBlocks } from '../src/branch/protocol-choices';

// The simulator writes `[from]` on a switch only for a move's selfSwitch; an item's switch (Eject Pack, Eject Button)
// follows its `|-enditem|` on the slot, so the forced list takes it from there.

type Replay = { id: string; format: string; formatid?: string; players: string[]; log: string };
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf-8')) as Replay;
const block = (replay: Replay, turn: number) => parseTurnBlocks(replay.log).turns.find(entry => entry.turn === turn)!;

describe('the forced list reads the switch an item made', () => {
  test('an Eject Pack or Eject Button switch-in joins the forced list', () => {
    const singles = block(fixture('smogtours-gen9ou-751407.json'), 1);
    expect(collectForcedSwitchSpecies(singles.preUpkeep, singles.postUpkeep, 'p2', rulesDex(9))).toEqual(['Dragonite']);
    const doubles = block(fixture('gen9vgc2026regi-2630181744.json'), 3);
    expect(collectForcedSwitchSpecies(doubles.preUpkeep, doubles.postUpkeep, 'p2', rulesDex(9)))
      .toEqual(['Ninetales-Alola', 'Sinistcha-Masterpiece']);
  });

  test('a chosen switch after an Intimidate drop or a berry stays the side\'s choice', () => {
    const intimidated = [
      '|switch|p1a: Landorus|Landorus-Therian, M|100/100',
      '|-ability|p1a: Landorus|Intimidate|boost',
      '|-unboost|p2a: Hatterene|atk|1',
      '|switch|p2a: Ting-Lu|Ting-Lu|100/100',
    ];
    expect(collectForcedSwitchSpecies(intimidated, [], 'p2', rulesDex(9))).toEqual([]);
    const berry = [
      '|move|p2a: Weavile|Pursuit|p1a: Latias|[from]Pursuit',
      '|-damage|p1a: Latias|40/100',
      '|-enditem|p1a: Latias|Sitrus Berry|[eat]',
      '|-heal|p1a: Latias|65/100|[from] item: Sitrus Berry',
      '|switch|p1a: Ferrothorn|Ferrothorn|100/100',
    ];
    expect(collectForcedSwitchSpecies(berry, [], 'p1', rulesDex(9))).toEqual([]);
  });
});

// An ejection asks for the replacement, so the sim writes the request break (`|`) between the item line and the switch;
// a Pursuit that pops the Air Balloon of a body on its way out writes the switch right after the item line.
describe('the simulator\'s own logs: ejection against a Pursuit-time balloon pop', () => {
  const mon = (species: string, item: string, ability: string, moves: string[], spe = 0): PokemonSet => ({
    name: species, species, item, ability, moves, nature: 'Serious', gender: '', level: 100,
    evs: { hp: 252, atk: 0, def: 4, spa: 0, spd: 0, spe }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  });
  const make = (format: string, p1: PokemonSet[], p2: PokemonSet[]) => {
    const battle = new LiveBattle({ formatid: format as never, seed: [1, 2, 3, 4], p1: { name: 'A', team: Teams.pack(p1) }, p2: { name: 'B', team: Teams.pack(p2) } });
    if (battle.sides.some(side => side.requestState === 'teampreview')) {
      battle.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
      battle.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
    }
    return battle;
  };
  const readTurn = (format: string, p1: PokemonSet[], p2: PokemonSet[], choices: [string, string], forcedAnswer?: string) => {
    const played = make(format, p1, p2);
    played.choose('p1', choices[0]);
    played.choose('p2', choices[1]);
    if (forcedAnswer && played.sides[0].requestState === 'switch') played.choose('p1', forcedAnswer);
    const lines = played.log.filter((line, index, all) => !line.startsWith('|split|') && !all[index - 1]?.startsWith('|split|'));
    const turn = parseTurnBlocks(lines.join('\n')).turns.find(entry => entry.turn === 1)!;
    return {
      forced: collectForcedSwitchSpecies(turn.preUpkeep, turn.postUpkeep, 'p1', rulesDex(9)),
      main: getMainChoice(turn.preUpkeep, 'p1', make(format, p1, p2) as never),
    };
  };
  const heatran = mon('Heatran', 'Air Balloon', 'Flash Fire', ['Lava Plume']);
  const pursuer = mon('Tyranitar', 'Leftovers', 'Sand Stream', ['Pursuit'], 252);

  test.each([5, 6, 7])('gen %i: a Pursuit that pops a switching Air Balloon holder leaves the switch the side\'s choice', gen => {
    const singles = readTurn(`gen${gen}customgame`, [heatran, mon('Snorlax', 'Leftovers', 'Thick Fat', ['Body Slam'])], [pursuer], ['switch 2', 'move pursuit']);
    expect(singles).toEqual({ forced: [], main: 'switch 2' });
    const doubles = readTurn(`gen${gen}doublescustomgame`,
      [heatran, mon('Blissey', 'Leftovers', 'Natural Cure', ['Soft-Boiled']), mon('Snorlax', 'Leftovers', 'Thick Fat', ['Body Slam'])],
      [pursuer, mon('Chansey', 'Eviolite', 'Natural Cure', ['Soft-Boiled'])],
      ['switch 3, move softboiled', 'move pursuit 1, move softboiled']);
    expect(doubles).toEqual({ forced: [], main: 'switch 3, move 1' });
  });

  test.each([5, 6, 7, 8, 9])('gen %i: an Eject Button switch is the answer to the item\'s request', gen => {
    const ejected = readTurn(`gen${gen}customgame`,
      [mon('Snorlax', 'Eject Button', 'Thick Fat', ['Body Slam']), mon('Blissey', 'Leftovers', 'Natural Cure', ['Soft-Boiled'])],
      [mon('Tyranitar', 'Leftovers', 'Sand Stream', ['Crunch'], 252)], ['move bodyslam', 'move crunch'], 'switch 2');
    expect(ejected).toEqual({ forced: ['Blissey'], main: 'move 1' });
  });

  test.each([8, 9])('gen %i: an Eject Pack switch after a self-drop or an Intimidate is the answer to the item\'s request; doubles Eject Button too', gen => {
    const team = [mon('Snorlax', 'Eject Pack', 'Thick Fat', ['Superpower', 'Body Slam'], 252), mon('Blissey', 'Leftovers', 'Natural Cure', ['Soft-Boiled'])];
    const tyranitar = mon('Tyranitar', 'Leftovers', 'Sand Stream', ['Crunch']);
    expect(readTurn(`gen${gen}customgame`, team, [tyranitar], ['move superpower', 'move crunch'], 'switch 2'))
      .toEqual({ forced: ['Blissey'], main: 'move 1' });
    const slowTeam = [mon('Snorlax', 'Eject Pack', 'Thick Fat', ['Body Slam']), team[1]];
    expect(readTurn(`gen${gen}customgame`, slowTeam, [tyranitar, mon('Incineroar', 'Leftovers', 'Intimidate', ['Flare Blitz'])], ['move bodyslam', 'switch 2'], 'switch 2'))
      .toEqual({ forced: ['Blissey'], main: 'move 1' });
    const doubles = readTurn(`gen${gen}doublescustomgame`,
      [mon('Snorlax', 'Eject Button', 'Thick Fat', ['Body Slam']), mon('Blissey', 'Leftovers', 'Natural Cure', ['Soft-Boiled']), mon('Chansey', 'Eviolite', 'Natural Cure', ['Soft-Boiled'])],
      [mon('Tyranitar', 'Leftovers', 'Sand Stream', ['Crunch'], 252), mon('Happiny', 'Eviolite', 'Natural Cure', ['Soft-Boiled'])],
      ['move bodyslam 1, move softboiled', 'move crunch 1, move softboiled'], 'switch 3, pass');
    expect(doubles).toEqual({ forced: ['Chansey'], main: 'move 1 +1, move 1' });
  });
});

function simBlock(battle: Battle, boundary: number): string[] {
  const log = battle.log;
  const end = log.lastIndexOf(`|turn|${boundary}`);
  const start = log.lastIndexOf(`|turn|${boundary - 1}`, end);
  return log.slice(start + 1, end).filter((line, index, all) => !line.startsWith('|split|') && !all[index - 1]?.startsWith('|split|'));
}

function switchAfterItem(lines: string[], slot: string, item: string): string | null {
  const itemIndex = lines.findIndex(line => line.startsWith(`|-enditem|${slot}:`) && line.split('|')[3] === item);
  if (itemIndex < 0) return null;
  const switchLine = lines.slice(itemIndex).find(line => line.startsWith(`|switch|${slot}:`));
  return switchLine?.split('|')[3].split(',')[0].trim() ?? null;
}

async function boundaries<T>(replay: Replay, p1Team: PokemonSet[], p2Team: PokemonSet[], turns: number[], read: (battle: Battle) => T) {
  const { snapshots, observations } = parseReplayLogWithObservations(replay.log);
  const snapshotFor = (turn: number) => snapshots[Math.min(turn - 1, snapshots.length - 1)] ?? null;
  const seen = new Map<number, T>();
  const targetTurn = Math.max(...turns) + 1;
  const runtime = await reconstructBranchRuntime({
    format: getBranchSimulatorFormat(replay), p1Team, p2Team, replayLog: replay.log,
    bringOnly: replayBringOnly(replay, parseReplayLog(replay.log)) ?? undefined,
    targetTurn, snapshot: snapshotFor(targetTurn),
    choiceLocks: buildChoiceLockContext(replay.log, { p1Team, p2Team }, observations),
    capturePositions: {
      snapshotFor,
      onPosition: (turn, battle) => {
        if (turns.includes(turn) && !seen.has(turn)) seen.set(turn, read(battle));
      },
    },
  });
  return { runtime, seen };
}

function builtTeams(replay: Replay, pins: [side: 'p1' | 'p2', species: string, item: string][]) {
  const { observations, speedOrders } = parseReplayLogWithObservations(replay.log);
  const teams = buildTeamsFromReplay(replay.log, { observations, speedOrders });
  for (const [side, species, item] of pins) {
    (side === 'p1' ? teams.p1Team : teams.p2Team).find(set => set.species === species)!.item = item;
  }
  return teams;
}

const body = (battle: Battle, side: 0 | 1, species: string) =>
  battle.sides[side].pokemon.find(mon => mon.species.name === species)!;

describe('the sim brings the body the protocol shows', () => {
  test('751407: the Eject Pack brings Dragonite, the Knock Off lands on it, Gholdengo keeps its Choice Scarf', { timeout: 240000 }, async () => {
    const replay = fixture('smogtours-gen9ou-751407.json');
    const { p1Team, p2Team } = builtTeams(replay, [
      ['p2', 'Deoxys-Speed', 'Eject Pack'], ['p2', 'Dragonite', 'Choice Band'], ['p2', 'Gholdengo', 'Choice Scarf'],
    ]);
    const { seen } = await boundaries(replay, p1Team, p2Team, [2], battle => ({
      ejected: switchAfterItem(simBlock(battle, 2), 'p2a', 'Eject Pack'),
      knocked: simBlock(battle, 2).find(line => line.includes('[from] move: Knock Off'))?.split('|')[3] ?? null,
      gholdengo: body(battle, 1, 'Gholdengo').item,
    }));
    expect(seen.get(2)).toEqual({ ejected: 'Dragonite', knocked: 'Choice Band', gholdengo: 'choicescarf' });
  });

  test('2658662321: a holder hit before it acted is ejected in the sim; Salt Cure leaves with Hatterene', { timeout: 240000 }, async () => {
    const replay = fixture('gen9ou-2658662321.json');
    const { p1Team, p2Team } = builtTeams(replay, [['p2', 'Hatterene', 'Eject Button']]);
    const { seen } = await boundaries(replay, p1Team, p2Team, [3], battle => {
      const lines = simBlock(battle, 3);
      return {
        saltCure: lines.find(line => line.startsWith('|-start|') && line.includes('Salt Cure'))?.split('|')[2].split(': ')[1] ?? null,
        ejected: switchAfterItem(lines, 'p2a', 'Eject Button'),
        walkingWakeCured: 'saltcure' in body(battle, 1, 'Walking Wake').volatiles,
        hatterene: body(battle, 1, 'Hatterene').item,
        hattereneName: body(battle, 1, 'Hatterene').name,
      };
    });
    const { hattereneName, ...rest } = seen.get(3)!;
    expect(rest).toEqual({ saltCure: hattereneName, ejected: 'Walking Wake', walkingWakeCured: false, hatterene: '' });
  });

  test('doubles 2630181744: Sinistcha\'s Eject Button brings Ninetales-Alola into p2b', { timeout: 240000 }, async () => {
    const replay = fixture('gen9vgc2026regi-2630181744.json');
    const { p1Team, p2Team } = builtTeams(replay, [['p2', 'Sinistcha-Masterpiece', 'Eject Button']]);
    const { runtime, seen } = await boundaries(replay, p1Team, p2Team, [4], battle => ({
      ejected: switchAfterItem(simBlock(battle, 4), 'p2b', 'Eject Button'),
    }));
    expect(runtime.choiceErrors.count).toBe(0);
    expect(seen.get(4)).toEqual({ ejected: 'Ninetales-Alola' });
  });
});

const mon = (species: string, item: string, ability: string, moves: string[], spe = 0): PokemonSet => ({
  name: species, species, item, ability, moves, nature: 'Serious', gender: '', level: 100,
  evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 0, spe }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
});

function make(format: string, p1: PokemonSet[], p2: PokemonSet[]): Battle {
  const battle = new LiveBattle({ formatid: format as never, seed: [1, 2, 3, 4], p1: { name: 'A', team: Teams.pack(p1) }, p2: { name: 'B', team: Teams.pack(p2) } });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
  }
  return battle;
}

const publicLines = (log: string[]) =>
  log.filter((line, index, all) => !line.startsWith('|split|') && !all[index - 1]?.startsWith('|split|') && !line.startsWith('|t:|'));

function readTurn(format: string, p1: PokemonSet[], p2: PokemonSet[], choices: [string, string], forcedAnswer: string, hpShare: number) {
  const played = make(format, p1, p2);
  const holder = played.sides[0].active[0]!;
  holder.hp = Math.floor(holder.maxhp * hpShare);
  played.choose('p1', choices[0]);
  played.choose('p2', choices[1]);
  if (played.sides[0].requestState === 'switch') played.choose('p1', forcedAnswer);
  const turn = parseTurnBlocks(publicLines(played.log).join('\n')).turns.find(entry => entry.turn === 1)!;
  expect(turn.preUpkeep.some(line => line.startsWith('|-activate|p1a:') && line.includes('ability: '))).toBe(true);
  return {
    forced: collectForcedSwitchSpecies(turn.preUpkeep, turn.postUpkeep, 'p1', rulesDex(9)),
    main: getMainChoice(turn.preUpkeep, 'p1', make(format, p1, p2) as never),
  };
}

const golisopod = mon('Golisopod', 'Leftovers', 'Emergency Exit', ['Liquidation', 'First Impression']);
const corviknight = mon('Corviknight', 'Leftovers', 'Pressure', ['Brave Bird']);
const tauros = mon('Tauros', 'Leftovers', 'Intimidate', ['Body Slam'], 252);

describe('the forced list reads the switch an ability asked for', () => {
  test.each([7, 8, 9])('gen %i: an Emergency Exit switch before the holder acts answers the ability\'s request', gen => {
    const read = readTurn(`gen${gen}customgame`, [golisopod, corviknight], [tauros], ['move liquidation', 'move bodyslam'], 'switch 2', 0.55);
    expect(read.forced).toEqual(['Corviknight']);
    expect(read.main).toMatch(/^move 1\b/);
  });

  test.each([7, 9])('gen %i: Wimp Out does the same', gen => {
    const read = readTurn(`gen${gen}customgame`, [mon('Wimpod', 'Eviolite', 'Wimp Out', ['Struggle Bug']), corviknight],
      [mon('Chansey', 'Eviolite', 'Natural Cure', ['Seismic Toss'], 252)], ['move strugglebug', 'move seismictoss'], 'switch 2', 0.6);
    expect(read.forced).toEqual(['Corviknight']);
    expect(read.main).toMatch(/^move 1\b/);
  });

  test('doubles: the Emergency Exit switch in p1a answers the request, p1b keeps its move', () => {
    const read = readTurn('gen9doublescustomgame',
      [golisopod, mon('Blissey', 'Leftovers', 'Natural Cure', ['Soft-Boiled']), corviknight],
      [tauros, mon('Chansey', 'Eviolite', 'Natural Cure', ['Soft-Boiled'])],
      ['move liquidation 1, move softboiled', 'move bodyslam 1, move softboiled'], 'switch 3, pass', 0.55);
    expect(read.forced).toEqual(['Corviknight']);
    const [holder, partner] = read.main.split(', ');
    expect(holder).toMatch(/^move 1\b/);
    expect(partner).toBe('move 1');
  });

  test('a chosen switch after another ability\'s -activate on the slot stays the side\'s choice', () => {
    const pursued = [
      '|move|p2a: Weavile|Pursuit|p1a: Cofagrigus|[from]Pursuit',
      '|-damage|p1a: Cofagrigus|60/100',
      '|-activate|p1a: Cofagrigus|ability: Mummy|Pressure|[of] p2a: Weavile',
      '|switch|p1a: Ferrothorn|Ferrothorn|100/100',
    ];
    expect(collectForcedSwitchSpecies(pursued, [], 'p1', rulesDex(9))).toEqual([]);
    expect(collectForcedSwitchSpecies([...pursued.slice(0, 3), '|', pursued[3]], [], 'p1', rulesDex(9))).toEqual([]);
  });
});

describe('the rebuild plays the Emergency Exit as the game did', () => {
  test('the replacement comes in on the ability\'s request and the hit lands on the holder', { timeout: 240000 }, async () => {
    const p1 = [mon('Golisopod', 'Leftovers', 'Emergency Exit', ['Liquidation', 'First Impression']), corviknight];
    const p2 = [mon('Rillaboom', 'Choice Band', 'Grassy Surge', ['Drum Beating'], 252)];
    const played = make('gen9customgame', p1, p2);
    played.choose('p1', 'move liquidation');
    played.choose('p2', 'move drumbeating');
    if (played.sides[0].requestState === 'switch') played.choose('p1', 'switch 2');
    const replayLog = publicLines(played.log).join('\n');
    const { snapshots } = parseReplayLogWithObservations(replayLog);
    const runtime = await reconstructBranchRuntime({
      format: 'gen9customgame', p1Team: p1, p2Team: p2, replayLog, targetTurn: 2, snapshot: snapshots[1],
    });
    const lines = publicLines(runtime.battleStream.battle!.log);
    const block = lines.slice(lines.indexOf('|turn|1'));
    expect(runtime.choiceErrors.count).toBe(0);
    expect(block.find(line => line.startsWith('|move|p2a: Rillaboom|Drum Beating|'))?.split('|')[4]).toBe('p1a: Golisopod');
    expect(block.some(line => line.startsWith('|switch|p1a: Corviknight|'))).toBe(true);
  });
});

describe('locked-slot-choice', () => {
  const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
  const evs = { hp: 252, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  const mon = (species: string, ability: string, moves: string[], teraType: string): PokemonSet => ({
    name: species, species, item: '', ability, moves, nature: 'Serious', evs, ivs, level: 100, teraType,
  });

  const doublesHead = (secondName: string, secondDetails: string) => [
    '|gametype|doubles', '|player|p1|Alice||', '|player|p2|Bob||', '|gen|9', '|tier|[Gen 9] Doubles OU',
    '|poke|p1|Blissey, F|', `|poke|p1|${secondDetails}|`, '|poke|p2|Chansey, F|', '|poke|p2|Happiny, F|', '|start',
    '|switch|p1a: Blissey|Blissey, F|100/100',
    `|switch|p1b: ${secondName}|${secondDetails}|100/100`,
    '|switch|p2a: Chansey|Chansey, F|100/100',
    '|switch|p2b: Happiny|Happiny, F|100/100',
  ];

  const p2Doubles = [
    mon('Chansey', 'Natural Cure', ['Seismic Toss', 'Soft-Boiled'], 'Fairy'),
    mon('Happiny', 'Natural Cure', ['Seismic Toss', 'Pound'], 'Fairy'),
  ];

  function rebuild(log: string, p1Team: PokemonSet[], p2Team: PokemonSet[], format: string, targetTurn: number) {
    const snapshots = parseReplayLog(log);
    return reconstructBranchRuntime({
      format, p1Team, p2Team, replayLog: log, targetTurn,
      snapshot: snapshots.find(entry => entry.turn === targetTurn) ?? null,
    });
  }

  async function composedAndPlayed(log: string, p1Team: PokemonSet[], p2Team: PokemonSet[], format: string) {
    const boundary = await rebuild(log, p1Team, p2Team, format, 2);
    const block = parseTurnBlocks(log).turns.find(turn => turn.turn === 2)!;
    const composed = getMainChoice(block.preUpkeep, 'p1', boundary.battleStream.battle!);
    const runtime = await rebuild(log, p1Team, p2Team, format, 3);
    return { composed, runtime };
  }

  describe('a locked slot carries no target loc', () => {
    test('doubles recharge: the partner plays its protocol move', async () => {
      const log = [
        ...doublesHead('Snorlax', 'Snorlax, M'),
        '|turn|1',
        '|move|p1b: Snorlax|Hyper Beam|p2a: Chansey',
        '|-damage|p2a: Chansey|70/100',
        '|-mustrecharge|p1b: Snorlax',
        '|move|p1a: Blissey|Seismic Toss|p2b: Happiny',
        '|-damage|p2b: Happiny|80/100',
        '|upkeep', '|turn|2',
        '|cant|p1b: Snorlax|recharge',
        '|move|p1a: Blissey|Soft-Boiled|p1a: Blissey',
        '|-heal|p1a: Blissey|100/100',
        '|move|p2a: Chansey|Seismic Toss|p1a: Blissey',
        '|-damage|p1a: Blissey|90/100',
        '|upkeep', '|turn|3',
      ].join('\n');
      const p1Team = [
        mon('Blissey', 'Natural Cure', ['Seismic Toss', 'Soft-Boiled'], 'Fairy'),
        mon('Snorlax', 'Immunity', ['Hyper Beam', 'Rest'], 'Water'),
      ];

      const { composed, runtime } = await composedAndPlayed(log, p1Team, p2Doubles, 'gen9doublesou');
      const blissey = runtime.battleStream.battle!.sides[0].pokemon.find(p => p.species.name === 'Blissey')!;
      expect(composed).toBe('move 2, move 1');
      expect(runtime.choiceErrors.count).toBe(0);
      expect(blissey.lastMove?.id).toBe('softboiled');
    });

    test('doubles Fly release: the |move| branch drops the loc too', async () => {
      const log = [
        ...doublesHead('Corviknight', 'Corviknight, M'),
        '|turn|1',
        '|move|p1b: Corviknight|Fly||[still]',
        '|-prepare|p1b: Corviknight|Fly',
        '|move|p1a: Blissey|Seismic Toss|p2b: Happiny',
        '|-damage|p2b: Happiny|80/100',
        '|upkeep', '|turn|2',
        '|move|p1b: Corviknight|Fly|p2a: Chansey|[from]lockedmove',
        '|-damage|p2a: Chansey|85/100',
        '|move|p1a: Blissey|Soft-Boiled|p1a: Blissey',
        '|-heal|p1a: Blissey|100/100',
        '|upkeep', '|turn|3',
      ].join('\n');
      const p1Team = [
        mon('Blissey', 'Natural Cure', ['Seismic Toss', 'Soft-Boiled'], 'Fairy'),
        mon('Corviknight', 'Pressure', ['Fly', 'Roost'], 'Steel'),
      ];

      const { composed, runtime } = await composedAndPlayed(log, p1Team, p2Doubles, 'gen9doublesou');
      const blissey = runtime.battleStream.battle!.sides[0].pokemon.find(p => p.species.name === 'Blissey')!;
      expect(composed).toBe('move 2, move 1');
      expect(runtime.choiceErrors.count).toBe(0);
      expect(blissey.lastMove?.id).toBe('softboiled');
    });

    test('doubles: a choice-locked slot that flinches defaults to its enabled move', async () => {
      const log = [
        '|gametype|doubles', '|player|p1|Alice||', '|player|p2|Bob||', '|gen|9', '|tier|[Gen 9] Doubles OU',
        '|poke|p1|Blissey, F|', '|poke|p1|Snorlax, M|', '|poke|p1|Hitmontop, M|',
        '|poke|p2|Miraidon|', '|poke|p2|Chansey, F|', '|start',
        '|switch|p1a: Blissey|Blissey, F|100/100',
        '|switch|p1b: Snorlax|Snorlax, M|100/100',
        '|switch|p2a: Miraidon|Miraidon|100/100',
        '|switch|p2b: Chansey|Chansey, F|100/100',
        '|turn|1',
        '|switch|p1a: Hitmontop|Hitmontop, M|100/100',
        '|move|p2a: Miraidon|Snarl|p1a: Hitmontop|[spread] p1a,p1b',
        '|-damage|p1a: Hitmontop|85/100',
        '|-damage|p1b: Snorlax|90/100',
        '|move|p2b: Chansey|Seismic Toss|p1b: Snorlax',
        '|-damage|p1b: Snorlax|70/100',
        '|move|p1b: Snorlax|Rest|p1b: Snorlax',
        '|upkeep', '|turn|2',
        '|move|p1a: Hitmontop|Fake Out|p2a: Miraidon',
        '|-damage|p2a: Miraidon|95/100',
        '|cant|p2a: Miraidon|flinch',
        '|move|p2b: Chansey|Soft-Boiled|p2b: Chansey',
        '|upkeep', '|turn|3',
      ].join('\n');
      const p1Team = [
        mon('Blissey', 'Natural Cure', ['Seismic Toss', 'Soft-Boiled'], 'Fairy'),
        mon('Snorlax', 'Immunity', ['Hyper Beam', 'Rest'], 'Water'),
        mon('Hitmontop', 'Technician', ['Fake Out', 'Close Combat'], 'Fighting'),
      ];
      const p2Team = [
        { ...mon('Miraidon', 'Hadron Engine', ['Volt Switch', 'Snarl'], 'Electric'), item: 'Choice Specs' },
        mon('Chansey', 'Natural Cure', ['Seismic Toss', 'Soft-Boiled'], 'Fairy'),
      ];

      const boundary = await rebuild(log, p1Team, p2Team, 'gen9doublesou', 2);
      const block = parseTurnBlocks(log).turns.find(turn => turn.turn === 2)!;
      expect(getMainChoice(block.preUpkeep, 'p2', boundary.battleStream.battle!)).toBe('move 2, move 2');
      const runtime = await rebuild(log, p1Team, p2Team, 'gen9doublesou', 3);
      const chansey = runtime.battleStream.battle!.sides[1].pokemon.find(p => p.species.name === 'Chansey')!;
      expect(runtime.choiceErrors.count).toBe(0);
      expect(chansey.lastMove?.id).toBe('softboiled');
    });

    test('singles recharge never carried a loc', async () => {
      const log = [
        '|gametype|singles', '|player|p1|Alice||', '|player|p2|Bob||', '|gen|9', '|tier|[Gen 9] OU',
        '|poke|p1|Snorlax, M|', '|poke|p1|Blissey, F|', '|poke|p2|Chansey, F|', '|poke|p2|Happiny, F|', '|start',
        '|switch|p1a: Snorlax|Snorlax, M|100/100',
        '|switch|p2a: Chansey|Chansey, F|100/100',
        '|turn|1',
        '|move|p1a: Snorlax|Hyper Beam|p2a: Chansey',
        '|-damage|p2a: Chansey|70/100',
        '|-mustrecharge|p1a: Snorlax',
        '|move|p2a: Chansey|Soft-Boiled|p2a: Chansey',
        '|-heal|p2a: Chansey|100/100',
        '|upkeep', '|turn|2',
        '|cant|p1a: Snorlax|recharge',
        '|move|p2a: Chansey|Seismic Toss|p1a: Snorlax',
        '|-damage|p1a: Snorlax|90/100',
        '|upkeep', '|turn|3',
      ].join('\n');
      const p1Team = [
        mon('Snorlax', 'Immunity', ['Hyper Beam', 'Rest'], 'Water'),
        mon('Blissey', 'Natural Cure', ['Seismic Toss', 'Soft-Boiled'], 'Fairy'),
      ];

      const { composed, runtime } = await composedAndPlayed(log, p1Team, p2Doubles, 'gen9ou');
      expect(composed).toBe('move 1');
      expect(runtime.choiceErrors.count).toBe(0);
    });
  });
});

describe('powered-choices', () => {
  type Format = 'singles' | 'doubles';
  const FORMATS: Format[] = ['singles', 'doubles'];

  const mon = (species: string, item: string, ability: string, moves: string[], extra: Partial<PokemonSet> = {}): PokemonSet => ({
    name: species, species, item, ability, moves, nature: 'Serious', gender: '', level: 100,
    evs: { hp: 252, atk: 0, def: 4, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, ...extra,
  });
  const SKARMORY = mon('Skarmory', 'Leftovers', 'Sturdy', ['Splash']);
  const CHANSEY = mon('Chansey', 'Leftovers', 'Natural Cure', ['Splash']);

  function make(gen: 7 | 8, format: Format, tested: PokemonSet): Battle {
    const doubles = format === 'doubles';
    const p1 = doubles ? [SKARMORY, CHANSEY] : [SKARMORY];
    const p2 = doubles ? [tested, CHANSEY] : [tested];
    const battle = new LiveBattle({
      formatid: toID(`gen${gen}${doubles ? 'doublescustomgame' : 'customgame'}`) as never, seed: [1, 2, 3, 4],
      p1: { name: 'A', team: Teams.pack(p1) }, p2: { name: 'B', team: Teams.pack(p2) },
    });
    if (battle.requestState === 'teampreview') {
      battle.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
      battle.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
    }
    return battle;
  }

  const fragment = (format: Format, tested: string) => (format === 'doubles' ? `${tested}, move 1` : tested);
  const splash = (format: Format) => (format === 'doubles' ? 'move 1, move 1' : 'move 1');
  const foe = (format: Format) => (format === 'doubles' ? ' 1' : '');

  const publicLines = (battle: Battle) =>
    battle.log.filter((line, index, all) => !line.startsWith('|split|') && !all[index - 1]?.startsWith('|split|'));

  const powerLines = (events: string[]) => events.filter(line => /^\|(-zpower\||-start\|p2a: [^|]*\|Dynamax|move\|p2a)/.test(line));

  function replayLastTurn(gen: 7 | 8, format: Format, tested: PokemonSet, clicks: string[]) {
    const played = make(gen, format, tested);
    const board = make(gen, format, tested);
    clicks.forEach((click, index) => {
      expect(played.choose('p1', splash(format))).toBe(true);
      expect(played.choose('p2', fragment(format, click))).toBe(true);
      if (index < clicks.length - 1) {
        expect(board.choose('p1', splash(format))).toBe(true);
        expect(board.choose('p2', fragment(format, click))).toBe(true);
      }
    });
    const turnOf = (battle: Battle) => parseTurnBlocks(publicLines(battle).join('\n')).turns.find(entry => entry.turn === clicks.length)!.preUpkeep;
    const game = turnOf(played);
    const choice = getMainChoice(game, 'p2', board as never);
    const accepted = board.choose('p2', choice) && board.choose('p1', splash(format));
    return { game: powerLines(game), rebuilt: accepted ? powerLines(turnOf(board)) : [], accepted, choice };
  }

  const GARCHOMP = mon('Garchomp', 'Dragonium Z', 'Rough Skin', ['Dragon Dance', 'Outrage', 'Earthquake', 'Stealth Rock']);
  const CORVIKNIGHT = mon('Corviknight', 'Leftovers', 'Pressure', ['Brave Bird', 'Roost', 'Body Press', 'Iron Defense']);

  function expectSameTurn(gen: 7 | 8, format: Format, tested: PokemonSet, clicks: string[], powered: string) {
    const result = replayLastTurn(gen, format, tested, clicks);
    expect(result.accepted, `the simulator takes "${result.choice}"`).toBe(true);
    expect(result.game.some(line => line.includes(`|${powered}|`))).toBe(true);
    expect(result.rebuilt).toEqual(result.game);
  }

  describe('a Z-move line is rebuilt as the same Z-move (Gen 7)', () => {
    test.each(FORMATS)('%s: a Dragon Z-move of the Dragon attack in the set', format => {
      expectSameTurn(7, format, GARCHOMP, [`move 2${foe(format)} zmove`], 'Devastating Drake');
    });

    test.each(FORMATS)('%s: a status Z-move of the status move in the set', format => {
      expectSameTurn(7, format, GARCHOMP, ['move 1 zmove'], 'Z-Dragon Dance');
    });

    test.each(FORMATS)('%s: a species\' own Z-move of its base move', format => {
      const raichu = mon('Raichu-Alola', 'Aloraichium Z', 'Surge Surfer', ['Surf', 'Thunderbolt', 'Nasty Plot', 'Focus Blast']);
      expectSameTurn(7, format, raichu, [`move 2${foe(format)} zmove`], 'Stoked Sparksurfer');
    });

    test('a body whose set lacks the base move gets a click the simulator rejects: that is why the build must hold the base move', () => {
      const { game } = replayLastTurn(7, 'singles', GARCHOMP, ['move 2 zmove']);
      expect(game.some(line => line.includes('|Devastating Drake|'))).toBe(true);
      const bare = make(7, 'singles', mon('Garchomp', 'Dragonium Z', 'Rough Skin', ['Tackle']));
      expect(bare.choose('p2', 'move devastatingdrake')).toBe(false);
    });
  });

  describe('a Max move line is rebuilt as the same Max move, Dynamax included (Gen 8)', () => {
    test.each(FORMATS)('%s: the first Max move starts the Dynamax', format => {
      expectSameTurn(8, format, CORVIKNIGHT, [`move 1${foe(format)} dynamax`], 'Max Airstream');
    });

    test.each(FORMATS)('%s: a later Max move and Max Guard', format => {
      const first = `move 1${foe(format)} dynamax`;
      expectSameTurn(8, format, CORVIKNIGHT, [first, `move 3${foe(format)}`], 'Max Knuckle');
      expectSameTurn(8, format, CORVIKNIGHT, [first, 'move 2'], 'Max Guard');
    });

    test.each(FORMATS)('%s: a G-Max move', format => {
      const gmax = mon('Corviknight', 'Leftovers', 'Pressure', ['Brave Bird', 'Roost'], { gigantamax: true });
      expectSameTurn(8, format, gmax, [`move 1${foe(format)} dynamax`], 'G-Max Wind Rage');
    });
  });
});
