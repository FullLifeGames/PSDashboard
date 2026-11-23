import { readFileSync } from 'node:fs';
import { test, expect, describe } from 'vitest';
import {
  rulesDex,
  buildTeamsFromReplay,
  getBranchSimulatorFormat,
  parseReplayLog,
  parseReplayLogWithObservations,
  type SmogonUsageStats,
} from '@fulllifegames/replay-core';
import type { Battle, PokemonSet } from '@pkmn/sim';
import { buildChoiceLockContext, buildChoiceLockTrails, protocolChoiceLock } from '../src/choice-lock';
import { reconstructBranchRuntime } from '../src/branch-engine';
import { createRootPosition, serializeBattleStable } from '../src/forward-model';
import { searchOptions } from '../src/search';
import { correctBattleFromSnapshot } from '../src/branch/corrections';
import { getMainChoice } from '../src/branch/protocol-choices';

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
    expect(protocolChoiceLock(trails, 'p1', 2, rulesDex(9))).toMatchObject({ species: 'Bisharp', moveId: 'knockoff' });
  });

  test('a move before the hand-over does not lock; a handed non-Choice item does not either', () => {
    const trails = buildChoiceLockTrails(trickTurn(true));
    // Bisharp attacked before the Scarf arrived: it picks freely next turn.
    expect(protocolChoiceLock(trails, 'p1', 2, rulesDex(9))).toBeNull();
    // Latias used Trick before its Life Orb arrived; Life Orb locks nothing.
    expect(protocolChoiceLock(trails, 'p2', 2, rulesDex(9))).toBeNull();
  });

  test('a Knock Off after the hand-over leaves no lock', () => {
    const trails = buildChoiceLockTrails(trickTurn(false, true));
    expect(protocolChoiceLock(trails, 'p1', 2, rulesDex(9))).toBeNull();
  });
});

