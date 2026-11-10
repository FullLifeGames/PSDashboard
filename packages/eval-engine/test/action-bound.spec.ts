import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { Battle } from '@pkmn/sim';
import {
  buildTeamsFromReplay, getBranchSimulatorFormat, logRules, parseReplayLog, parseReplayLogWithObservations, replayBringOnly, type ReplayData,
} from '@fulllifegames/replay-core';
import { buildChoiceLockContext } from '../src/choice-lock';
import { reconstructBranchRuntime } from '../src/branch-engine';
import { getMainChoice, parseTurnBlocks } from '../src/branch/protocol-choices';
import { certainlyBehind, certainlyFirst, playedBoundsOf, ruledOutMoves } from '../src/branch/action-bound';
import type { SimBattle } from '../src/branch/types';
import { loadSimMods } from '../src/forward/sim-mods';
import { copyOf, FixedDice } from '../src/sim-ask/copy';
import { parsePlayedActions, parsePlayedActionsDoubles, turnEvents, type FellMark } from '../src/played';
import { CHAMPIONS, mon, playClicks, RULES, type Rules } from './dice-fixtures';
import { battleOf } from './power-oracle';

/**
 * Round 89 (#108): the order bound of a body that fell before it acted. `ruledOutMoves` reads the simulator's queue for the body's
 * moves and the logged actions before its fall (`queuePlace`, the dice answered by `activated`): a move is out when it stands
 * certainly ahead of one of them (a higher priority bracket, or the same bracket and a higher speed while no line moved a speed; a tie
 * is no proof), and a chosen switch is out whenever the log shows an action before the fall. The rows play every move of the body against
 * the logged action on a copy under both answers of the dice: the moves ruled out are exactly the moves that act first under both.
 * Rows: doubles 2710981835 turn 7 (the report of #108), singles smogtours-gen9ou-671362 turn 9 (Prankster Grafaiai) and Champions
 * singles gen9championsou-2691527224 turn 14 (Rillaboom's Grassy Glide in Grassy Terrain).
 */
await loadSimMods('gen9championsou');

const ANSWERS = [false, true] as const;
const rules = logRules('');

describe('the shared order rules', () => {
  const other = { priority: 0, speed: 100 };
  test('a higher bracket is first, a lower one is behind', () => {
    expect([certainlyFirst(1, 50, other), certainlyBehind(1, 50, other)]).toEqual([true, false]);
    expect([certainlyFirst(-1, 150, other), certainlyBehind(-1, 150, other)]).toEqual([false, true]);
  });
  test('the same bracket goes by speed, a tie of speed proves nothing, and a body off the field has no speed', () => {
    expect([certainlyFirst(0, 101, other), certainlyBehind(0, 99, other)]).toEqual([true, true]);
    expect([certainlyFirst(0, 100, other), certainlyBehind(0, 100, other)]).toEqual([false, false]);
    expect([certainlyFirst(0, 500, { priority: 0, speed: null }), certainlyBehind(0, 1, { priority: 0, speed: null })]).toEqual([false, false]);
  });
  test('without a speed proof only the bracket counts', () => {
    expect([certainlyFirst(0, 101, other, false), certainlyFirst(1, 1, other, false)]).toEqual([false, true]);
  });
});

/** Whether `own` acts ahead of the foe's logged action in one turn on a copy: true ahead, false behind or never (knocked out first). */
function actsFirst(board: Battle, clicks: { p1: string; p2: string }, ownSlot: string, foeSlot: string, chance: boolean): boolean {
  const copy = copyOf(board);
  copy.prng = new FixedDice({ chance });
  const start = copy.log.length;
  playClicks(copy, clicks);
  const lines = copy.log.slice(start);
  const own = lines.findIndex(line => line.startsWith(`|move|${ownSlot}:`));
  const foe = lines.findIndex(line => line.startsWith(`|move|${foeSlot}:`));
  return own >= 0 && (foe < 0 || own < foe);
}

/** The moves of the body of side 0, slot a, that act ahead of the foe's action under both answers of the dice. */
function firstUnderBoth(board: Battle, click: (id: string, slot: number) => { p1: string; p2: string }, ownSlot: string, foeSlot: string): string[] {
  const body = board.sides[0].active[0]!;
  return body.moveSlots.map(slot => slot.id).filter((id, index) =>
    ANSWERS.every(chance => actsFirst(board, click(id, index + 1), ownSlot, foeSlot, chance))).sort();
}

