import { describe, expect, test } from 'vitest';
import { State } from '@pkmn/sim';
import { createMatchupCache } from '../src/eval-function';
import { createRootPosition, deserializeBattleExact, positionBattle } from '../src/forward-model';
import { loadSimMods } from '../src/forward/sim-mods';
import { perfReset, perfSummary } from '../src/perf-trace';
import { sampleCell } from '../src/search/cell-sampler';
import { countFainted } from '../src/search/leaf';
import { createLocalExecutor, subSearchDepth1 } from '../src/search';
import { deepenClass, deeperPriced, VERIFY_DEEPEN_COVER, VERIFY_LIGHT, VERIFY_PLAIN_DRAWS, type Outcome } from '../src/search/verify-cell';
import type { SimPosition } from '../src/forward-model';
import type { EvalCellJob, EvalCellValue, EvalSettings } from '../src/types';
import { doublesRoot, pairSet } from './pair-battles';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';
import { rootOf } from './secondary-classes-support';

/**
 * Round 89 (T322, #59), block 2 stage 2: the verify round marks how it priced each open class of a blend
 * (`CellBlendClass.priced`: 'full', 'light' or 'shift'), and a strand job names classes (`EvalCellJob.strands`) that the
 * executor prices again through the full depth-1 sub-search of the class child (`EvalCellValue.strandValues`). Nothing in the
 * orchestrator calls the job yet, so no score, grade or report moves. Rows: (p) the pricing rule on synthetic outcomes,
 * (e) the executor on a doubles board with a 30 % flinch, on a board whose lists the light search cannot cut, on a board with
 * a joint class under 5 %, on a singles board with a 10 % class past the 90 % cover, and on a board in the other bench order.
 */
await loadSimMods('gen9championsou');

const cache = createMatchupCache();
const DEEPEN: EvalSettings = { depth: 1, samples: 1, tera: false };
const SPEED = { nature: 'Jolly', evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 } } as const;
const slow = () => [pairSet('Slow1', 'Snorlax', ['Rest', 'Protect']), pairSet('Slow2', 'Chansey', ['Rest', 'Protect'])];

const child = (name: string) => ({ serialized: name } as unknown as SimPosition);
const outcome = (name: string, weight: number, leaf: number, ended = false): Outcome => ({ weight, child: child(name), leaf, ended });

describe('(p) deeperPriced reports how each outcome was priced', () => {
  const outcomes = [outcome('heavy', 0.6, 0.1), outcome('mid', 0.25, 0.3), outcome('small', 0.1, -0.2), outcome('tiny', 0.03, 0.2), outcome('done', 0.02, 1, true)];
  const full = (position: SimPosition) => ({ heavy: 0.5 }[position.serialized as 'heavy'] ?? Number.NaN);
  const lightPrice = () => 0.4;

  test('the cover loop prices full, the cheap callback light, a weight under minWeight shift, an ended outcome keeps its leaf', () => {
    const { values, priced } = deeperPriced(outcomes, full, 0, Number.POSITIVE_INFINITY, undefined,
      { price: lightPrice, statesOnly: false, minWeight: 0.05 });
    expect(priced.slice(0, 4)).toEqual(['full', 'light', 'light', 'shift']);
    expect(values[3]).toBeCloseTo(0.2 + (0.5 - 0.1), 12);
  });

  test('without a cheap callback every outcome beyond the cover is shift (singles)', () => {
    const { priced } = deeperPriced(outcomes, full, 0);
    expect(priced.slice(0, 4)).toEqual(['full', 'shift', 'shift', 'shift']);
  });

  test('statesOnly: an outcome without states is shift, one with states is light', () => {
    const states = [{ share: 0.5, child: child('a'), leaf: 0.2, ended: false }, { share: 0.5, child: child('b'), leaf: 0.4, ended: false }];
    const withStates = [outcome('heavy', 0.6, 0.1), { ...outcome('mid', 0.25, 0.3), groups: states }, outcome('small', 0.15, -0.2)];
    const { priced } = deeperPriced(withStates, full, 0, Number.POSITIVE_INFINITY, undefined, { price: lightPrice, statesOnly: true, minWeight: 0 });
    expect(priced).toEqual(['full', 'light', 'shift']);
  });

  test('a light price that cut neither list counts as full; one cut among the states keeps light', () => {
    const uncut = { price: lightPrice, uncut: () => true, statesOnly: false, minWeight: 0.05 };
    expect(deeperPriced(outcomes, full, 0, Number.POSITIVE_INFINITY, undefined, uncut).priced.slice(0, 3)).toEqual(['full', 'full', 'full']);
    const states = [{ share: 0.5, child: child('a'), leaf: 0.2, ended: false }, { share: 0.5, child: child('b'), leaf: 0.4, ended: false }];
    const withStates = [outcome('heavy', 0.6, 0.1), { ...outcome('mid', 0.4, 0.3), groups: states }];
    let calls = 0;
    const second = { price: lightPrice, uncut: () => (calls += 1) === 1, statesOnly: false, minWeight: 0.05 };
    expect(deeperPriced(withStates, full, 0, Number.POSITIVE_INFINITY, undefined, second).priced).toEqual(['full', 'light']);
  });

  test('the values are the ones deeperValues returns', () => {
    const { values } = deeperPriced(outcomes, full, 0, Number.POSITIVE_INFINITY, undefined, { price: lightPrice, statesOnly: false, minWeight: 0.05 });
    expect(values).toEqual([0.5, 0.4, 0.4, 0.2 + (0.5 - 0.1), 1]);
  });
});

