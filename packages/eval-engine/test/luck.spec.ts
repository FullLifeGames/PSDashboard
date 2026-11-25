import { describe, expect, test } from 'vitest';
import { luckPath } from '../src/endgame/win-paths/luck';
import { WinMeter } from '../src/endgame/win-paths/budget';
import { dieKey } from '../src/dice/types';
import type { EvalLine } from '../src/types';
import { fingerprint } from './power-oracle';
import { mon, playLine, REQUEST, serializedBoard, won, type Board, playLineOn } from './win-paths-support';
import { searchPosition } from '../src/search/position';
import { mistakeStep } from '../src/endgame/win-paths/mistake';
import { strongerStep } from '../src/endgame/win-paths/stronger';
import { WIN_STEPS, winPaths } from '../src/endgame/win-paths/index';
import type { WinStep } from '../src/endgame/win-paths/types';
import { readFileSync } from 'node:fs';
import type { ReplayData } from '@fulllifegames/replay-core';
import { loadSimMods } from '../src/forward/sim-mods';
import { serializeLiveBattle } from '../src/serialize';
import { reconstruct } from './arrival-turn';

const COIN: Board = {
  format: 'gen9customgame',
  p1: [mon('Snorlax', ['High Jump Kick'])],
  p2: [mon('Pikachu', ['Hydro Pump'])],
  prepare: battle => { battle.sides[0].pokemon[0].hp = 1; battle.sides[1].pokemon[0].hp = 1; },
};

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
    // Tackle never misses and no roll spares a 1 HP body: only the speed tie prices.
    expect(step.chance).toBeCloseTo(0.5, 12);
    const tie = named(step.line!, 'speed-tie');
    expect(tie).toHaveLength(1);
    expect(tie[0].die.result).toEqual({ first: `${side}a` });
    for (const seed of ['1,2,3,4', '905,17,333,4096']) expect(won(await playLine(TIE, step.line!, seed), side)).toBe(true);
  }, 60_000);
});

describe('the luck step, doubles (2 v 2 bodies: the engine fixture builder cannot start a doubles game with one body)', () => {
  const DOUBLES: Board = {
    format: 'gen9doublescustomgame',
    p1: [mon('Pikachu', ['Earthquake']), mon('Pidgeot', ['Splash'])],
    p2: [mon('Pikachu', ['Splash']), mon('Pikachu', ['Splash'])],
  };

  test('(c) a crit that alone knocks the second foe out is the crit die with the chance of its draw', async () => {
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
    const step = luckPath(serialized, REQUEST('p1', { turns: 1 }));
    expect(step.status).toBe('found');
    const crits = named(step.line!, 'crit').filter(entry => 'happens' in entry.die.result && entry.die.result.happens);
    expect(crits).toHaveLength(1);
    expect(crits[0].die.name.targetSlot).toBe('p2b');
    expect(crits[0].chance).toBeCloseTo(1 / 24, 12);
    // 1/24 is the Gen 9 crit chance: the crit alone prices the path.
    expect(step.chance).toBeCloseTo(1 / 24, 12);
    expect(new Set(diceOf(step.line!).map(entry => dieKey(entry.die.name))).size).toBe(diceOf(step.line!).length);
    for (const seed of ['1,2,3,4', '905,17,333,4096']) expect(won(await playLine(board, step.line!, seed), 'p1')).toBe(true);
  }, 120_000);
});

const DOUBLES: Board = {
  format: 'gen9doublescustomgame',
  p1: [mon('Pikachu', ['Splash', 'Earthquake']), mon('Pidgeot', ['Splash'])],
  p2: [mon('Pikachu', ['Splash', 'Growl']), mon('Pikachu', ['Splash', 'Growl'])],
  prepare: battle => { battle.sides[1].pokemon[0].hp = 1; battle.sides[1].pokemon[1].hp = 1; },
};
const DOUBLES_ORDER = ['move splash, move splash', 'move earthquake, move splash'];

