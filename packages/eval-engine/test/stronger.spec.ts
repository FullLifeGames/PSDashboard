import { describe, expect, test } from 'vitest';
import { ForcedWinProver, proveForcedWin } from '../src/endgame/prover';
import { createRootPosition } from '../src/forward-model';
import { searchOptions } from '../src/search/options';
import { forcedWinInput } from '../src/search/forced-win-apply';
import { strongerStep } from '../src/endgame/win-paths/stronger';
import { mon, playLine, REQUEST, serializedBoard, won, type Board, playLineOn } from './win-paths-support';
import { readFileSync } from 'node:fs';
import type { ReplayData } from '@fulllifegames/replay-core';
import { loadSimMods } from '../src/forward/sim-mods';
import { serializeLiveBattle } from '../src/serialize';
import { searchPosition } from '../src/search/position';
import { reconstruct } from './arrival-turn';


const FOURTH: Board = {
  format: 'gen9customgame',
  p1: [mon('Pikachu', ['Splash', 'Growl', 'Harden', 'Seismic Toss'])],
  p2: [mon('Snorlax', ['Tackle'])],
  prepare: battle => { battle.sides[0].pokemon[0].hp = 1; battle.sides[1].pokemon[0].hp = 30; },
};
const RANKING = ['move splash', 'move growl', 'move harden', 'move seismictoss'];

// The second Snorlax takes the sure strike away (only a last standing body gets it), so the ranking decides again.
const FOURTH_WITH_BENCH: Board = {
  format: 'gen9customgame',
  p1: [mon('Pikachu', ['Splash', 'Growl', 'Harden', 'Seismic Toss'])],
  p2: [mon('Snorlax', ['Tackle']), mon('Snorlax', ['Tackle'])],
  prepare: battle => { battle.sides[0].pokemon[0].hp = 1; battle.sides[1].pokemon[0].hp = 30; battle.sides[1].pokemon[1].hp = 30; },
};

const COIN: Board = {
  format: 'gen9customgame',
  p1: [mon('Snorlax', ['High Jump Kick'])],
  p2: [mon('Pikachu', ['Hydro Pump'])],
  prepare: battle => { battle.sides[0].pokemon[0].hp = 1; battle.sides[1].pokemon[0].hp = 1; },
};

function cellsOfFirst(serialized: string, side: 'p1' | 'p2', first: string, depth: number): number {
  const root = createRootPosition(serialized);
  const own = searchOptions(root, side, { tera: false }).find(option => option.choice === first)!;
  const prover = new ForcedWinProver(side, { tera: false }, { states: 1000, cells: 1000, depth }, { states: 0, cells: 0 }, { floor: 0, plan: true });
  prover.candidateProof(root, own);
  return prover.cells;
}

const proof = (serialized: string, rootOrder: string[]) => proveForcedWin(serialized, { side: 'p1', rootOrder, tera: false });