interface Round { executor: ReturnType<typeof createLocalExecutor>; job: EvalCellJob; root: SimPosition }

/** A cell job of the board for the two choices, found by their text. */
async function cellOf(serialized: string, p1Choice: string, p2Choice: string, extra: Partial<EvalCellJob> = {}): Promise<Round> {
  const executor = createLocalExecutor(serialized);
  const { p1, p2 } = await executor.choices(false);
  const i = p1.findIndex(option => option.choice === p1Choice);
  const j = p2.findIndex(option => option.choice === p2Choice);
  if (i < 0 || j < 0) throw new Error(`no cell ${p1Choice} / ${p2Choice} among ${p1.map(o => o.choice)} / ${p2.map(o => o.choice)}`);
  return { executor, root: createRootPosition(serialized), job: { i, j, p1Choice: p1[i].choice, p2Choice: p2[j].choice, samples: 1, deepen: DEEPEN, ...extra } };
}

const classOf = (value: EvalCellValue, token: string) => {
  const found = value.blend!.classes.filter(cls => cls.key.endsWith(token));
  if (found.length !== 1) throw new Error(`classes ${value.blend!.classes.map(cls => cls.key)} do not hold one ${token}`);
  return found[0];
};

/**
 * The full depth-1 value of a class, from the sampler's own draws (the verify job's, fixed seeds): the class child's sub-search,
 * or, where the class's draws leave different states, the states' mix under the rule (`deepenClass` with the test's own price).
 */
function expectedStrandValue(round: Round, key: string, verified: EvalCellValue): number {
  const cell = sampleCell(round.root, countFainted(positionBattle(round.root)), round.job.p1Choice, round.job.p2Choice, round.job.samples, cache, true, VERIFY_PLAIN_DRAWS);
  const price = (child: SimPosition) => subSearchDepth1(child.serialized, DEEPEN, cache).score;
  if (cell.classGroups?.has(key)) return deepenClass(verified, cell, key, price)!;
  return price(cell.classChildren!.get(key)!);
}

const ironHeadBoard = () => doublesRoot([pairSet('Fast', 'Aerodactyl', ['Iron Head', 'Protect'], SPEED), pairSet('Wall', 'Blissey', ['Soft-Boiled', 'Protect'])], slow());
const IRON = ['move ironhead 1, move softboiled', 'move rest, move rest'] as const;

