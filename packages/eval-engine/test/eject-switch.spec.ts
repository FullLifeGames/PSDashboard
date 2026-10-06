import { readFileSync } from 'fs';
import { test, expect, describe } from 'vitest';
import type { Battle, PokemonSet } from '@pkmn/sim';
import {
  buildTeamsFromReplay, getBranchSimulatorFormat, parseReplayLog, parseReplayLogWithObservations, replayBringOnly,
} from '@fulllifegames/replay-core';
import { buildChoiceLockContext } from '../src/choice-lock';
import { reconstructBranchRuntime } from '../src/branch-engine';
import { collectForcedSwitchSpecies, parseTurnBlocks } from '../src/branch/protocol-choices';

/**
 * Round 64 (T121): an Eject Pack or Eject Button switch is the protocol's
 * answer to a request the slot's own item made. The simulator writes
 * `[from]` on a switch only for a move's selfSwitch; an item's switch
 * follows its `|-enditem|` on the slot. Before, the forced list skipped
 * those switches and the sim brought its first free body (751407 t1:
 * Gholdengo instead of Dragonite, and Ogerpon's Knock Off took Gholdengo's
 * Choice Scarf), and a holder hit before it acted had the ejection switch
 * sent as its turn's choice.
 */

type Replay = { id: string; format: string; formatid?: string; players: string[]; log: string };
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf-8')) as Replay;
const block = (replay: Replay, turn: number) => parseTurnBlocks(replay.log).turns.find(entry => entry.turn === turn)!;

describe('the forced list reads the switch an item made', () => {
  test('an Eject Pack or Eject Button switch-in joins the forced list', () => {
    const singles = block(fixture('smogtours-gen9ou-751407.json'), 1);
    expect(collectForcedSwitchSpecies(singles.preUpkeep, singles.postUpkeep, 'p2')).toEqual(['Dragonite']);
    // Doubles: Sinistcha's own switch-in is p2's choice; its Eject Button
    // brings Ninetales-Alola, and the faint replacement after upkeep follows.
    const doubles = block(fixture('gen9vgc2026regi-2630181744.json'), 3);
    expect(collectForcedSwitchSpecies(doubles.preUpkeep, doubles.postUpkeep, 'p2'))
      .toEqual(['Ninetales-Alola', 'Sinistcha-Masterpiece']);
  });

  test('a chosen switch after an Intimidate drop or a berry stays the side\'s choice', () => {
    const intimidated = [
      '|switch|p1a: Landorus|Landorus-Therian, M|100/100',
      '|-ability|p1a: Landorus|Intimidate|boost',
      '|-unboost|p2a: Hatterene|atk|1',
      '|switch|p2a: Ting-Lu|Ting-Lu|100/100',
    ];
    expect(collectForcedSwitchSpecies(intimidated, [], 'p2')).toEqual([]);
    const berry = [
      '|move|p2a: Weavile|Pursuit|p1a: Latias|[from]Pursuit',
      '|-damage|p1a: Latias|40/100',
      '|-enditem|p1a: Latias|Sitrus Berry|[eat]',
      '|-heal|p1a: Latias|65/100|[from] item: Sitrus Berry',
      '|switch|p1a: Ferrothorn|Ferrothorn|100/100',
    ];
    expect(collectForcedSwitchSpecies(berry, [], 'p1')).toEqual([]);
  });
});

/** The sim's own public log of the block that ends at `|turn|boundary`. */
function simBlock(battle: Battle, boundary: number): string[] {
  const log = battle.log;
  const end = log.lastIndexOf(`|turn|${boundary}`);
  const start = log.lastIndexOf(`|turn|${boundary - 1}`, end);
  return log.slice(start + 1, end).filter((line, index, all) => !line.startsWith('|split|') && !all[index - 1]?.startsWith('|split|'));
}

/** The species of the first switch-in on `slot` after the item line `item` left it. */
function switchAfterItem(lines: string[], slot: string, item: string): string | null {
  const itemIndex = lines.findIndex(line => line.startsWith(`|-enditem|${slot}:`) && line.split('|')[3] === item);
  if (itemIndex < 0) return null;
  const switchLine = lines.slice(itemIndex).find(line => line.startsWith(`|switch|${slot}:`));
  return switchLine?.split('|')[3].split(',')[0].trim() ?? null;
}

/**
 * The live pass the app and the bank run (boundary capture with snapshot
 * correction, choice locks on); `read` sees each listed boundary's board.
 */
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

describe('the sim brings the body the protocol shows (round 64, T121)', () => {
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
    // Protocol facts: Garganacl's Salt Cure hits Hatterene, its Eject Button
    // brings Walking Wake. The player's click for Hatterene is unknown; the
    // ejection switch is no choice of the side.
    const replay = fixture('gen9ou-2658662321.json');
    const { p1Team, p2Team } = builtTeams(replay, [['p2', 'Hatterene', 'Eject Button']]);
    const { seen } = await boundaries(replay, p1Team, p2Team, [3], battle => {
      const lines = simBlock(battle, 3);
      return {
        saltCure: lines.find(line => line.startsWith('|-start|') && line.includes('Salt Cure'))?.split('|')[2].split(': ')[1] ?? null,
        ejected: switchAfterItem(lines, 'p2a', 'Eject Button'),
        walkingWakeCured: 'saltcure' in body(battle, 1, 'Walking Wake').volatiles,
        hatterene: body(battle, 1, 'Hatterene').item,
      };
    });
    expect(seen.get(3)).toEqual({ saltCure: 'Hatterene', ejected: 'Walking Wake', walkingWakeCured: false, hatterene: '' });
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
