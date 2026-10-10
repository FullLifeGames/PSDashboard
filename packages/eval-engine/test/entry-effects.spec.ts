import { readFileSync } from 'fs';
import { test, expect, describe } from 'vitest';
import { Battle as LiveBattle, Teams, type Battle, type PokemonSet } from '@pkmn/sim';
import {
  buildTeamsFromReplay, getBranchSimulatorFormat, parseReplayLog, parseReplayLogWithObservations, replayBringOnly,
} from '@fulllifegames/replay-core';
import { buildChoiceLockContext } from '../src/choice-lock';
import { reconstructBranchRuntime } from '../src/branch-engine';
import { correctActivesFromProtocol, correctBattleFromSnapshot } from '../src/branch/corrections';
import { serializeBattleStable } from '../src/forward-model';

/**
 * Round 67 (T133): a body the boundary correction puts on the field (the sim
 * kept another body there) plays the switch-in the game showed, through the
 * simulator's own switch-in. Before, a repointed body never played it: 749828
 * t17, Roaring Moon without the Protosynthesis the protocol shows. A faint the
 * protocol shows before the switch-in counts first, and the snapshot
 * correction counts the faints it writes, so Supreme Overlord reads the
 * game's number of fallen allies.
 */

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

/** Plays turn 1 in the sim: the board then stands at the boundary the correction runs on. */
function playTurn(battle: Battle, p1: string, p2: string, p1Forced?: string): Battle {
  battle.choose('p1', p1);
  battle.choose('p2', p2);
  if (p1Forced && battle.sides[0].requestState === 'switch') battle.choose('p1', p1Forced);
  return battle;
}

/** The sim's own public lines of the block that ends at |turn|boundary. */
function simBlock(battle: Battle, boundary: number): string[] {
  const end = battle.log.lastIndexOf(`|turn|${boundary}`);
  const start = battle.log.lastIndexOf(`|turn|${boundary - 1}`, end);
  return battle.log.slice(start + 1, end).filter((line, index, all) => !line.startsWith('|split|') && !all[index - 1]?.startsWith('|split|'));
}

const body = (battle: Battle, side: 0 | 1, species: string) =>
  battle.sides[side].pokemon.find(entry => entry.species.name === species)!;

