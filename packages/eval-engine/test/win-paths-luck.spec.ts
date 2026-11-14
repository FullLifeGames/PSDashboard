import { describe, expect, test } from 'vitest';
import { luckPath } from '../src/endgame/win-paths/luck';
import { WinMeter } from '../src/endgame/win-paths/budget';
import { dieKey } from '../src/dice/types';
import type { EvalLine } from '../src/types';
import { fingerprint } from './power-oracle';
import { mon, playLine, REQUEST, serializedBoard, won, type Board } from './win-paths-support';

/**
 * Round 89 (#130), step G6: the luck step. Boards are small custom games whose bodies the spec sets, so every number is one the
 * simulator shows on that board: an accuracy of the Dex, the one-in-24 crit of Gen 9, a speed tie's one half. Singles and doubles.
 */
/** Singles 1 v 1: Snorlax (slow) with High Jump Kick (90) against a faster Pikachu with Hydro Pump (80); both fall to any hit. */
const COIN: Board = {
  format: 'gen9customgame',
  p1: [mon('Snorlax', ['High Jump Kick'])],
  p2: [mon('Pikachu', ['Hydro Pump'])],
  prepare: battle => { battle.sides[0].pokemon[0].hp = 1; battle.sides[1].pokemon[0].hp = 1; },
};

/** Two turns: Seismic Toss (fixed 50) needs two hits on a 100 HP Pikachu, and Hydro Pump (80) kills the 1 HP Snorlax. */
const TWO_TURNS: Board = {
  format: 'gen9customgame',
  p1: [mon('Snorlax', ['Seismic Toss'])],
  p2: [mon('Pikachu', ['Hydro Pump'])],
  prepare: battle => { battle.sides[0].pokemon[0].hp = 1; battle.sides[1].pokemon[0].hp = 100; },
};

const diceOf = (line: EvalLine) => line.steps.flatMap(step => step.dice);
const named = (line: EvalLine, kind: string) => diceOf(line).filter(entry => entry.die.name.kind === kind);

describe('the luck step, singles', () => {
  test('(a) a win that needs the foe\'s 80 percent move to miss and the own 90 percent move to hit pins those two dice', async () => {
    const { serialized } = await serializedBoard(COIN);
    const step = luckPath(serialized, REQUEST('p1'));
    expect(step.status).toBe('found');
    expect(step.chance).toBeCloseTo(0.2 * 0.9, 12);
    const accuracy = named(step.line!, 'accuracy');
    expect(accuracy.map(entry => [entry.die.name.slot, 'happens' in entry.die.result && entry.die.result.happens])).toEqual([['p2a', false], ['p1a', true]]);
    expect(accuracy.map(entry => entry.chance)).toEqual([expect.closeTo(0.2, 12), expect.closeTo(0.9, 12)]);
    expect(step.line!.steps).toHaveLength(1);
    expect(step.spent.cells).toBeGreaterThan(0);
    expect(step.spent.turns).toBeGreaterThan(0);
  }, 60_000);

  test('(a) the same board for the other side: the faster side wins at its likeliest dice, so the path is its 80 percent hit', async () => {
    const { serialized } = await serializedBoard(COIN);
    const step = luckPath(serialized, REQUEST('p2'));
    expect(step.status).toBe('found');
    expect(step.chance).toBeCloseTo(0.8, 12);
  }, 60_000);

  test('(b) a path of two turns: the foe misses twice, the own fixed hit lands twice', async () => {
    const { serialized } = await serializedBoard(TWO_TURNS);
    const step = luckPath(serialized, REQUEST('p1'));
    expect(step.status).toBe('found');
    expect(step.chance).toBeCloseTo(0.2 * 0.2, 12);
    expect(step.line!.steps).toHaveLength(2);
    for (const entry of step.line!.steps) expect(entry.dice.map(item => [item.die.name.kind, 'happens' in item.die.result && item.die.result.happens])).toEqual([['accuracy', false]]);
  }, 60_000);

  test('(e) none: four fixed hits are needed and the path may take three turns', async () => {
    const board: Board = { ...TWO_TURNS, prepare: battle => { battle.sides[0].pokemon[0].hp = 1000; battle.sides[1].pokemon[0].hp = 200; } };
    const { serialized } = await serializedBoard({ ...board, p2: [mon('Pikachu', ['Splash'])] });
    const step = luckPath(serialized, REQUEST('p1'));
    expect(step).toMatchObject({ kind: 'luck', status: 'none' });
    expect(step.line).toBeUndefined();
    // the same board with four turns allowed finds the win
    const four = luckPath(serialized, REQUEST('p1', { turns: 4 }));
    expect(four.status).toBe('found');
    expect(four.chance).toBe(1);
    expect(four.line!.steps).toHaveLength(4);
  }, 60_000);

  test('(f) a budget the search cannot finish in stops it at the cap and says so', async () => {
    const { serialized } = await serializedBoard(TWO_TURNS);
    const meter = new WinMeter({ turns: 2 });
    const step = luckPath(serialized, REQUEST('p1'), meter);
    expect(step.status).toBe('stopped');
    expect(step.line).toBeUndefined();
    expect(step.spent.turns).toBeGreaterThanOrEqual(2);
    expect(step.spent.turns).toBeLessThanOrEqual(2 + 12);
  }, 60_000);

  test('(f) a floor above the path leaves nothing to search', async () => {
    const { serialized } = await serializedBoard(TWO_TURNS);
    expect(luckPath(serialized, REQUEST('p1', { floor: 0.05 })).status).toBe('none');
    expect(luckPath(serialized, REQUEST('p1', { floor: 0.039 })).status).toBe('found');
  }, 60_000);

  test('(g) the live battle stays as it was, two runs agree', async () => {
    const { runtime, serialized } = await serializedBoard(COIN);
    const battle = runtime.battleStream.battle!;
    const before = fingerprint(battle, battle.sides.flatMap(side => side.pokemon), 'highjumpkick');
    const one = luckPath(serialized, REQUEST('p1'));
    const two = luckPath(serialized, REQUEST('p1'));
    expect(fingerprint(battle, battle.sides.flatMap(side => side.pokemon), 'highjumpkick')).toBe(before);
    expect(JSON.stringify(two)).toBe(JSON.stringify(one));
  }, 60_000);

  test('(h) the line plays through the branch engine to the win under two seeds', async () => {
    for (const [board, side] of [[COIN, 'p1'], [TWO_TURNS, 'p1']] as const) {
      const { serialized } = await serializedBoard(board);
      const step = luckPath(serialized, REQUEST(side));
      expect(step.status).toBe('found');
      for (const seed of ['1,2,3,4', '905,17,333,4096']) {
        const end = await playLine(board, step.line!, seed);
        expect(won(end, side), `${seed}: ${side} wins`).toBe(true);
      }
    }
  }, 120_000);
});