describe('a stronger play, singles', () => {
  test('a winner the ranking lists fourth is found: the production prover tries three', async () => {
    const { serialized } = await serializedBoard(FOURTH_WITH_BENCH);
    expect(proof(serialized, RANKING).mass, 'today: the first three candidates never win').toBe(0);
    const step = strongerStep(serialized, REQUEST('p1', { rootOrder: RANKING, played: 'move splash' }));
    expect(step.status).toBe('found');
    expect(step.chance).toBe(1);
    expect(step.played).toBe(0);
    expect(step.line?.choice).toBe('move seismictoss');
  }, 120_000);

  test('the played choice that is already the best leaves nothing stronger', async () => {
    const { serialized } = await serializedBoard(FOURTH);
    const step = strongerStep(serialized, REQUEST('p1', { rootOrder: RANKING, played: 'move seismictoss' }));
    expect(step.status).toBe('none');
    expect(step.played).toBe(1);
    expect(step.chance).toBe(1);
  }, 120_000);

  test('proof mode keeps the line when the played choice is the winner', async () => {
    const { serialized } = await serializedBoard(FOURTH);
    const step = strongerStep(serialized, REQUEST('p1', { rootOrder: RANKING, played: 'move seismictoss', proof: {} }));
    expect(step.status).toBe('found');
    expect(step.played).toBe(1);
    expect(step.chance).toBe(1);
    expect(step.line!.choice).toBe('move seismictoss');
    for (const seed of ['1,2,3,4', '905,17,333,4096']) expect(won(await playLine(FOURTH, step.line!, seed), 'p1')).toBe(true);
  }, 120_000);

  test('a best choice under one half reads its mass: today the prover reads 0 below the floor', async () => {
    const { serialized } = await serializedBoard(COIN);
    expect(proof(serialized, ['move highjumpkick']).mass, 'today: a mass below one half reads 0').toBe(0);
    const step = strongerStep(serialized, REQUEST('p1', { rootOrder: ['move highjumpkick'] }));
    expect(step.status).toBe('found');
    expect(step.chance).toBeGreaterThanOrEqual(0.2 * 0.9 - 1e-9);
    expect(step.chance).toBeLessThan(0.2);
    expect(step.played).toBeUndefined();
  }, 120_000);

  test('the line follows the proof and plays to the win under two seeds', async () => {
    for (const board of [FOURTH, FOURTH_WITH_BENCH, COIN]) {
      const { serialized } = await serializedBoard(board);
      const step = strongerStep(serialized, REQUEST('p1', { rootOrder: board === COIN ? ['move highjumpkick'] : RANKING }));
      expect(step.status).toBe('found');
      expect(step.line, 'the proof comes with a line').toBeDefined();
      for (const seed of ['1,2,3,4', '905,17,333,4096']) expect(won(await playLine(board, step.line!, seed), 'p1')).toBe(true);
    }
  }, 120_000);

  test('a played choice whose proof the budget cut reports no mass', async () => {
    const { serialized } = await serializedBoard(FOURTH_WITH_BENCH);
    const order = ['move seismictoss', 'move splash', 'move growl', 'move harden'];
    const whole = strongerStep(serialized, REQUEST('p1', { rootOrder: order, played: 'move splash' }));
    expect(whole.played, 'with the whole budget the second proof ends and reads 0').toBe(0);
    const cells = cellsOfFirst(serialized, 'p1', 'move seismictoss', 3);
    const cut = strongerStep(serialized, REQUEST('p1', { rootOrder: order, played: 'move splash', budget: { cells } }));
    expect(cut.chance, 'the first proof ended inside the budget').toBe(1);
    expect(cut.played, 'the cap cut the played choice: no mass, not 0').toBeUndefined();
  }, 120_000);

  test('a budget the proof cannot finish in stops it', async () => {
    const { serialized } = await serializedBoard(FOURTH);
    const step = strongerStep(serialized, REQUEST('p1', { rootOrder: RANKING, budget: { cells: 1 } }));
    expect(step.status).toBe('stopped');
    expect(step.spent.cells).toBeGreaterThanOrEqual(0);
  }, 120_000);
});

