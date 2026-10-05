import { readFileSync } from 'fs';
import { test, expect, describe } from 'vitest';
import type { Battle, PokemonSet } from '@pkmn/sim';
import {
  buildTeamsFromReplay, getBranchSimulatorFormat, parseReplayLog, parseReplayLogWithObservations,
  type SmogonUsageStats,
} from '@fulllifegames/replay-core';
import { buildChoiceLockContext, buildChoiceLockTrails, protocolChoiceLock } from '../src/choice-lock';
import { reconstructBranchRuntime } from '../src/branch-engine';
import { createRootPosition, serializeBattleStable } from '../src/forward-model';
import { searchOptions } from '../src/search';

/**
 * Round 63 (T115): an item line a move writes (`[from] move:` — Trick,
 * Switcheroo, Knock Off and their kin) is the protocol's word on what a body
 * holds from then on. The board follows it at the next boundary, and a
 * Choice item handed over locks the body into its first move after the
 * arrival. Before, the board kept whatever the sim's own swap produced from
 * the build's guesses: in 655336 the sim's Trick handed Bisharp the guessed
 * Colbur Berry, so turn 6 offered four moves to a Choice-Scarf-locked body.
 */

const log = (lines: string[]) => lines.join('\n');

const trickTurn = (bisharpFirst: boolean, knockedAfter = false) => log([
  '|player|p1|Alice|', '|player|p2|Bob|', '|gen|6', '|tier|[Gen 6] OU', '|start',
  '|switch|p1a: Sharp|Bisharp, F|100/100',
  '|switch|p2a: Latias|Latias, F|100/100',
  '|turn|1',
  ...(bisharpFirst ? ['|move|p1a: Sharp|Knock Off|p2a: Latias'] : []),
  '|move|p2a: Latias|Trick|p1a: Sharp',
  '|-activate|p2a: Latias|move: Trick|[of] p1a: Sharp',
  '|-item|p1a: Sharp|Choice Scarf|[from] move: Trick',
  '|-item|p2a: Latias|Life Orb|[from] move: Trick',
  ...(bisharpFirst ? [] : [
    '|move|p1a: Sharp|Knock Off|p2a: Latias',
    '|-enditem|p2a: Latias|Life Orb|[from] move: Knock Off|[of] p1a: Sharp',
  ]),
  ...(knockedAfter ? ['|-enditem|p1a: Sharp|Choice Scarf|[from] move: Knock Off|[of] p2a: Latias'] : []),
  '|upkeep',
  '|turn|2',
]);

describe('hand-over trails', () => {
  test('a Choice item a move hands over restarts the trail: the first move after it locks', () => {
    const trails = buildChoiceLockTrails(trickTurn(false));
    expect(protocolChoiceLock(trails, 'p1', 2)).toMatchObject({ species: 'Bisharp', moveId: 'knockoff' });
  });

  test('a move before the hand-over does not lock; a handed non-Choice item does not either', () => {
    const trails = buildChoiceLockTrails(trickTurn(true));
    // Bisharp attacked before the Scarf arrived: it picks freely next turn.
    expect(protocolChoiceLock(trails, 'p1', 2)).toBeNull();
    // Latias used Trick before its Life Orb arrived; Life Orb locks nothing.
    expect(protocolChoiceLock(trails, 'p2', 2)).toBeNull();
  });

  test('a Knock Off after the hand-over leaves no lock', () => {
    const trails = buildChoiceLockTrails(trickTurn(false, true));
    expect(protocolChoiceLock(trails, 'p1', 2)).toBeNull();
  });
});