describe('held items from the protocol', () => {
  const teams = { p1Team: [] as PokemonSet[], p2Team: [] as PokemonSet[] };

  test('each body the protocol shows, with its final item, its first move since the hand-over and the block\'s touch, by species', () => {
    const context = buildChoiceLockContext(trickTurn(false), teams, []);
    expect(context.heldItems.get(2)).toEqual([
      { side: 'p1', species: 'Bisharp', item: 'choicescarf', firstMove: 'knockoff', touched: true },
      // Latias received Life Orb by Trick and lost it to Knock Off in the same turn.
      { side: 'p2', species: 'Latias', item: '', firstMove: null, touched: true },
    ]);
    // Since round 64 (T121) every boundary lists the bodies shown so far; no item line yet means null.
    expect(context.heldItems.get(1)).toEqual([
      { side: 'p1', species: 'Bisharp', item: null, firstMove: null, touched: false },
      { side: 'p2', species: 'Latias', item: null, firstMove: null, touched: false },
    ]);
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
      { side: 'p1', species: 'Alomomola', item: 'choicescarf', firstMove: null, touched: true },
      { side: 'p2', species: 'Gholdengo', item: '', firstMove: 'trick', touched: true },
    ]);
    expect(context.heldItems.get(3)).toEqual([
      { side: 'p1', species: 'Alomomola', item: '', firstMove: null, touched: true },
      { side: 'p2', species: 'Gholdengo', item: '', firstMove: 'trick', touched: false },
    ]);
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
    // Knock Off removes its Choice Band. Until round 64 the sim's Eject Pack
    // switch brought Gholdengo and the Knock Off hit Gholdengo; the board
    // follows the protocol either way (protocol-choices.spec.ts reads the switch).
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

describe('bench-hp', () => {
  const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
  const p1Team: PokemonSet[] = [
    {
      name: 'Toxapex', species: 'Toxapex', item: '', ability: 'Regenerator', moves: ['Haze', 'Recover'],
      nature: 'Bold', evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0 }, ivs, level: 100,
    },
    {
      name: 'Gliscor', species: 'Gliscor', item: '', ability: 'Hyper Cutter', moves: ['Toxic', 'Protect'],
      nature: 'Impish', evs: { hp: 244, atk: 0, def: 252, spa: 0, spd: 12, spe: 0 }, ivs, level: 100,
    },
  ];
  const p2Team: PokemonSet[] = [{
    name: 'Rotom', species: 'Rotom', item: '', ability: 'Levitate', moves: ['Thunderbolt', 'Protect'],
    nature: 'Timid', evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 }, ivs, level: 100,
  }];
  const log = [
    '|gametype|singles',
    '|player|p1|Alice||',
    '|player|p2|Bob||',
    '|gen|9',
    '|tier|[Gen 9] OU',
    '|clearpoke',
    '|poke|p1|Toxapex, F|',
    '|poke|p1|Gliscor, M|',
    '|poke|p2|Rotom|',
    '|start',
    '|switch|p1a: Toxapex|Toxapex, F|100/100',
    '|switch|p2a: Rotom|Rotom|100/100',
    '|turn|1',
    '|move|p2a: Rotom|Thunderbolt|p1a: Toxapex',
    '|-supereffective|p1a: Toxapex',
    '|-damage|p1a: Toxapex|40/100',
    '|move|p1a: Toxapex|Haze|p1a: Toxapex',
    '|-clearallboost',
    '|upkeep',
    '|turn|2',
    '|switch|p1a: Gliscor|Gliscor, M|100/100',
    '|move|p2a: Rotom|Thunderbolt|p1a: Gliscor',
    '|-immune|p1a: Gliscor',
    '|upkeep',
    '|turn|3',
  ].join('\n');

  describe('bench HP after a switch-out', () => {
    test("keeps the simulator's Regenerator heal where the protocol stopped seeing the body", async () => {
      const runtime = await reconstructBranchRuntime({
        format: 'gen9ou', p1Team, p2Team, replayLog: log, targetTurn: 3,
        snapshot: parseReplayLog(log).find(entry => entry.turn === 3) ?? null,
      });
      const battle = runtime.battleStream.battle!;
      const toxapex = battle.sides[0].pokemon.find(pokemon => pokemon.species.name === 'Toxapex')!;
      // 40% at the switch-out, plus the third Regenerator restores: about 73%.
      expect(toxapex.hp / toxapex.maxhp).toBeGreaterThan(0.7);
      expect(toxapex.hp / toxapex.maxhp).toBeLessThan(0.8);

      // The active body is still corrected from the protocol, and a benched faint still lands.
      const snapshot = parseReplayLog(log).find(entry => entry.turn === 3)!;
      const gliscor = battle.sides[0].pokemon.find(pokemon => pokemon.species.name === 'Gliscor')!;
      gliscor.hp = Math.round(gliscor.maxhp / 2);
      const stale = {
        ...snapshot,
        p1: {
          ...snapshot.p1,
          pokemon: snapshot.p1.pokemon.map(pokemon => (pokemon.speciesForme === 'Toxapex'
            ? { ...pokemon, fainted: true, hpPercent: 0, hp: 0 }
            : pokemon)),
        },
      };
      correctBattleFromSnapshot(battle, stale);
      expect(gliscor.hp).toBe(gliscor.maxhp);
      expect(toxapex.fainted).toBe(true);
      expect(toxapex.hp).toBe(0);
    });
  });

  /**
   * Round 47 (T46): the round-40 rule left a benched body to the sim on the
   * premise that the active was corrected at every boundary before it left.
   * A body that is hit and leaves within the SAME turn never meets a boundary
   * (913994 t5: Rillaboom 100 → 22 %, U-turn, the app read 100 % from then
   * on). The bench now reads the last sighting; a Regenerator holder gets its
   * third on top.
   */
  const pivotTeam = (species: 'Scizor' | 'Alomomola'): PokemonSet[] => [
    species === 'Scizor'
      ? {
        name: 'Scizor', species: 'Scizor', item: '', ability: 'Technician', moves: ['U-turn', 'Bullet Punch'],
        nature: 'Adamant', evs: { hp: 248, atk: 252, def: 0, spa: 0, spd: 8, spe: 0 }, ivs, level: 100,
      }
      : {
        name: 'Alomomola', species: 'Alomomola', item: '', ability: 'Regenerator', moves: ['Flip Turn', 'Wish'],
        nature: 'Relaxed', evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0 }, ivs, level: 100,
      },
    p1Team[1],
  ];
  const pivotLog = (species: 'Scizor' | 'Alomomola', gender: string, move: string, hpLeft: number) => [
    '|gametype|singles',
    '|player|p1|Alice||',
    '|player|p2|Bob||',
    '|gen|9',
    '|tier|[Gen 9] OU',
    '|clearpoke',
    `|poke|p1|${species}, ${gender}|`,
    '|poke|p1|Gliscor, M|',
    '|poke|p2|Rotom|',
    '|start',
    `|switch|p1a: ${species}|${species}, ${gender}|100/100`,
    '|switch|p2a: Rotom|Rotom|100/100',
    '|turn|1',
    `|move|p2a: Rotom|Thunderbolt|p1a: ${species}`,
    `|-damage|p1a: ${species}|${hpLeft}/100`,
    `|move|p1a: ${species}|${move}|p2a: Rotom`,
    '|-damage|p2a: Rotom|80/100',
    `|switch|p1a: Gliscor|Gliscor, M|100/100|[from] ${move}`,
    '|upkeep',
    '|turn|2',
    '|move|p2a: Rotom|Protect|p2a: Rotom',
    '|-singleturn|p2a: Rotom|Protect',
    '|move|p1a: Gliscor|Protect|p1a: Gliscor',
    '|-singleturn|p1a: Gliscor|Protect',
    '|upkeep',
    '|turn|3',
  ].join('\n');

  describe('bench HP of a body that was hit and left in the same turn (round 47)', () => {
    const benchFraction = async (species: 'Scizor' | 'Alomomola', log: string, everyBoundary: boolean) => {
      const snapshots = parseReplayLog(log);
      const snapshotFor = (turn: number) => snapshots.find(entry => entry.turn === turn) ?? null;
      const runtime = await reconstructBranchRuntime({
        format: 'gen9ou', p1Team: pivotTeam(species), p2Team, replayLog: log, targetTurn: 3, snapshot: snapshotFor(3),
        ...(everyBoundary ? { capturePositions: { snapshotFor, onPosition: () => {} } } : {}),
      });
      const body = runtime.battleStream.battle!.sides[0].pokemon.find(pokemon => pokemon.species.name === species)!;
      return body.hp / body.maxhp;
    };

    test('the protocol HP at the departure stands, not the sim roll of the hit', async () => {
      // The protocol saw Scizor leave at 22 %; the sim's own Thunderbolt leaves it near 60 %.
      const log = pivotLog('Scizor', 'M', 'U-turn', 22);
      expect(await benchFraction('Scizor', log, false)).toBeCloseTo(0.22, 2);
    });

    test('a Regenerator holder gets its third on top of the last sighting', async () => {
      // Alomomola left at 20 %: 20 % plus a third, whatever the sim rolled for the hit.
      const log = pivotLog('Alomomola', 'F', 'Flip Turn', 20);
      const fraction = await benchFraction('Alomomola', log, false);
      expect(fraction).toBeGreaterThan(0.52);
      expect(fraction).toBeLessThan(0.545);
    });

    test('the bench reads the same with and without a correction at every boundary', async () => {
      // The round-40 premise, pinned: the rule no longer leans on the capture path.
      const log = pivotLog('Scizor', 'M', 'U-turn', 22);
      expect(await benchFraction('Scizor', log, true)).toBeCloseTo(await benchFraction('Scizor', log, false), 8);
    });
  });
});