describe('a stronger play, doubles', () => {
  // No Protect on this board: in doubles the prover reads a repeated Protect as unpriced and proves too little.
  const DOUBLES: Board = {
    format: 'gen9doublescustomgame',
    p1: [mon('Pikachu', ['Splash', 'Earthquake']), mon('Pidgeot', ['Splash'])],
    p2: [mon('Pikachu', ['Splash', 'Growl']), mon('Pikachu', ['Splash', 'Growl'])],
    prepare: battle => { battle.sides[1].pokemon[0].hp = 1; battle.sides[1].pokemon[1].hp = 1; },
  };

  test('against every legal reply: the winner is the damaging pair, and the line plays to the win', async () => {
    const { serialized } = await serializedBoard(DOUBLES);
    const order = ['move splash, move splash', 'move earthquake, move splash'];
    expect(proof(serialized, order).mass, 'the production prover sees the same win').toBe(1);
    const step = strongerStep(serialized, REQUEST('p1', { rootOrder: order, played: order[0] }));
    expect(step.status).toBe('found');
    expect(step.chance).toBe(1);
    expect(step.played).toBe(0);
    expect(step.line!.choice).toBe('move earthquake, move splash');
    expect(step.spent.cells).toBeGreaterThanOrEqual(4);
    expect(step.line!.steps[0].p2.choice).toMatch(/^move (splash|growl), move (splash|growl)$/);
    for (const seed of ['1,2,3,4', '905,17,333,4096']) expect(won(await playLine(DOUBLES, step.line!, seed), 'p1')).toBe(true);
  }, 240_000);

  test('a played pair whose proof the budget cut reports no mass', async () => {
    const { serialized } = await serializedBoard(DOUBLES);
    const order = ['move earthquake, move splash', 'move splash, move splash'];
    const whole = strongerStep(serialized, REQUEST('p1', { rootOrder: order, played: order[1] }));
    expect(whole.played, 'with the whole budget the second proof ends and reads 0').toBe(0);
    const cells = cellsOfFirst(serialized, 'p1', order[0], 3);
    const cut = strongerStep(serialized, REQUEST('p1', { rootOrder: order, played: order[1], budget: { cells } }));
    expect(cut.chance, 'the first proof ended inside the budget').toBe(1);
    expect(cut.played, 'the cap cut the played pair: no mass, not 0').toBeUndefined();
  }, 240_000);

  test('Champions VGC 2682637901 t6: the proof wins through Aqua Jet, a strike the search never listed, and the line opens with it', async () => {
    await loadSimMods('gen9championsdoublescustomgame');
    const board = JSON.parse(readFileSync(new URL('./fixtures/forced-win/scout-miss-gen9championsvgc2026regmbbo3-2682637901-t6.json', import.meta.url), 'utf-8')) as
      { serialized: string; side: 'p1' | 'p2'; rootOrder: string[]; ruleset: 'champions' };
    const own = { side: board.side, tera: false, ruleset: board.ruleset, rootOrder: board.rootOrder };
    const sure = proveForcedWin(board.serialized, own);
    expect(sure.choice).toBe('move heatwave, move aquajet 1');
    const plain = strongerStep(board.serialized, REQUEST(board.side, { ...own, turns: sure.turns }));
    expect(plain.line?.choice, 'without the proof the line opens with a listed choice').not.toBe(sure.choice);
    const step = strongerStep(board.serialized, REQUEST(board.side, { ...own, turns: sure.turns, proof: { choice: sure.choice } }));
    expect(step.status).toBe('found');
    expect(step.chance!).toBeGreaterThanOrEqual(sure.mass - 1e-9);
    expect(step.line!.choice).toBe(sure.choice);
    expect(step.line!.cut).toBeUndefined();
    expect(step.line!.end, 'the line ends in the proof side\'s favor').toBeGreaterThan(0.9);
    expect(step.spent.cells).toBeLessThan(600);
  }, 300_000);
});