describe('held items from the protocol', () => {
  const teams = { p1Team: [] as PokemonSet[], p2Team: [] as PokemonSet[] };

  test('each body a move-written item line touched, with its final item and lock, by species', () => {
    const context = buildChoiceLockContext(trickTurn(false), teams, []);
    expect(context.heldItems.get(2)).toEqual([
      { side: 'p1', species: 'Bisharp', item: 'choicescarf', lock: 'knockoff' },
      // Latias received Life Orb by Trick and lost it to Knock Off in the same turn.
      { side: 'p2', species: 'Latias', item: '', lock: null },
    ]);
    expect(context.heldItems.get(1)).toBeUndefined();
  });

  test('a silent give-away empties the giver; a Knock Off empties its target', () => {
    const context = buildChoiceLockContext(log([
      '|player|p1|Alice|', '|player|p2|Bob|', '|gen|9', '|tier|[Gen 9] OU', '|start',
      '|switch|p1a: Blui|Alomomola, M|100/100',
      '|switch|p2a: The Sinner|Gholdengo|100/100',
      '|turn|1',
      '|move|p2a: The Sinner|Trick|p1a: Blui',
      '|-activate|p2a: The Sinner|move: Trick|[of] p1a: Blui',
      '|-item|p1a: Blui|Choice Scarf|[from] move: Trick',
      '|-enditem|p2a: The Sinner|Choice Scarf|[silent]|[from] move: Trick',
      '|upkeep',
      '|turn|2',
      '|move|p2a: The Sinner|Knock Off|p1a: Blui',
      '|-enditem|p1a: Blui|Choice Scarf|[from] move: Knock Off|[of] p2a: The Sinner',
      '|upkeep',
      '|turn|3',
    ]), teams, []);
    expect(context.heldItems.get(2)).toEqual([
      { side: 'p1', species: 'Alomomola', item: 'choicescarf', lock: null },
      { side: 'p2', species: 'Gholdengo', item: '', lock: null },
    ]);
    expect(context.heldItems.get(3)).toEqual([{ side: 'p1', species: 'Alomomola', item: '', lock: null }]);
  });
});

type Replay = { id: string; format: string; formatid?: string; players: string[]; log: string };
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf-8')) as Replay;

/**
 * The live pass the app and the bank run (boundary capture with snapshot
 * correction, choice locks on); `read` sees each listed boundary's board as
 * the capture hands it out — the battle object moves on after that.
 */