describe('doubles: replay 2710981835 turn 7', () => {
  const replay = JSON.parse(readFileSync(new URL('./fixtures/gen9championsvgc2026regmc-2710981835.json', import.meta.url), 'utf-8')) as ReplayData;
  const REPORTED_SET = ['extremespeed', 'dragonpulse', 'thunderbolt', 'protect'];

  async function sceneOf(dragonite?: string[]): Promise<{ battle: SimBattle; preUpkeep: string[] }> {
    await loadSimMods(getBranchSimulatorFormat(replay));
    const { snapshots, observations, speedOrders } = parseReplayLogWithObservations(replay.log);
    const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders });
    if (dragonite) p1Team.find(set => set.species.startsWith('Dragonite'))!.moves = dragonite;
    const runtime = await reconstructBranchRuntime({
      format: getBranchSimulatorFormat(replay), p1Team, p2Team, replayLog: replay.log, targetTurn: 7, snapshot: snapshots[6] ?? null,
      playerNames: [replay.players[0], replay.players[1]],
      choiceLocks: buildChoiceLockContext(replay.log, { p1Team, p2Team }, observations),
      bringOnly: replayBringOnly(replay, parseReplayLog(replay.log)) ?? undefined,
      deadlineMs: 120_000,
    });
    const preUpkeep = parseTurnBlocks(replay.log).turns.find(turn => turn.turn === 7)!.preUpkeep;
    return { battle: runtime.battleStream.battle as unknown as SimBattle, preUpkeep };
  }

  const mark = (): FellMark => {
    const turn = parsePlayedActionsDoubles(turnEvents(replay.log, 7));
    return turn.fell!.p1![0]!;
  };

  test('the parse of the turn marks Dragonite after Floette\'s Dazzling Gleam, with no speed line before the fall', () => {
    expect(mark().before).toEqual([{ slot: 'p2a', move: 'Dazzling Gleam' }]);
    expect(mark().speedMoved).toBe(false);
  });

  test.each([
    ['the teams the log gives', undefined, ['dragonpulse', 'thunderbolt']],
    ['the moves of the report', REPORTED_SET, REPORTED_SET],
  ] as [string, string[] | undefined, string[]][])('with %s the bound rules out the moves that act ahead of Floette', async (_name, moves, held) => {
    const scene = await sceneOf(moves);
    const board = scene.battle as unknown as Battle;
    const dragonite = scene.battle.sides[0].active[0]!;
    expect(dragonite.moveSlots.map(slot => slot.id).sort()).toEqual([...held].sort());
    const before = JSON.stringify(board.toJSON());
    const bound = ruledOutMoves(scene.battle, dragonite, mark());
    expect(JSON.stringify(board.toJSON())).toBe(before);
    const p2 = getMainChoice(scene.preUpkeep, 'p2', scene.battle);
    const click = (id: string, index: number) => ({
      p1: `${board.dex.moves.get(id).target === 'self' ? `move ${index}` : `move ${index} 1`}, move 1 1`, p2,
    });
    const acting = firstUnderBoth(board, click, 'p1a', 'p2a');
    expect([...bound.moves].sort()).toEqual(acting);
    expect(bound.switchOut).toBe(true);
    // The report: Extreme Speed (+2) and Protect (+4) are out, Dragon Pulse and Thunderbolt are not.
    expect(bound.moves.every(id => ['extremespeed', 'protect'].includes(id))).toBe(true);
    if (moves) expect([...bound.moves].sort()).toEqual(['extremespeed', 'protect']);
    else expect(bound.moves).toEqual([]);
  }, 240_000);

  test('the bounds of the turn: the fallen slot gets its bound, the others none, and a turn without a fall none at all', async () => {
    const scene = await sceneOf(REPORTED_SET);
    const turn = parsePlayedActionsDoubles(turnEvents(replay.log, 7));
    expect(playedBoundsOf(scene.battle, turn.fell)).toEqual({ p1: [{ moves: ['extremespeed', 'protect'], switchOut: true }, null] });
    expect(playedBoundsOf(scene.battle, undefined)).toBeUndefined();
    expect(playedBoundsOf(scene.battle, parsePlayedActionsDoubles(['|move|p1a: Dragonite|Dragon Pulse|p2a: Floette']).fell)).toBeUndefined();
  }, 240_000);

  test('a speed proof stands only while no line before the fall moved a speed', async () => {
    const scene = await sceneOf();
    const dragonite = scene.battle.sides[0].active[0]!;
    const floette = scene.battle.sides[1].active[0]!;
    expect(dragonite.getActionSpeed()).toBeLessThan(floette.getActionSpeed());
    // The mover is faster than the body: no move of the body is certainly ahead, with or without the speed proof.
    for (const speedMoved of [false, true]) {
      expect(ruledOutMoves(scene.battle, dragonite, { ...mark(), speedMoved }).moves).toEqual([]);
    }
  }, 240_000);
});

interface Row {
  name: string;
  scene: string;
  rules: Rules;
  body: { species: string; ability: string; item: string; moves: string[] };
  foe: { species: string; move: string; item?: string };
  grassy?: boolean;
  /** The moves the Dex gives the first bracket of the body's queue: those that must be out. */
  expected: string[];
}
const GEN9 = RULES.find(entry => entry.generation === 9 && entry !== CHAMPIONS)!;
const ROWS: Row[] = [
  { name: 'Prankster Parting Shot', scene: 'smogtours-gen9ou-671362 turn 9 p2a', rules: GEN9,
    body: { species: 'Grafaiai', ability: 'prankster', item: 'choiceband', moves: ['partingshot', 'lowkick', 'foulplay', 'gunkshot'] },
    foe: { species: 'Iron Valiant', move: 'psyshock' }, expected: ['partingshot'] },
  { name: 'Grassy Glide in Grassy Terrain (Champions)', scene: 'gen9championsou-2691527224 turn 14 p2a', rules: CHAMPIONS,
    body: { species: 'Rillaboom', ability: 'grassysurge', item: 'rockyhelmet', moves: ['grassyglide', 'uturn', 'knockoff', 'swordsdance'] },
    foe: { species: 'Meowscarada', move: 'uturn' }, grassy: true, expected: ['grassyglide'] },
];

