import { describe, expect, test } from 'vitest';
import { byMildest, mistakeStep, type Slip } from '../src/endgame/win-paths/mistake';
import { WinMeter } from '../src/endgame/win-paths/budget';
import { fingerprint } from './power-oracle';
import { mon, playLine, REQUEST, serializedBoard, won, type Board } from './win-paths-support';

/**
 * Round 89 (#130), step G7b: a mistake by the opponent (ruling W3a). Both sides play the engine's first choice with every die at its
 * likeliest result; the opponent's lower-ranked choices are tried one at a time, the mildest mistake first, and the first one after
 * which the line wins for the side that lost is the answer, with the chance of the dice it needs. Boards are small custom games:
 * every number is one the simulator shows there. Singles and doubles.
 */

/**
 * Singles 1 v 1: a slow Snorlax at 1 HP (the side that lost) whose Tackle knocks the 1 HP Pikachu out; the faster Pikachu's first choice,
 * Seismic Toss (fixed 50), knocks Snorlax out first, its second choice (a second Seismic Toss slot's twin: Tackle) does too, and only
 * a status move lets Snorlax hit.
 */
const SLIP: Board = {
  format: 'gen9customgame',
  p1: [mon('Snorlax', ['Tackle'])],
  p2: [mon('Pikachu', ['Seismic Toss', 'Tackle', 'Splash', 'Growl'])],
  prepare: battle => { battle.sides[0].pokemon[0].hp = 1; battle.sides[1].pokemon[0].hp = 1; },
};
const FOE_RANKING = [
  { choice: 'move seismictoss', ev: 0.9 },
  { choice: 'move tackle', ev: 0.8 },
  { choice: 'move splash', ev: 0.1 },
  { choice: 'move growl', ev: -0.2 },
];
const FIRST = { p1: 'move tackle', p2: 'move seismictoss' };
const ASK = (extra = {}) => REQUEST('p1', { turn: 5, first: FIRST, foeRanking: FOE_RANKING, ...extra });

describe('a mistake by the opponent, singles', () => {
  test('the mildest lower-ranked choice that lets the side win is named, the dice it needs priced', async () => {
    const { serialized } = await serializedBoard(SLIP);
    const step = mistakeStep(serialized, ASK());
    expect(step.status).toBe('found');
    // the second choice (Tackle) knocks Snorlax out too: the third, Splash, is the smallest mistake that wins
    expect(step.deviation).toEqual({ turn: 5, label: 'Splash', rank: 3 });
    expect(step.line!.steps).toHaveLength(1);
    expect(step.line!.steps[0].p2.label).toBe('Splash');
    expect(step.line!.steps[0].p1.label).toBe('Tackle');
    expect(step.chance).toBeCloseTo(1, 12);
    expect(step.spent.turns).toBeGreaterThan(0);
  }, 60_000);

  test('a ranking whose second choice wins names the second', async () => {
    const { serialized } = await serializedBoard(SLIP);
    const ranking = [FOE_RANKING[0], FOE_RANKING[2], FOE_RANKING[1], FOE_RANKING[3]];
    const step = mistakeStep(serialized, ASK({ foeRanking: ranking }));
    expect(step.deviation).toEqual({ turn: 5, label: 'Splash', rank: 2 });
  }, 60_000);

  test('the line replays through the branch engine to the side\'s win under two seeds', async () => {
    const { serialized } = await serializedBoard(SLIP);
    const step = mistakeStep(serialized, ASK());
    for (const seed of ['1,2,3,4', '905,17,333,4096']) expect(won(await playLine(SLIP, step.line!, seed), 'p1'), seed).toBe(true);
  }, 120_000);

  test('the mildest by loss comes first, then the earlier turn, then the better rank', () => {
    const slip = (turn: number, rank: number, loss: number): Slip => ({ turn, rank, loss });
    const order = [slip(2, 2, 0.3), slip(1, 3, 0.5), slip(1, 2, 0.3), slip(3, 2, 0.1), slip(2, 3, 0.3)].sort(byMildest);
    expect(order.map(item => [item.turn, item.rank])).toEqual([[3, 2], [1, 2], [2, 2], [2, 3], [1, 3]]);
  });

  test('none: one slip is not enough when the win needs the foe to stand still for three turns', async () => {
    const board: Board = {
      format: 'gen9customgame',
      p1: [mon('Snorlax', ['Seismic Toss'])],
      p2: [mon('Pikachu', ['Seismic Toss', 'Splash'])],
      prepare: battle => { battle.sides[0].pokemon[0].hp = 80; battle.sides[1].pokemon[0].hp = 150; },
    };
    const { serialized } = await serializedBoard(board);
    const step = mistakeStep(serialized, REQUEST('p1', { turn: 1, first: { p1: 'move seismictoss', p2: 'move seismictoss' }, foeRanking: [{ choice: 'move seismictoss', ev: 0.5 }, { choice: 'move splash', ev: 0 }] }));
    expect(step).toMatchObject({ kind: 'mistake', status: 'none' });
    expect(step.line).toBeUndefined();
    expect(step.deviation).toBeUndefined();
  }, 60_000);

  test('a slip on a later turn: the ranking at the root lists only the first choice, the matrix ranks the later positions', async () => {
    const board: Board = {
      format: 'gen9customgame',
      p1: [mon('Snorlax', ['Seismic Toss'])],
      p2: [mon('Pikachu', ['Seismic Toss', 'Splash'])],
      prepare: battle => { battle.sides[0].pokemon[0].hp = 80; battle.sides[1].pokemon[0].hp = 100; },
    };
    const { serialized } = await serializedBoard(board);
    const request = REQUEST('p1', { turn: 7, first: { p1: 'move seismictoss', p2: 'move seismictoss' }, foeRanking: [{ choice: 'move seismictoss', ev: 0.5 }] });
    const step = mistakeStep(serialized, request);
    expect(step.status).toBe('found');
    expect(step.deviation).toMatchObject({ turn: 8, label: 'Splash', rank: 2 });
    expect(step.line!.steps).toHaveLength(2);
    expect(step.line!.steps[0].p2.label).toBe('Seismic Toss');
    expect(step.line!.steps[1].p2.label).toBe('Splash');
    for (const seed of ['1,2,3,4', '905,17,333,4096']) expect(won(await playLine(board, step.line!, seed), 'p1'), seed).toBe(true);
  }, 120_000);

  test('a budget that ends the search first stops it and says so', async () => {
    const { serialized } = await serializedBoard(SLIP);
    const step = mistakeStep(serialized, ASK(), new WinMeter({ turns: 1 }));
    expect(step.status).toBe('stopped');
    expect(step.line).toBeUndefined();
  }, 60_000);

  test('the live battle stays as it was and two runs agree', async () => {
    const { runtime, serialized } = await serializedBoard(SLIP);
    const battle = runtime.battleStream.battle!;
    const pokemon = battle.sides.flatMap(side => side.pokemon);
    const before = fingerprint(battle, pokemon, 'tackle');
    const one = mistakeStep(serialized, ASK());
    const two = mistakeStep(serialized, ASK());
    expect(fingerprint(battle, pokemon, 'tackle')).toBe(before);
    expect(JSON.stringify(two)).toBe(JSON.stringify(one));
  }, 60_000);
});