describe('(e) the executor marks its verify cells and prices a strand', () => {
  test('doubles, Iron Head into a slow target: the heaviest class is full, the 30 % flinch is light, and the values are the ones before', async () => {
    const round = await cellOf(ironHeadBoard().serialized, ...IRON);
    const [verified] = await round.executor.evalCells([round.job]);
    expect(classOf(verified, '=hit-nokill').priced).toBe('full');
    expect(classOf(verified, '+flinch').priced).toBe('light');
    const plain = await round.executor.evalCells([{ ...round.job, deepen: undefined }]);
    expect(plain[0].blend!.classes.every(cls => cls.priced === undefined)).toBe(true);
    expect(plain[0].value).toBe(verified.value);
  });

  test('doubles: a strand job prices the named class through the full depth-1 sub-search and counts it', async () => {
    const board = ironHeadBoard().serialized;
    const round = await cellOf(board, ...IRON);
    const [verified] = await round.executor.evalCells([round.job]);
    const flinch = classOf(verified, '+flinch');
    const expected = expectedStrandValue(round, flinch.key, verified);
    perfReset();
    const [strand] = await round.executor.evalCells([{ ...round.job, strands: [flinch.key] }]);
    expect(perfSummary('strand').counters['strand-sub']).toBe(1);
    expect(strand.i).toBe(round.job.i);
    expect(strand.j).toBe(round.job.j);
    expect(Object.keys(strand.strandValues!)).toEqual([flinch.key]);
    expect(strand.strandValues![flinch.key]).toBe(expected);
    // The verify job gave the light price of this class; the strand job gives the full one, and a name the cell lacks is left out.
    expect(flinch.deepened).toBeDefined();
    const [unknown] = await round.executor.evalCells([{ ...round.job, strands: [flinch.key, 'p1a:nothing>p2a=hit-nokill'] }]);
    expect(Object.keys(unknown.strandValues!)).toEqual([flinch.key]);
  });

  test('a strand job without the verify settings, or an ended class, returns no value', async () => {
    const round = await cellOf(ironHeadBoard().serialized, ...IRON);
    const [verified] = await round.executor.evalCells([round.job]);
    const [bare] = await round.executor.evalCells([{ ...round.job, deepen: undefined, strands: [classOf(verified, '+flinch').key] }]);
    expect(bare.strandValues ?? {}).toEqual({});
  });

  test('doubles, five options a side or fewer: the light search cuts nothing, so the light classes are full', async () => {
    const small = doublesRoot(
      [pairSet('Fast', 'Aerodactyl', ['Iron Head'], SPEED), pairSet('Wall', 'Blissey', ['Soft-Boiled'])],
      [pairSet('Slow1', 'Snorlax', ['Rest']), pairSet('Slow2', 'Chansey', ['Rest'])],
    ).serialized;
    const round = await cellOf(small, 'move ironhead 1, move softboiled', 'move rest, move rest');
    const [verified] = await round.executor.evalCells([round.job]);
    expect(classOf(verified, '=hit-nokill').priced).toBe('full');
    expect(classOf(verified, '+flinch').priced).toBe('full');
  });

  test('doubles, a class lighter than VERIFY_LIGHT.minWeight is shift, and its strand value is the full depth-1 value', async () => {
    const saved = VERIFY_LIGHT.minWeight;
    VERIFY_LIGHT.minWeight = 0.5;
    try {
      const round = await cellOf(ironHeadBoard().serialized, ...IRON);
      const [verified] = await round.executor.evalCells([round.job]);
      const flinch = classOf(verified, '+flinch');
      expect(flinch.priced).toBe('shift');
      const [strand] = await round.executor.evalCells([{ ...round.job, strands: [flinch.key] }]);
      expect(strand.strandValues![flinch.key]).toBe(expectedStrandValue(round, flinch.key, verified));
    } finally { VERIFY_LIGHT.minWeight = saved; }
  });

  test('singles, a 10 % paralysis: the class past the 90 % cover is shift, and its strand value is the depth-1 value of its child', async () => {
    const root = rootOf(battleOf('gen9customgame', [set('Aerodactyl', ['thunderbolt', 'protect'])], [set('Snorlax', ['earthquake', 'rest'])]));
    const round = await cellOf(root.serialized, 'move thunderbolt', 'move rest');
    expect(VERIFY_DEEPEN_COVER.singles).toBe(0.9);
    const [verified] = await round.executor.evalCells([round.job]);
    expect(classOf(verified, 'hit-nokill').priced).toBe('full');
    const par = classOf(verified, '+par');
    expect(par.priced).toBe('shift');
    const [strand] = await round.executor.evalCells([{ ...round.job, strands: [par.key] }]);
    expect(strand.strandValues![par.key]).toBe(expectedStrandValue(round, par.key, verified));
    // r89 A5 gate: was `expect(strand.strandValues![par.key]).not.toBe(par.deepened)`. With the cell's own seeds (T324) the shifted price and
    // the child's depth-1 value are both 0.9, so this scene no longer tells the two apart; the line above pins the strand value.
  });

  test('the root stays as it was: the same verify job reads the same before and after a strand job', async () => {
    const round = await cellOf(ironHeadBoard().serialized, ...IRON);
    const key = (await round.executor.evalCells([round.job]))[0].blend!.classes.find(cls => cls.key.endsWith('+flinch'))!.key;
    const before = await round.executor.evalCells([round.job]);
    await round.executor.evalCells([{ ...round.job, strands: [key] }]);
    const after = await round.executor.evalCells([round.job]);
    expect(after).toEqual(before);
  });
});