await loadSimMods('gen9championsou');

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../test/e2e-feedback/fixtures/${name}.json`, import.meta.url), 'utf-8')) as ReplayData;

describe('a stronger play on the corpus', () => {
  test('649664 t23: devin has a choice that wins in more than half of the dice whatever BKC answers, and its line plays to the win', async () => {
    const name = 'smogtours-gen6ou-649664';
    const rebuild = () => reconstruct(name, 23, fixture(name));
    const { runtime } = await rebuild();
    const serialized = serializeLiveBattle(runtime.battleStream.battle!);
    const ranking = searchPosition(serialized, { depth: 1, samples: 1, mode: 'matrix', ruleset: 'standard', tera: true });
    const rootOrder = ranking.perSide.p2.map(row => row.choice);
    const today = proveForcedWin(serialized, { side: 'p2', rootOrder, tera: true, ruleset: 'standard' });
    const step = strongerStep(serialized, REQUEST('p2', { rootOrder, tera: true, ruleset: 'standard' }));
    console.info(`649664 t23 for devin: ${step.line?.label}: wins within ${step.line?.steps.length} steps in ${Math.round((step.chance ?? 0) * 1000) / 10} % of the dice whatever BKC answers (played: none in the log); the production prover reads ${today.mass}`);
    expect(step.status).toBe('found');
    expect(step.played).toBeUndefined();
    expect(step.chance!).toBeGreaterThan(0.5);
    expect(step.chance!).toBeGreaterThanOrEqual(today.mass);
    expect(step.line!.label).toBe('High Jump Kick');
    expect(step.spent.cells).toBeLessThan(600);
    expect(won(await playLineOn((await rebuild()).runtime, step.line!), 'p2')).toBe(true);
  }, 300_000);

  test('562428 t22: BKC\'s Shadow Ball wins in every roll within three turns through the replacement after Dragapult\'s faint, and the foe\'s step answers none', async () => {
    const name = 'smogtours-gen8ou-562428';
    const rebuild = () => reconstruct(name, 22, fixture(name));
    const serialized = serializeLiveBattle((await rebuild()).runtime.battleStream.battle!);
    const ranking = searchPosition(serialized, { depth: 1, samples: 1, mode: 'matrix', ruleset: 'standard', tera: true });
    const ask = (side: 'p1' | 'p2') => strongerStep(serialized, REQUEST(side, { turns: 3, tera: true, ruleset: 'standard', rootOrder: ranking.perSide[side].map(row => row.choice) }));
    const step = ask('p1');
    expect(step.status).toBe('found');
    expect(step.chance).toBe(1);
    expect(step.line!.label).toBe('Shadow Ball');
    expect(step.line!.steps).toHaveLength(3);
    expect(step.spent.cells).toBeLessThan(600);
    expect(won(await playLineOn((await rebuild()).runtime, step.line!), 'p1')).toBe(true);
    expect(ask('p2').status).toBe('none');
  }, 300_000);

    test.each([
    { id: '562428 t22 (singles)', name: 'smogtours-gen8ou-562428', turn: 22, ruleset: 'standard', side: 'p1', turns: 3, mass: 1 },
    { id: '2663093831 t15 (Doubles OU)', name: 'gen9doublesou-2663093831', turn: 15, ruleset: 'standard', side: 'p2', turns: 1, mass: 1 },
    { id: '2630685175 t10 (VGC)', name: 'gen9vgc2026regi-2630685175', turn: 10, ruleset: 'vgc', side: 'p1', turns: 2, mass: 0.667 },
  ] as const)('$id: proof mode finds the proof\'s line with at least its mass and the line plays to the win', async scene => {
    const rebuild = () => reconstruct(scene.name, scene.turn, fixture(scene.name));
    const serialized = serializeLiveBattle((await rebuild()).runtime.battleStream.battle!);
    const settings = { depth: 1 as const, samples: 1, mode: 'matrix' as const, ruleset: scene.ruleset, tera: true };
    const rootOrder = forcedWinInput(searchPosition(serialized, settings), settings).rootOrder[scene.side];
    const step = strongerStep(serialized, REQUEST(scene.side, { turns: scene.turns, tera: true, ruleset: scene.ruleset, rootOrder, proof: {} }));
    console.info(`${scene.id}: proof mode ${step.status} ${step.chance} ${step.line?.label} in ${step.line?.steps.length} steps, ${step.spent.cells} cells`);
    expect(step.status).toBe('found');
    expect(step.chance!).toBeGreaterThanOrEqual(scene.mass - 1e-3);
    expect(step.spent.cells).toBeLessThan(600);
    expect(won(await playLineOn((await rebuild()).runtime, step.line!), scene.side)).toBe(true);
  }, 300_000);

  test('Champions VGC 2695803506 t10: juacox300 (doubles 1 v 1), every legal reply of Delphox-Mega is answered inside the budget', async () => {
    const name = 'gen9championsvgc2026regmc-2695803506';
    const { runtime } = await reconstruct(`champions/${name}`, 10, fixture(name));
    const serialized = serializeLiveBattle(runtime.battleStream.battle!);
    const ranking = searchPosition(serialized, { depth: 1, samples: 1, mode: 'matrix', ruleset: 'champions', tera: true });
    const rootOrder = ranking.perSide.p2.map(row => row.choice);
    const step = strongerStep(serialized, REQUEST('p2', { rootOrder, tera: true, ruleset: 'champions' }));
    // Probe: the production prover at 100 and 400 cells reads mass 0 on this board too.
    expect(step.status).toBe('none');
    expect(step.chance).toBeUndefined();
    expect(step.line).toBeUndefined();
    expect(step.spent.cells).toBeLessThan(600);
  }, 300_000);
});