describe('a mistake by the opponent, doubles (2 v 2 bodies: the engine fixture builder cannot start a doubles game with one body)', () => {
  /**
   * A slow Snorlax at 1 HP with Heat Wave (spread, accuracy 90) and a Pidgeot that only splashes, against two faster Pikachu at 1 HP
   * that each choose between Seismic Toss and Splash. Heat Wave knocks both foes out, so the side wins only when no foe knocks
   * Snorlax out first.
   */
  const DOUBLES: Board = {
    format: 'gen9doublescustomgame',
    p1: [mon('Snorlax', ['Heat Wave']), mon('Pidgeot', ['Splash'])],
    p2: [mon('Pikachu', ['Seismic Toss', 'Splash']), mon('Pikachu', ['Seismic Toss', 'Splash'])],
    prepare: battle => {
      battle.sides[0].pokemon[0].hp = 1;
      for (const pokemon of battle.sides[1].pokemon) pokemon.hp = 1;
    },
  };

  test('a slip by the pair is found from the one-turn matrix, and its line replays to the win under two seeds', async () => {
    const { serialized } = await serializedBoard(DOUBLES);
    const step = mistakeStep(serialized, REQUEST('p1', { turn: 3 }));
    expect(step.status).toBe('found');
    // the foes' first choice knocks Snorlax out; a slip that spares it wins when Heat Wave hits both foes (accuracy 90 each)
    expect(step.deviation!.turn).toBe(3);
    expect(step.deviation!.rank).toBeGreaterThan(1);
    expect(step.line!.steps).toHaveLength(1);
    expect(step.line!.steps[0].p1.slots.length).toBe(2);
    expect(step.line!.steps[0].p2.slots.length).toBe(2);
    expect(step.chance).toBeCloseTo(0.9 * 0.9, 12);
    for (const seed of ['1,2,3,4', '905,17,333,4096']) expect(won(await playLine(DOUBLES, step.line!, seed), 'p1'), seed).toBe(true);
  }, 120_000);

  test('none: one slip is not enough when the foes stand at full HP', async () => {
    const board: Board = { ...DOUBLES, prepare: battle => { battle.sides[0].pokemon[0].hp = 1; for (const pokemon of battle.sides[1].pokemon) pokemon.hp = pokemon.maxhp; } };
    const { serialized } = await serializedBoard(board);
    const step = mistakeStep(serialized, REQUEST('p1', { turn: 3 }));
    expect(step.status).toBe('none');
    expect(step.line).toBeUndefined();
  }, 120_000);
});