describe('a body the correction puts in plays its switch-in through the simulator', () => {
  test('singles: Booster Energy starts Protosynthesis, and the correction writes nothing to the sim\'s log', () => {
    const battle = playTurn(make('gen9customgame',
      [mon('Gholdengo', 'Leftovers', 'Good as Gold', ['Nasty Plot']), mon('Roaring Moon', 'Booster Energy', 'Protosynthesis', ['Dragon Dance'], 252)],
      [mon('Great Tusk', 'Leftovers', 'Protosynthesis', ['Bulk Up'])]), 'move nastyplot', 'move bulkup');
    const logLength = battle.log.length;
    correctActivesFromProtocol(battle as never, ['|switch|p1a: Roaring Moon|Roaring Moon|100/100']);
    const roaringMoon = battle.sides[0].active[0]!;
    expect(roaringMoon.species.name).toBe('Roaring Moon');
    expect(roaringMoon.volatiles['protosynthesis']).toMatchObject({ bestStat: roaringMoon.getBestStat(false, true) });
    expect(roaringMoon.item).toBe('');
    expect(battle.log.length).toBe(logLength);
  });

  test('doubles: a correction-placed Intimidate lowers both foes once; Booster Energy starts Quark Drive in the other slot', () => {
    const battle = playTurn(make('gen9doublescustomgame',
      [
        mon('Amoonguss', 'Leftovers', 'Regenerator', ['Protect']), mon('Blissey', 'Leftovers', 'Natural Cure', ['Soft-Boiled']),
        mon('Landorus-Therian', 'Leftovers', 'Intimidate', ['Earthquake']), mon('Iron Valiant', 'Booster Energy', 'Quark Drive', ['Moonblast'], 252),
      ],
      [mon('Garchomp', 'Leftovers', 'Rough Skin', ['Protect']), mon('Dragonite', 'Leftovers', 'Multiscale', ['Protect'])]),
    'move protect, move softboiled', 'move protect, move protect');
    correctActivesFromProtocol(battle as never, [
      '|switch|p1a: Landorus|Landorus-Therian|100/100',
      '|switch|p1b: Iron Valiant|Iron Valiant|100/100',
    ]);
    const ironValiant = body(battle, 0, 'Iron Valiant');
    expect(battle.sides[1].active.map(foe => foe!.boosts.atk)).toEqual([-1, -1]);
    expect(ironValiant.volatiles['quarkdrive']).toMatchObject({ bestStat: ironValiant.getBestStat(false, true) });
    expect(ironValiant.item).toBe('');
  });

  test('the entries happened before the turn ended: the board stands as the sim\'s endTurn leaves it', () => {
    const battle = playTurn(make('gen9customgame',
      [mon('Gholdengo', 'Leftovers', 'Good as Gold', ['Nasty Plot']), mon('Landorus-Therian', 'Leftovers', 'Intimidate', ['Earthquake'])],
      [mon('Great Tusk', 'Leftovers', 'Protosynthesis', ['Bulk Up'])]), 'move nastyplot', 'move bulkup');
    correctActivesFromProtocol(battle as never, ['|switch|p1a: Landorus|Landorus-Therian|100/100']);
    const [landorus, greatTusk] = [battle.sides[0].active[0]!, battle.sides[1].active[0]!];
    expect(greatTusk.boosts.atk).toBe(0);
    expect({ activeTurns: landorus.activeTurns, statsLowered: greatTusk.statsLoweredThisTurn, used: landorus.usedItemThisTurn })
      .toEqual({ activeTurns: 1, statsLowered: false, used: false });
  });

  test('a body the sim brought in and lost again in the block keeps its one entry', () => {
    // The sim plays Landorus's switch-in (Intimidate), then Whirlwind drags it
    // out; the protocol keeps it in. The repoint must not play Intimidate twice.
    const battle = playTurn(make('gen9customgame',
      [mon('Garchomp', 'Leftovers', 'Rough Skin', ['Swords Dance']), mon('Landorus-Therian', 'Leftovers', 'Intimidate', ['Earthquake'])],
      [mon('Skarmory', 'Leftovers', 'Sturdy', ['Whirlwind'])]), 'switch 2', 'move whirlwind');
    expect(battle.sides[0].active[0]!.species.name).toBe('Garchomp');
    correctActivesFromProtocol(battle as never, [
      '|switch|p1a: Landorus|Landorus-Therian|100/100',
      '|-ability|p1a: Landorus|Intimidate|boost',
      '|-unboost|p2a: Skarmory|atk|1',
      '|move|p2a: Skarmory|Whirlwind|p1a: Landorus',
      '|-fail|p1a: Landorus',
    ]);
    expect(battle.sides[0].active[0]!.species.name).toBe('Landorus-Therian');
    expect(battle.sides[1].active[0]!.boosts.atk).toBe(-1);
  });

  test.each([
    ['gen9customgame', 'move nastyplot', 'move bulkup'],
    ['gen9doublescustomgame', 'move nastyplot, move protect', 'move bulkup, move protect'],
  ])('%s: a board that already agrees with the protocol stays byte-identical', (format, p1, p2) => {
    const doubles = format.includes('doubles');
    const battle = playTurn(make(format,
      [mon('Gholdengo', 'Leftovers', 'Good as Gold', ['Nasty Plot']), mon('Amoonguss', 'Leftovers', 'Regenerator', ['Protect']), mon('Kingambit', 'Leftovers', 'Supreme Overlord', ['Swords Dance'])],
      [mon('Great Tusk', 'Leftovers', 'Protosynthesis', ['Bulk Up']), mon('Garchomp', 'Leftovers', 'Rough Skin', ['Protect'])].slice(0, doubles ? 2 : 1)),
    p1, p2);
    const before = serializeBattleStable(battle);
    correctActivesFromProtocol(battle as never, simBlock(battle, 2));
    expect(serializeBattleStable(battle)).toBe(before);
  });
});