describe('the luck step, a speed tie', () => {
  /** Two identical Pikachu with one fixed move each: whoever moves first knocks the other out. */
  const TIE: Board = {
    format: 'gen9customgame',
    p1: [mon('Pikachu', ['Tackle'])],
    p2: [mon('Pikachu', ['Tackle'])],
    prepare: battle => { battle.sides[0].pokemon[0].hp = 1; battle.sides[1].pokemon[0].hp = 1; },
  };

  test.each(['p1', 'p2'] as const)('(d) %s wins on the tie\'s half, and the line pins the order', async side => {
    const { serialized } = await serializedBoard(TIE);
    const step = luckPath(serialized, REQUEST(side));
    expect(step.status).toBe('found');
    // Tackle has an accuracy of 100 and the roll does not decide a one-hit-point knock-out: the tie is the only die that prices
    expect(step.chance).toBeCloseTo(0.5, 12);
    const tie = named(step.line!, 'speed-tie');
    expect(tie).toHaveLength(1);
    expect(tie[0].die.result).toEqual({ first: `${side}a` });
    for (const seed of ['1,2,3,4', '905,17,333,4096']) expect(won(await playLine(TIE, step.line!, seed), side)).toBe(true);
  }, 60_000);
});

describe('the luck step, doubles (2 v 2 bodies: the engine fixture builder cannot start a doubles game with one body)', () => {
  /** Pikachu with Earthquake and a Flying partner against two Pikachu that only Splash: one at 1 HP, one that survives any plain roll and falls to a crit. */
  const DOUBLES: Board = {
    format: 'gen9doublescustomgame',
    p1: [mon('Pikachu', ['Earthquake']), mon('Pidgeot', ['Splash'])],
    p2: [mon('Pikachu', ['Splash']), mon('Pikachu', ['Splash'])],
  };

  test('(c) a crit that alone knocks the second foe out is the crit die with the chance of its draw', async () => {
    // the damage of a plain Earthquake at its highest roll, read from the simulator on a copy of the board
    const probe = await serializedBoard(DOUBLES);
    const { playTurnWith } = await import('../src/dice/likeliest');
    const { playOf } = await import('../src/endgame/win-paths/luck-path');
    const battle = probe.runtime.battleStream.battle!;
    const play = playOf({ choice: 'move 1, move 1', label: 'x' }, { choice: 'move 1, move 1', label: 'y' });
    const turn = playTurnWith(battle, play, []);
    const roll = turn.dice.find(entry => entry.die.name.kind === 'damage-roll' && entry.die.name.targetSlot === 'p2b')!;
    const high = playTurnWith(battle, play, [{ die: { name: roll.die.name, result: { step: 15 } } }]);
    const target = high.battle.sides[1].pokemon[1];
    const damage = battle.sides[1].pokemon[1].hp - target.hp;
    expect(damage).toBeGreaterThan(0);
    const board: Board = { ...DOUBLES, prepare: b => { b.sides[1].pokemon[0].hp = 1; b.sides[1].pokemon[1].hp = damage + 1; } };
    const { serialized } = await serializedBoard(board);
    // one turn: a plain Earthquake at its highest roll leaves the second foe one hit point, so a second turn would win without luck
    const step = luckPath(serialized, REQUEST('p1', { turns: 1 }));
    expect(step.status).toBe('found');
    const crits = named(step.line!, 'crit').filter(entry => 'happens' in entry.die.result && entry.die.result.happens);
    expect(crits).toHaveLength(1);
    expect(crits[0].die.name.targetSlot).toBe('p2b');
    expect(crits[0].chance).toBeCloseTo(1 / 24, 12);
    // the other dice of the turn (the first foe's crit and the rolls) change nobody's fate: the crit alone prices the path
    expect(step.chance).toBeCloseTo(1 / 24, 12);
    expect(new Set(diceOf(step.line!).map(entry => dieKey(entry.die.name))).size).toBe(diceOf(step.line!).length);
    for (const seed of ['1,2,3,4', '905,17,333,4096']) expect(won(await playLine(board, step.line!, seed), 'p1')).toBe(true);
  }, 120_000);
});