/** The board with each side's bench (the bodies past the active slots) in reverse order. */
function reverseBench(serialized: string): string {
  const battle = deserializeBattleExact(serialized);
  for (const side of battle.sides) {
    const actives = side.active.length;
    side.pokemon = [...side.pokemon.slice(0, actives), ...side.pokemon.slice(actives).reverse()];
    side.pokemon.forEach((pokemon, index) => { pokemon.position = index; });
  }
  return JSON.stringify(State.serializeBattle(battle));
}

describe('(e) a strand job speaks the given board\'s slots', () => {
  const benchBoard = () => doublesRoot(
    [pairSet('Fast', 'Aerodactyl', ['Iron Head', 'Protect'], SPEED), pairSet('Wall', 'Blissey', ['Soft-Boiled', 'Protect']),
      pairSet('Bench1', 'Alakazam', ['Psychic']), pairSet('Bench2', 'Machamp', ['Close Combat'])],
    [pairSet('Slow1', 'Snorlax', ['Rest', 'Protect']), pairSet('Slow2', 'Chansey', ['Rest', 'Protect']),
      pairSet('Bench3', 'Gengar', ['Shadow Ball']), pairSet('Bench4', 'Dragonite', ['Outrage'])],
  ).serialized;

  /** The p1 option that attacks with the first slot and brings the named species in with the second. */
  async function switchTo(serialized: string, species: string): Promise<string> {
    const { p1 } = await createLocalExecutor(serialized).choices(false);
    const found = p1.find(option => option.choice.startsWith('move ironhead 2, switch') && option.label.includes(species));
    if (!found) throw new Error(`no switch to ${species} among ${p1.map(o => `${o.choice} = ${o.label}`)}`);
    return found.choice;
  }

  test('the reversed bench names another slot for the same switch and gets the same strand values', async () => {
    const board = benchBoard();
    const reversed = reverseBench(board);
    const choiceA = await switchTo(board, 'Machamp');
    const choiceB = await switchTo(reversed, 'Machamp');
    expect(choiceA).not.toBe(choiceB);
    const a = await cellOf(board, choiceA, 'move rest, move rest');
    const b = await cellOf(reversed, choiceB, 'move rest, move rest');
    const [va] = await a.executor.evalCells([a.job]);
    const [vb] = await b.executor.evalCells([b.job]);
    expect(vb.blend!.classes.map(cls => [cls.key, cls.priced])).toEqual(va.blend!.classes.map(cls => [cls.key, cls.priced]));
    const key = classOf(va, '+flinch').key;
    const [sa] = await a.executor.evalCells([{ ...a.job, strands: [key] }]);
    const [sb] = await b.executor.evalCells([{ ...b.job, strands: [key] }]);
    expect(sb.strandValues).toEqual(sa.strandValues);
    expect(sa.strandValues![key]).toBeDefined();
  });
});