describe('the faints the protocol shows count before the entry', () => {
  test('singles: the protocol\'s faint before the switch-in counts, so Supreme Overlord reads it', () => {
    const battle = playTurn(make('gen9customgame',
      [mon('Gholdengo', 'Leftovers', 'Good as Gold', ['Nasty Plot']), mon('Kingambit', 'Leftovers', 'Supreme Overlord', ['Swords Dance'])],
      [mon('Great Tusk', 'Leftovers', 'Protosynthesis', ['Bulk Up'])]), 'move nastyplot', 'move bulkup');
    correctActivesFromProtocol(battle as never, [
      '|move|p2a: Great Tusk|Headlong Rush|p1a: Gholdengo',
      '|-damage|p1a: Gholdengo|0 fnt',
      '|faint|p1a: Gholdengo',
      '|switch|p1a: Kingambit|Kingambit|100/100',
    ]);
    const gholdengo = body(battle, 0, 'Gholdengo');
    expect({ fainted: gholdengo.fainted, hp: gholdengo.hp, fallen: battle.sides[0].totalFainted })
      .toEqual({ fainted: true, hp: 0, fallen: 1 });
    expect(body(battle, 0, 'Kingambit').abilityState.fallen).toBe(1);
  });

  test('doubles: two faints before two replacements; Supreme Overlord counts both', () => {
    const battle = playTurn(make('gen9doublescustomgame',
      [
        mon('Gholdengo', 'Leftovers', 'Good as Gold', ['Nasty Plot']), mon('Amoonguss', 'Leftovers', 'Regenerator', ['Protect']),
        mon('Kingambit', 'Leftovers', 'Supreme Overlord', ['Swords Dance']), mon('Blissey', 'Leftovers', 'Natural Cure', ['Soft-Boiled']),
      ],
      [mon('Great Tusk', 'Leftovers', 'Protosynthesis', ['Bulk Up']), mon('Garchomp', 'Leftovers', 'Rough Skin', ['Protect'])]),
    'move nastyplot, move protect', 'move bulkup, move protect');
    correctActivesFromProtocol(battle as never, [
      '|faint|p1a: Gholdengo',
      '|faint|p1b: Amoonguss',
      '|switch|p1a: Kingambit|Kingambit|100/100',
      '|switch|p1b: Blissey|Blissey|100/100',
    ]);
    expect(battle.sides[0].totalFainted).toBe(2);
    expect(['Gholdengo', 'Amoonguss'].map(species => body(battle, 0, species).fainted)).toEqual([true, true]);
    expect(body(battle, 0, 'Kingambit').abilityState.fallen).toBe(2);
  });

  /** A protocol log of one turn: p1's lead faints to Great Tusk (or survives), Kingambit comes in. */
  const protocolTurn = (doubles: boolean, faints: boolean) => [
    '|player|p1|A|', '|player|p2|B|', `|gametype|${doubles ? 'doubles' : 'singles'}`, '|gen|9',
    '|poke|p1|Gholdengo|', '|poke|p1|Amoonguss|', '|poke|p1|Kingambit|', '|poke|p2|Great Tusk|', '|poke|p2|Garchomp|',
    '|start',
    '|switch|p1a: Gholdengo|Gholdengo|100/100', ...(doubles ? ['|switch|p1b: Amoonguss|Amoonguss|100/100'] : []),
    '|switch|p2a: Great Tusk|Great Tusk|100/100', ...(doubles ? ['|switch|p2b: Garchomp|Garchomp|100/100'] : []),
    '|turn|1',
    '|move|p2a: Great Tusk|Headlong Rush|p1a: Gholdengo',
    ...(faints ? ['|-damage|p1a: Gholdengo|0 fnt', '|faint|p1a: Gholdengo', '|upkeep', '|switch|p1a: Kingambit|Kingambit|100/100']
      : ['|-damage|p1a: Gholdengo|60/100', '|upkeep']),
    '|turn|2',
  ].join('\n');

  test.each([false, true])('the snapshot correction counts the faint it writes (doubles: %s)', doubles => {
    const battle = playTurn(make(doubles ? 'gen9doublescustomgame' : 'gen9customgame',
      [mon('Gholdengo', 'Leftovers', 'Good as Gold', ['Nasty Plot']), mon('Amoonguss', 'Leftovers', 'Regenerator', ['Protect']), mon('Kingambit', 'Leftovers', 'Supreme Overlord', ['Swords Dance'])],
      [mon('Great Tusk', 'Leftovers', 'Protosynthesis', ['Bulk Up']), mon('Garchomp', 'Leftovers', 'Rough Skin', ['Protect'])].slice(0, doubles ? 2 : 1)),
    doubles ? 'move nastyplot, move protect' : 'move nastyplot', doubles ? 'move bulkup, move protect' : 'move bulkup');
    const snapshots = parseReplayLog(protocolTurn(doubles, true));
    correctBattleFromSnapshot(battle as never, snapshots[1]);
    expect(body(battle, 0, 'Gholdengo').fainted).toBe(true);
    expect(battle.sides[0].totalFainted).toBe(1);
  });

  test('the snapshot correction takes back a faint only the sim had', () => {
    const battle = make('gen9customgame',
      [mon('Gholdengo', 'Leftovers', 'Good as Gold', ['Nasty Plot']), mon('Amoonguss', 'Leftovers', 'Regenerator', ['Protect']), mon('Kingambit', 'Leftovers', 'Supreme Overlord', ['Swords Dance'])],
      [mon('Great Tusk', 'Leftovers', 'Protosynthesis', ['Headlong Rush'], 252)]);
    battle.sides[0].active[0]!.hp = 1;
    playTurn(battle, 'move nastyplot', 'move headlongrush', 'switch 3');
    expect(battle.sides[0].totalFainted).toBe(1);
    const snapshots = parseReplayLog(protocolTurn(false, false));
    correctBattleFromSnapshot(battle as never, snapshots[1]);
    expect(body(battle, 0, 'Gholdengo').fainted).toBe(false);
    expect(battle.sides[0].totalFainted).toBe(0);
  });
});