describe('the win-paths job', () => {
  test('the steps come in their ruled order, each reported when it is done', async () => {
    const { serialized } = await serializedBoard(COIN);
    const log: string[] = [];
    const runners = WIN_STEPS.map(runner => ({ ...runner, run: (...args: Parameters<typeof runner.run>) => { log.push(`run ${runner.kind}`); return runner.run(...args); } }));
    const result = winPaths(serialized, REQUEST('p1', { turn: 7, rootOrder: ['move highjumpkick'] }), step => log.push(`step ${step.kind} ${step.status}`), runners);
    expect(WIN_STEPS.map(runner => runner.kind)).toEqual(['stronger', 'luck', 'mistake']);
    expect(result.steps.map(step => step.kind)).toEqual(['stronger', 'luck', 'mistake']);
    expect(log).toEqual(['run stronger', 'step stronger found', 'run luck', 'step luck found', 'run mistake', 'step mistake none']);
    expect(result.side).toBe('p1');
    expect(result.turn).toBe(7);
  }, 240_000);

  test('each step has a meter of its own: the job spends what the step alone spends', async () => {
    const { serialized } = await serializedBoard(COIN);
    const request = REQUEST('p1', { rootOrder: ['move highjumpkick'] });
    const result = winPaths(serialized, request);
    expect(result.steps[0]).toEqual(strongerStep(serialized, request));
    expect(result.steps[1]).toEqual(luckPath(serialized, request));
    expect(result.steps[2]).toEqual(mistakeStep(serialized, request));
  }, 240_000);

  test('the third step is the mistake step: an opponent with one choice has no slip to make', async () => {
    const { serialized } = await serializedBoard(COIN);
    const third = winPaths(serialized, REQUEST('p1')).steps[2];
    expect(third).toMatchObject({ kind: 'mistake', status: 'none' });
    expect(third.line).toBeUndefined();
  }, 240_000);

  test('a step that throws leaves the others: it reads failed with the message, the rest run', async () => {
    const { serialized } = await serializedBoard(COIN);
    const seen: WinStep[] = [];
    const runners = WIN_STEPS.map(runner => runner.kind === 'stronger' ? { ...runner, run: () => { throw new Error('the prover broke'); } } : runner);
    const result = winPaths(serialized, REQUEST('p1'), step => seen.push(step), runners);
    expect(result.steps.map(step => step.status)).toEqual(['failed', 'found', 'none']);
    expect(result.steps[0]).toMatchObject({ kind: 'stronger', error: 'the prover broke', spent: { cells: 0, turns: 0 } });
    expect(seen).toEqual(result.steps);
  }, 240_000);

  test('a search result is equal with and without a job between two runs of it', async () => {
    const { serialized } = await serializedBoard(COIN);
    const settings = { depth: 1 as const, samples: 1, mode: 'matrix' as const, ruleset: 'standard' as const, tera: false };
    const before = JSON.stringify(searchPosition(serialized, settings));
    winPaths(serialized, REQUEST('p1', { rootOrder: ['move highjumpkick'] }));
    expect(JSON.stringify(searchPosition(serialized, settings))).toBe(before);
  }, 240_000);

  test('the job leaves the serialized position as it was (a string it only reads)', async () => {
    const { serialized } = await serializedBoard(COIN);
    const copy = `${serialized}`;
    winPaths(serialized, REQUEST('p1'));
    expect(serialized).toBe(copy);
  }, 240_000);
});

describe('the win-paths job, doubles', () => {
  test('the same order and the same lines: the stronger play wins under two seeds, luck reports its own meter', async () => {
    const { serialized } = await serializedBoard(DOUBLES);
    const seen: string[] = [];
    const result = winPaths(serialized, REQUEST('p1', { rootOrder: DOUBLES_ORDER, played: DOUBLES_ORDER[0] }), step => seen.push(step.kind));
    expect(seen).toEqual(['stronger', 'luck', 'mistake']);
    const stronger = result.steps[0];
    expect(stronger.status).toBe('found');
    expect(stronger.line!.choice).toBe('move earthquake, move splash');
    for (const seed of ['1,2,3,4', '905,17,333,4096']) expect(won(await playLine(DOUBLES, stronger.line!, seed), 'p1')).toBe(true);
    expect(result.steps[1]).toEqual(luckPath(serialized, REQUEST('p1', { rootOrder: DOUBLES_ORDER, played: DOUBLES_ORDER[0] })));
    expect(result.steps[2]).toEqual(mistakeStep(serialized, REQUEST('p1', { rootOrder: DOUBLES_ORDER, played: DOUBLES_ORDER[0] })));
  }, 240_000);
});