function boardOfRow(row: Row, foe = row.foe): Battle {
  const body = { ...mon(row.rules, { species: row.body.species, moves: row.body.moves, gender: 'M' }), ability: row.body.ability, item: row.body.item };
  const other = mon(row.rules, { species: foe.species, moves: [foe.move], gender: 'M' });
  const board = battleOf(row.rules.singles, [body], [other]);
  if (row.grassy) board.field.setTerrain('grassyterrain', board.sides[0].active[0]);
  return board;
}

/** The mark the parse gives for the row's turn: the foe's move, the lines of `extra`, then the fall of the body. */
function markOf(row: Row, board: Battle, extra: string[] = []): FellMark {
  const lines = [`|move|p2a: ${row.foe.species}|${board.dex.moves.get(row.foe.move).name}|p1a: ${row.body.species}`, ...extra, `|faint|p1a: ${row.body.species}`];
  return parsePlayedActions(lines, rules).fell!.p1![0]!;
}

describe.each(ROWS)('singles: $name ($scene)', row => {
  const click = (_id: string, index: number) => ({ p1: `move ${index}`, p2: 'move 1' });

  test('the moves ruled out are the moves that act ahead of the foe under both answers of the dice', () => {
    const board = boardOfRow(row);
    const body = board.sides[0].active[0]!;
    const before = JSON.stringify(board.toJSON());
    const bound = ruledOutMoves(board as unknown as SimBattle, body, markOf(row, board));
    expect(JSON.stringify(board.toJSON())).toBe(before);
    expect([...bound.moves].sort()).toEqual(firstUnderBoth(board, click, 'p1a', 'p2a'));
    expect([...bound.moves].sort()).toEqual(row.expected);
    expect(bound.switchOut).toBe(true);
  });

  test('a line that can move a speed leaves only the bracket proof', () => {
    const board = boardOfRow(row);
    const body = board.sides[0].active[0]!;
    const bound = ruledOutMoves(board as unknown as SimBattle, body, markOf(row, board, [`|-unboost|p2a: ${row.foe.species}|spe|1`]));
    expect([...bound.moves].sort()).toEqual(row.expected);
  });
});

describe('singles: the bounds of the turn', () => {
  test('the side that fell gets one slot, the other side none', () => {
    const row = ROWS[0];
    const board = boardOfRow(row);
    const lines = [`|move|p2a: ${row.foe.species}|Psyshock|p1a: ${row.body.species}`, `|faint|p1a: ${row.body.species}`];
    expect(playedBoundsOf(board as unknown as SimBattle, parsePlayedActions(lines, rules).fell)).toEqual({ p1: [{ moves: ['partingshot'], switchOut: true }] });
  });
});

describe('singles: a body that is faster than the foe and has no priority move', () => {
  const row: Row = { name: 'faster', scene: 'constructed', rules: GEN9,
    body: { species: 'Grafaiai', ability: 'poisontouch', item: 'choiceband', moves: ['lowkick', 'foulplay', 'gunkshot'] },
    foe: { species: 'Snorlax', move: 'bodyslam' }, expected: [] };

  test('every move stands ahead by speed while no line moved one; a speed line takes that proof back', () => {
    const board = boardOfRow(row);
    const body = board.sides[0].active[0]!;
    const sure = ruledOutMoves(board as unknown as SimBattle, body, markOf(row, board));
    expect([...sure.moves].sort()).toEqual(['foulplay', 'gunkshot', 'lowkick']);
    expect([...sure.moves].sort()).toEqual(firstUnderBoth(board, (_id, index) => ({ p1: `move ${index}`, p2: 'move 1' }), 'p1a', 'p2a'));
    expect(ruledOutMoves(board as unknown as SimBattle, body, markOf(row, board, ['|-unboost|p2a: Snorlax|spe|1'])).moves).toEqual([]);
  });
});

describe('the bound abstains when the log\'s own order contradicts the queue', () => {
  test('an earlier action that the queue puts behind a later one means the queue was moved', () => {
    const row = ROWS[0];
    const board = boardOfRow(row);
    const body = board.sides[0].active[0]!;
    const mark: FellMark = {
      before: [{ slot: 'p2a', move: 'Psyshock' }, { slot: 'p2a', move: 'Quick Attack' }], speedMoved: false, activations: [],
    };
    expect(ruledOutMoves(board as unknown as SimBattle, body, mark)).toEqual({ moves: [], switchOut: false });
  });

  test('no earlier action, no proof', () => {
    const row = ROWS[0];
    const board = boardOfRow(row);
    expect(ruledOutMoves(board as unknown as SimBattle, board.sides[0].active[0]!, { before: [], speedMoved: false, activations: [] }))
      .toEqual({ moves: [], switchOut: false });
  });
});