/**
 * The live pass the app and the bank run (boundary capture with snapshot
 * correction, choice locks on); `read` sees each listed boundary's board.
 */
async function boundaries<T>(replay: Replay, turns: number[], read: (battle: Battle) => T) {
  const { snapshots, observations, speedOrders } = parseReplayLogWithObservations(replay.log);
  const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders });
  const snapshotFor = (turn: number) => snapshots[Math.min(turn - 1, snapshots.length - 1)] ?? null;
  const seen = new Map<number, T>();
  const targetTurn = Math.max(...turns) + 1;
  await reconstructBranchRuntime({
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
  return seen;
}

describe('scenes: the board carries the entry the protocol shows', () => {
  test('749828: Roaring Moon carries Protosynthesis at boundary 17', { timeout: 240000 }, async () => {
    const seen = await boundaries(fixture('smogtours-gen9ou-749828.json'), [17], battle => {
      const roaringMoon = battle.sides[0].active[0]!;
      return { species: roaringMoon.species.name, protosynthesis: 'protosynthesis' in roaringMoon.volatiles, item: roaringMoon.item };
    });
    expect(seen.get(17)).toEqual({ species: 'Roaring Moon', protosynthesis: true, item: '' });
  });

  test('doubles 912884: Roaring Moon carries Protosynthesis at boundary 8', { timeout: 240000 }, async () => {
    const seen = await boundaries(fixture('smogtours-gen9doublesou-912884.json'), [8], battle => {
      const roaringMoon = battle.sides[1].pokemon.find(entry => entry.species.name === 'Roaring Moon')!;
      return { active: roaringMoon.isActive, protosynthesis: 'protosynthesis' in roaringMoon.volatiles };
    });
    expect(seen.get(8)).toEqual({ active: true, protosynthesis: true });
  });
});