await loadSimMods('gen9championsou');

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../test/e2e-feedback/fixtures/${name}.json`, import.meta.url), 'utf-8')) as ReplayData;

const SCENES = [
  { id: '649664 t23, devin (singles)', name: 'smogtours-gen6ou-649664', turn: 23, side: 'p2', ruleset: 'standard' },
  { id: 'Champions VGC 2695803506 t10, juacox300 (doubles 1 v 1)', name: 'gen9championsvgc2026regmc-2695803506', turn: 10, side: 'p2', ruleset: 'champions', champions: true },
] as const;

const shownDice = (line: EvalLine): string[] => line.steps.flatMap(step => step.dice.filter(entry => entry.shown).map(entry => {
  const result = entry.die.result;
  const text = 'happens' in result ? (result.happens ? 'happens' : 'does not happen') : JSON.stringify(result);
  return `${entry.die.name.kind} ${text} (${Math.round((entry.chance ?? 1) * 1000) / 10} %)`;
}));

async function run(scene: typeof SCENES[number]) {
  const rebuild = () => reconstruct(('champions' in scene ? 'champions/' : '') + scene.name, scene.turn, fixture(scene.name));
  const { runtime } = await rebuild();
  const serialized = serializeLiveBattle(runtime.battleStream.battle!);
  const ranking = searchPosition(serialized, { depth: 1, samples: 1, mode: 'matrix', ruleset: scene.ruleset, tera: true });
  const first = { p1: ranking.perSide.p1[0].choice, p2: ranking.perSide.p2[0].choice };
  const step = luckPath(serialized, REQUEST(scene.side, { first, ruleset: scene.ruleset, tera: true }));
  return { step, rebuild };
}

describe('the luck step on the corpus', () => {
  test('649664 t23: devin wins when the shown dice go his way, and the line replays to the win', async () => {
    const { step, rebuild } = await run(SCENES[0]);
    expect(step.status).toBe('found');
    const line = step.line!;
    const dice = shownDice(line);
    console.info(`649664 t23 for devin: ${line.steps.map(entry => `${entry.p1.label} / ${entry.p2.label}`).join(' > ')} · ${dice.join(' · ')} · this sequence: ${Math.round((step.chance ?? 0) * 1000) / 10} %`);
    expect(line.steps.at(-1)!.p2.label).toBe('High Jump Kick');
    const last = line.steps.at(-1)!.dice;
    const accuracies = last.filter(entry => entry.die.name.kind === 'accuracy');
    expect(accuracies.map(entry => entry.die.name.slot)).toEqual(['p1a', 'p2a']);
    expect(accuracies.map(entry => ('happens' in entry.die.result ? entry.die.result.happens : null))).toEqual([false, true]);
    // Hydro Pump's 80 percent and High Jump Kick's 90 percent are the Gen 6 Dex's
    expect(accuracies[0].chance).toBeCloseTo(0.2, 9);
    expect(accuracies[1].chance).toBeCloseTo(0.9, 9);
    expect(step.chance).toBeGreaterThan(0);
    expect(step.chance).toBeLessThanOrEqual(0.2 * 0.9 + 1e-12);
    expect(step.spent.cells).toBeLessThan(600);
    expect(won((await playLineOn((await rebuild()).runtime, line)), 'p2')).toBe(true);
  }, 300_000);

  test('Champions VGC 2695803506 t10: both sides on their first choice leave juacox300 nothing within three turns, inside the budget', async () => {
    const { step } = await run(SCENES[1]);
    expect(step.status).toBe('none');
    expect(step.line).toBeUndefined();
    expect(step.spent.cells).toBeLessThan(600);
    expect(step.spent.turns).toBeLessThan(400);
  }, 300_000);
});