async function boundaries<T>(
  replay: Replay, p1Team: PokemonSet[], p2Team: PokemonSet[], turns: number[], read: (battle: Battle) => T,
  observations = parseReplayLogWithObservations(replay.log).observations,
) {
  const snapshots = parseReplayLog(replay.log);
  const snapshotFor = (turn: number) => snapshots[Math.min(turn - 1, snapshots.length - 1)] ?? null;
  const seen = new Map<number, T>();
  const targetTurn = Math.max(...turns) + 1;
  const runtime = await reconstructBranchRuntime({
    format: getBranchSimulatorFormat(replay), p1Team, p2Team, replayLog: replay.log,
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

const lockOf = (body: Battle['sides'][0]['active'][0] | undefined) =>
  (body?.volatiles['choicelock'] as { move?: string } | undefined)?.move ?? null;
const bodyView = (body: Battle['sides'][0]['active'][0] | undefined) =>
  ({ species: body?.species.name, item: body?.item, lock: lockOf(body) });

const pinItem = (team: PokemonSet[], species: string, item: string) => {
  const set = team.find(entry => entry.species === species)!;
  set.item = item;
};

describe('the board follows the protocol after a hand-over (round 63, T115)', () => {
  test('655336: after the turn-5 Trick, Bisharp holds the Choice Scarf and its only move at turn 6 is Knock Off', { timeout: 240000 }, async () => {
    // Protocol facts: Latias Tricks its Choice Scarf onto Bisharp (Bisharp's
    // Life Orb goes back), then Bisharp Knocks Off and faints Latias — turn 6
    // Bisharp is locked into Knock Off and the real player clicked it.
    const replay = fixture('smogtours-gen6ou-655336.json');
    const { observations, speedOrders } = parseReplayLogWithObservations(replay.log);
    // The harness's gen6ou usage stats, parsed once and cut to this replay's species.
    const usageStats = JSON.parse(readFileSync(new URL('./fixtures/usage-gen6ou-655336.json', import.meta.url), 'utf-8')) as SmogonUsageStats;
    const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders, usageStats });
    // The scene is a build that guessed the giver's item (usage's first
    // Latias item); pinned, so the test reads the board's correction and not
    // whether the inference credits the giver.
    pinItem(p2Team, 'Latias', 'Colbur Berry');
    const { seen } = await boundaries(replay, p1Team, p2Team, [6], battle => ({
      bisharp: bodyView(battle.sides[0].active[0]),
      moves: searchOptions(createRootPosition(serializeBattleStable(battle)), 'p1')
        .map(option => option.choice).filter(choice => choice.startsWith('move ')),
    }), observations);
    expect(seen.get(6)).toEqual({
      bisharp: { species: 'Bisharp', item: 'choicescarf', lock: 'knockoff' },
      moves: ['move knockoff'],
    });
  });

  test('751407: Dragonite holds nothing after the turn-1 Knock Off, at turn 2 and on its return at turn 14', { timeout: 240000 }, async () => {
    // Protocol facts: Deoxys's Eject Pack brings Dragonite in and Ogerpon's
    // Knock Off removes its Choice Band. The sim's Eject Pack switch brings
    // Gholdengo, the sim's Knock Off hits Gholdengo, and the active
    // correction puts Dragonite back with the Band it lost in the real game.
    const replay = fixture('smogtours-gen9ou-751407.json');
    const { observations, speedOrders } = parseReplayLogWithObservations(replay.log);
    const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders });
    pinItem(p2Team, 'Deoxys-Speed', 'Eject Pack');
    pinItem(p2Team, 'Dragonite', 'Choice Band');
    const { seen } = await boundaries(replay, p1Team, p2Team, [2, 14], battle => bodyView(battle.sides[1].active[0]));
    expect(seen.get(2)).toEqual({ species: 'Dragonite', item: '', lock: null });
    expect(seen.get(14)).toEqual({ species: 'Dragonite', item: '', lock: null });
  });

  test('doubles 938640: Sinistcha holds nothing after Incineroar\'s turn-2 Knock Off', { timeout: 240000 }, async () => {
    // Protocol facts: p2 Incineroar Parting Shots out, Sinistcha comes in and
    // p1 Incineroar's Knock Off removes its Sitrus Berry. In the sim the
    // Knock Off lands on p2 Incineroar before it leaves, so Sinistcha kept
    // the Berry on the board.
    const replay = fixture('smogtours-gen9doublesou-938640.json');
    const { observations, speedOrders } = parseReplayLogWithObservations(replay.log);
    const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders });
    pinItem(p2Team, 'Sinistcha', 'Sitrus Berry');
    const { seen } = await boundaries(replay, p1Team, p2Team, [3, 4], battle =>
      bodyView(battle.sides[1].active.find(body => body?.species.name === 'Sinistcha') ?? undefined));
    expect(seen.get(3)).toEqual({ species: 'Sinistcha', item: '', lock: null });
    expect(seen.get(4)).toEqual({ species: 'Sinistcha', item: '', lock: null });
  });
});