describe('a gimmick click on a turn without an action line (round 54)', () => {
  test('replays a Terastallization on a turn the body flinched out of its move', async () => {
    const set = (species: string, ability: string, moves: string[], teraType: string): PokemonSet => ({
      name: species, species, item: '', ability, moves,
      nature: 'Adamant',
      evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      level: 100,
      teraType,
    });
    const log = [
      '|gametype|singles',
      '|player|p1|Alice||',
      '|player|p2|Bob||',
      '|gen|9',
      '|tier|[Gen 9] OU',
      '|poke|p1|Snorlax, M|',
      '|poke|p2|Hitmontop, M|',
      '|start',
      '|switch|p1a: Snorlax|Snorlax, M|100/100',
      '|switch|p2a: Hitmontop|Hitmontop, M|100/100',
      '|turn|1',
      '|-terastallize|p1a: Snorlax|Water',
      '|move|p2a: Hitmontop|Fake Out|p1a: Snorlax',
      '|-damage|p1a: Snorlax|95/100',
      '|cant|p1a: Snorlax|flinch',
      '|upkeep',
      '|turn|2',
    ].join('\n');

    const runtime = await reconstructBranchRuntime({
      format: 'gen9ou',
      p1Team: [set('Snorlax', 'Immunity', ['Tackle', 'Rest'], 'Water')],
      p2Team: [set('Hitmontop', 'Technician', ['Fake Out', 'Close Combat'], 'Fighting')],
      replayLog: log,
      targetTurn: 2,
    });
    const snorlax = runtime.battleStream.battle!.sides[0].active[0]!;
    expect(snorlax.terastallized).toBe('Water');
    expect(snorlax.canTerastallize).toBeFalsy();
  });

  test('doubles: the flinched slot terastallizes, its partner does not', async () => {
    const set = (species: string, ability: string, moves: string[], teraType: string): PokemonSet => ({
      name: species, species, item: '', ability, moves,
      nature: 'Adamant',
      evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      level: 100,
      teraType,
    });
    const log = [
      '|gametype|doubles',
      '|player|p1|Alice||',
      '|player|p2|Bob||',
      '|gen|9',
      '|tier|[Gen 9] Doubles OU',
      '|poke|p1|Blissey, F|',
      '|poke|p1|Snorlax, M|',
      '|poke|p2|Hitmontop, M|',
      '|poke|p2|Chansey, F|',
      '|start',
      '|switch|p1a: Blissey|Blissey, F|100/100',
      '|switch|p1b: Snorlax|Snorlax, M|100/100',
      '|switch|p2a: Hitmontop|Hitmontop, M|100/100',
      '|switch|p2b: Chansey|Chansey, F|100/100',
      '|turn|1',
      '|-terastallize|p1b: Snorlax|Water',
      '|move|p2a: Hitmontop|Fake Out|p1b: Snorlax',
      '|-damage|p1b: Snorlax|95/100',
      '|move|p1a: Blissey|Seismic Toss|p2a: Hitmontop',
      '|-damage|p2a: Hitmontop|70/100',
      '|cant|p1b: Snorlax|flinch',
      '|move|p2b: Chansey|Seismic Toss|p1a: Blissey',
      '|-damage|p1a: Blissey|85/100',
      '|upkeep',
      '|turn|2',
    ].join('\n');

    const runtime = await reconstructBranchRuntime({
      format: 'gen9doublesou',
      p1Team: [set('Blissey', 'Natural Cure', ['Seismic Toss'], 'Fairy'), set('Snorlax', 'Immunity', ['Tackle', 'Rest'], 'Water')],
      p2Team: [set('Hitmontop', 'Technician', ['Fake Out', 'Close Combat'], 'Fighting'), set('Chansey', 'Natural Cure', ['Seismic Toss'], 'Fairy')],
      replayLog: log,
      targetTurn: 2,
    });
    const [blissey, snorlax] = runtime.battleStream.battle!.sides[0].active;
    expect(snorlax!.terastallized).toBe('Water');
    expect(blissey!.terastallized).toBeFalsy();
    expect(runtime.choiceErrors.count).toBe(0);
  });

  test('a Mega Evolution on a flinched turn is replayed the same way', async () => {
    const set = (species: string, moves: string[], item = ''): PokemonSet => ({
      name: species, species, item, ability: '', moves,
      nature: 'Adamant',
      evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      level: 100,
    });
    const log = [
      '|gametype|singles',
      '|player|p1|Alice||',
      '|player|p2|Bob||',
      '|gen|7',
      '|tier|[Gen 7] OU',
      '|poke|p1|Scizor, M|',
      '|poke|p2|Hitmontop, M|',
      '|start',
      '|switch|p1a: Scizor|Scizor, M|100/100',
      '|switch|p2a: Hitmontop|Hitmontop, M|100/100',
      '|turn|1',
      '|detailschange|p1a: Scizor|Scizor-Mega, M',
      '|-mega|p1a: Scizor|Scizor|Scizorite',
      '|move|p2a: Hitmontop|Fake Out|p1a: Scizor',
      '|-damage|p1a: Scizor|95/100',
      '|cant|p1a: Scizor|flinch',
      '|upkeep',
      '|turn|2',
    ].join('\n');

    const runtime = await reconstructBranchRuntime({
      format: 'gen7ou',
      p1Team: [{ ...set('Scizor', ['Bullet Punch'], 'Scizorite'), ability: 'Technician' }],
      p2Team: [{ ...set('Hitmontop', ['Fake Out', 'Close Combat']), ability: 'Technician' }],
      replayLog: log,
      targetTurn: 2,
    });
    const scizor = runtime.battleStream.battle!.sides[0].active[0]!;
    expect(scizor.species.name).toBe('Scizor-Mega');
  });

  // `pass` takes no modifier: the sim rejects "pass terastallize", and a
  // rejected side choice is answered with its default for BOTH slots. The
  // state needs a fainted active whose side still holds its Tera, which only
  // doubles with an empty bench produces (a singles side with a fainted
  // active gets a forced switch, or the battle ends).
  test('a fainted slot passes without a gimmick suffix', async () => {
    const set = (species: string, moves: string[], level: number): PokemonSet => ({
      name: species, species, item: '', ability: '', moves,
      nature: 'Adamant',
      evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      level,
      teraType: 'Water',
    });
    const log = [
      '|gametype|doubles',
      '|player|p1|Alice||',
      '|player|p2|Bob||',
      '|gen|9',
      '|tier|[Gen 9] Doubles OU',
      '|poke|p1|Blissey, F|',
      '|poke|p1|Snorlax, L1, M|',
      '|poke|p2|Hitmontop, M|',
      '|poke|p2|Chansey, F|',
      '|start',
      '|switch|p1a: Blissey|Blissey, F|100/100',
      '|switch|p1b: Snorlax|Snorlax, L1, M|100/100',
      '|switch|p2a: Hitmontop|Hitmontop, M|100/100',
      '|switch|p2b: Chansey|Chansey, F|100/100',
      '|turn|1',
      '|move|p2a: Hitmontop|Close Combat|p1b: Snorlax',
      '|-damage|p1b: Snorlax|0 fnt',
      '|faint|p1b: Snorlax',
      '|move|p1a: Blissey|Seismic Toss|p2a: Hitmontop',
      '|-damage|p2a: Hitmontop|70/100',
      '|move|p2b: Chansey|Seismic Toss|p1a: Blissey',
      '|-damage|p1a: Blissey|85/100',
      '|upkeep',
      '|turn|2',
    ].join('\n');

    const runtime = await reconstructBranchRuntime({
      format: 'gen9doublesou',
      p1Team: [set('Blissey', ['Seismic Toss'], 100), set('Snorlax', ['Tackle'], 1)],
      p2Team: [set('Hitmontop', ['Close Combat', 'Fake Out'], 100), set('Chansey', ['Seismic Toss'], 100)],
      replayLog: log,
      targetTurn: 2,
    });
    const battle = runtime.battleStream.battle!;
    expect(battle.sides[0].active[1]!.fainted).toBe(true);
    expect(battle.sides[0].active[1]!.canTerastallize).toBeTruthy();
    expect(getMainChoice(['|-terastallize|p1b: Snorlax|Water'], 'p1', battle).split(', ')[1]).toBe('pass');
  });
});