const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const evs = { hp: 252, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const mon = (species: string, item: string, ability: string, moves: string[]): PokemonSet => ({
  name: species, species, item, ability, moves, nature: 'Serious', evs, ivs, level: 100, teraType: 'Normal',
});

describe('doubles hand-over (round 63, T115)', () => {
  const trickLog = log([
    '|gametype|doubles', '|player|p1|Alice||', '|player|p2|Bob||', '|gen|9', '|tier|[Gen 9] Doubles OU',
    '|poke|p1|Blissey, F|', '|poke|p1|Snorlax, M|', '|poke|p2|Chansey, F|', '|poke|p2|Happiny, F|', '|start',
    '|switch|p1a: Blissey|Blissey, F|100/100',
    '|switch|p1b: Snorlax|Snorlax, M|100/100',
    '|switch|p2a: Chansey|Chansey, F|100/100',
    '|switch|p2b: Happiny|Happiny, F|100/100',
    '|turn|1',
    '|move|p1a: Blissey|Seismic Toss|p2b: Happiny',
    '|-damage|p2b: Happiny|80/100',
    '|move|p2a: Chansey|Trick|p1b: Snorlax',
    '|-activate|p2a: Chansey|move: Trick|[of] p1b: Snorlax',
    '|-item|p1b: Snorlax|Choice Scarf|[from] move: Trick',
    '|-enditem|p2a: Chansey|Choice Scarf|[silent]|[from] move: Trick',
    '|move|p1b: Snorlax|Body Slam|p2b: Happiny',
    '|-damage|p2b: Happiny|50/100',
    '|move|p2b: Happiny|Pound|p1a: Blissey',
    '|-damage|p1a: Blissey|99/100',
    '|upkeep',
    '|turn|2',
  ]);
  const p1Team = [
    mon('Blissey', '', 'Natural Cure', ['Seismic Toss', 'Soft-Boiled']),
    mon('Snorlax', '', 'Immunity', ['Body Slam', 'Rest']),
  ];
  const p2Team = (chanseyItem: string) => [
    mon('Chansey', chanseyItem, 'Natural Cure', ['Trick', 'Seismic Toss']),
    mon('Happiny', '', 'Natural Cure', ['Pound', 'Seismic Toss']),
  ];
  const replay = { id: 'synthetic-doubles-trick', format: 'gen9doublesou', formatid: 'gen9doublesou', players: ['Alice', 'Bob'], log: trickLog };

  test('a Trick hands p1b a Choice Scarf mid-turn: p1b is locked at the next boundary, its partner is not', async () => {
    // The build guessed Leftovers for Chansey; the protocol shows a Choice Scarf.
    const { runtime } = await boundaries(replay, p1Team, p2Team('Leftovers'), [1], () => null);
    expect(runtime.choiceErrors.count).toBe(0);
    const battle = runtime.battleStream.battle!;
    const [blissey, snorlax] = battle.sides[0].active;
    expect(bodyView(snorlax)).toEqual({ species: 'Snorlax', item: 'choicescarf', lock: 'bodyslam' });
    expect(lockOf(blissey)).toBeNull();
    expect(battle.sides[1].active[0]!.item).toBe('');
    const enabled = battle.sides[0].activeRequest!.active!.map(slot =>
      slot.moves.filter(move => !move.disabled).map(move => move.id));
    expect(enabled).toEqual([['seismictoss', 'softboiled'], ['bodyslam']]);
  });

  test('a board that already holds the handed item is left exactly as the sim built it', async () => {
    const stable = (battle: Battle) => serializeBattleStable(battle).replace(/\|t:\|\d+/g, '|t:|');
    const withLocks = await boundaries(replay, p1Team, p2Team('Choice Scarf'), [1], () => null);
    const snapshots = parseReplayLog(trickLog);
    const plain = await reconstructBranchRuntime({
      format: 'gen9doublesou', p1Team, p2Team: p2Team('Choice Scarf'), replayLog: trickLog,
      targetTurn: 2, snapshot: snapshots[1] ?? null,
      capturePositions: { snapshotFor: turn => snapshots[turn - 1] ?? null, onPosition: () => {} },
    });
    // The sim's own Trick and Choice Scarf already produced the protocol's board.
    expect(bodyView(withLocks.runtime.battleStream.battle!.sides[0].active[1])).toEqual({ species: 'Snorlax', item: 'choicescarf', lock: 'bodyslam' });
    expect(stable(withLocks.runtime.battleStream.battle!)).toBe(stable(plain.battleStream.battle!));
  });
});
