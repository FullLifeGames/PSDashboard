import { readFileSync } from 'node:fs';
import { Battle, PRNG, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { describe, expect, test } from 'vitest';
import { searchOrchestrated, type SearchExecutor } from '../src/orchestrator';
import { createLocalExecutor, searchPosition } from '../src/search';
import { createLocalTreeExecutor, searchTreesOrchestrated } from '../src/tree-orchestrator';
import { autoTurnSettings, configureSearchBudget, searchBudget, SEARCH_BUDGET_DEFAULT } from '../src/search/budget';
import { deserializeBattleExact } from '../src/forward-model';
import { serializeLiveBattle } from '../src/serialize';
import { loadSimModsFor } from '../src/forward/sim-mods';
import type { StaticRuleset } from '../src/eval-function';
import type { EvalResult, EvalSettings } from '../src/types';

/**
 * Round 89 (SB-4, issue #197): a forced replacement under the matrix is judged by the turn that follows it. The pivot request or
 * the knock-out is the root; its cells are the switch-ins (one column, "waiting", or the other side's own replacements), and each
 * cell's child is the board on arrival. The search used to price that board by the static alone, so two bodies that look alike on
 * arrival tied, and a body that loses its race the next turn could still lead (the user's game: Glimmora after U-turn). Now every
 * cell holds the engine's own search of its child, one turn, the root's draws: the replacement's value is the solved value of the
 * turn that follows.
 *
 * Rows: the user's game (Great Tusk), two corpus replacements the static read wrong (653785 turn 10: Lopunny-Mega where the player
 * sent Weavile; 655336 turn 5, p2: Clefable where the reference reads Lopunny), a doubles replacement under an explicit matrix
 * (VGC 2630685175 turn 2, one slot, and turn 4, two slots), and the guards: a root with no forced request is unchanged, the tree
 * keeps its own forced node, the sync and the orchestrated search agree, and a stop leaves the depth-1 result.
 * The reference of every row is computed here: each switch-in played on a copy, then the search of that board with the same settings.
 */

interface Fixture { settings: { tera: boolean; ruleset: StaticRuleset; sleepClause: boolean }; serialized: string }
const read = (name: string): Fixture => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf-8')) as Fixture;
const gholdengo = JSON.parse(readFileSync(new URL('./fixtures/sb-gholdengo.json', import.meta.url), 'utf-8')) as
  Fixture & { turn2: string; forced: string };

const settingsOf = (scene: Fixture, samples: 1 | 3 | 5, depth: 1 | 2 | 3 = 1): EvalSettings => ({
  depth, samples, mode: 'matrix', tera: scene.settings.tera, sleepClause: scene.settings.sleepClause, ruleset: scene.settings.ruleset, prove: false,
});
const search = (scene: Fixture, serialized: string, settings: EvalSettings): Promise<EvalResult> =>
  searchOrchestrated(createLocalExecutor(serialized, scene.settings.ruleset), settings);

/** The side that chooses at the root: the one whose list is not the waiting sentinel. */
const choosingSide = (result: EvalResult): 'p1' | 'p2' => (result.perSide.p1[0]?.choice === 'wait' ? 'p2' : 'p1');

/** The reference: every row's choice played on a copy, then the search of the board it makes (the app's own turn search, depth 1). */
async function perBody(scene: Fixture, serialized: string, settings: EvalSettings, side: 'p1' | 'p2', choices: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const choice of choices) {
    const copy = deserializeBattleExact(serialized);
    copy.prng = new PRNG([1, 2, 3, 4]);
    if (!copy.choose(side, choice)) throw new Error(`${side} ${choice} rejected`);
    const sub = await search(scene, serializeLiveBattle(copy), settings);
    out.set(choice, side === 'p1' ? sub.score : -sub.score);
  }
  return out;
}

const argmax = (values: Map<string, number>): string => [...values].sort((a, b) => b[1] - a[1])[0][0];

/** What a row has to hold: the first row is the best body by the turn after it, and every row carries that turn's value. */
async function expectTurnValues(scene: Fixture, serialized: string, settings: EvalSettings): Promise<{ result: EvalResult; side: 'p1' | 'p2'; reference: Map<string, number> }> {
  const result = await search(scene, serialized, settings);
  const side = choosingSide(result);
  const rows = result.perSide[side];
  const reference = await perBody(scene, serialized, settings, side, rows.map(row => row.choice));
  expect(rows[0].choice).toBe(argmax(reference));
  for (const row of rows) expect(row.ev).toBeCloseTo(reference.get(row.choice)!, 6);
  return { result, side, reference };
}

describe('a forced replacement under the matrix is judged by the turn after it (singles, d1 s3)', () => {
  test('the shared game: after U-turn the first row is Great Tusk, the best body by the turn after it', async () => {
    await loadSimModsFor(gholdengo.forced);
    const { result, side } = await expectTurnValues(gholdengo, gholdengo.forced, settingsOf(gholdengo, 3));
    expect(side).toBe('p1');
    expect(result.perSide.p1[0].label).toBe('→ Great Tusk');
    expect(result.depthCompleted).toBe(2);
  }, 240_000);

  test('653785 turn 10: Weavile, the body the player sent, not Lopunny-Mega', async () => {
    const scene = read('forced-root/singles-653785-t10.json');
    await loadSimModsFor(scene.serialized);
    const { result, side } = await expectTurnValues(scene, scene.serialized, settingsOf(scene, 3));
    expect(side).toBe('p1');
    expect(result.perSide.p1[0].label).toBe('→ Weavile');
  }, 600_000);

  test('655336 turn 5 (p2): Lopunny by the turn after it, not Clefable', async () => {
    const scene = read('forced-root/singles-655336-t5.json');
    await loadSimModsFor(scene.serialized);
    const { result, side } = await expectTurnValues(scene, scene.serialized, settingsOf(scene, 3));
    expect(side).toBe('p2');
    expect(result.perSide.p2[0].label).toBe('→ Lopunny');
  }, 600_000);
});

describe('doubles under an explicit matrix: the same rule on every assignment', () => {
  test('VGC 2630685175 turn 2 (p1, one slot): the first row is the assignment the next turn rates best', async () => {
    const scene = read('forced-root/vgc-2630685175-t2.json');
    await loadSimModsFor(scene.serialized);
    const { result, side } = await expectTurnValues(scene, scene.serialized, settingsOf(scene, 1));
    expect(side).toBe('p1');
    expect(result.depthCompleted).toBe(2);
  }, 600_000);

  test('VGC 2630685175 turn 4 (p2, both slots): every assignment is searched', async () => {
    const scene = read('forced-root/vgc-2630685175-t4.json');
    await loadSimModsFor(scene.serialized);
    const { result, side, reference } = await expectTurnValues(scene, scene.serialized, settingsOf(scene, 1));
    expect(side).toBe('p2');
    expect(reference.size).toBe(result.perSide.p2.length);
  }, 600_000);
});

/** An executor that counts the sub-searches that ask for a whole turn, and runs `onTurn` when one starts. */
function counting(base: SearchExecutor, onTurn?: () => void): { executor: SearchExecutor; turns: () => number } {
  let turns = 0;
  return {
    turns: () => turns,
    executor: {
      ...base,
      subSearch: job => {
        if ((job as { turn?: boolean }).turn) { turns += 1; onTurn?.(); }
        return base.subSearch(job);
      },
    },
  };
}

const rowsOf = (result: EvalResult, side: 'p1' | 'p2') => result.perSide[side].map(row => [row.label, row.ev]);

/** The guards run on a small game of the simulator's own: Rillaboom's Memento faints it, and P1 chooses among Pikachu, Eevee and Snorlax. */
const mon = (species: string, moves: string[]): PokemonSet => ({
  name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy',
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 50,
});
function smallGame(memento: boolean): string {
  const battle = new Battle({
    formatid: toID('gen9customgame') as never, seed: [1, 2, 3, 4],
    p1: { name: 'Alpha', team: Teams.pack([mon('Rillaboom', ['Memento', 'Splash']), mon('Pikachu', ['Thunderbolt']), mon('Eevee', ['Tackle']), mon('Snorlax', ['Body Slam'])]) },
    p2: { name: 'Beta', team: Teams.pack([mon('Corviknight', ['Splash', 'Brave Bird']), mon('Garchomp', ['Earthquake'])]) },
  });
  if (battle.sides[0].requestState === 'teampreview') {
    battle.choose('p1', 'default');
    battle.choose('p2', 'default');
  }
  if (memento) {
    battle.choose('p1', 'move 1');
    battle.choose('p2', 'move 1');
  }
  return serializeLiveBattle(battle);
}
const small = { settings: { tera: false, ruleset: 'standard' as StaticRuleset, sleepClause: false }, serialized: smallGame(true) };

describe('guards', () => {
  test('a root with no forced request keeps its matrix: no turn search, depth 1', async () => {
    const open = smallGame(false);
    const { executor, turns } = counting(createLocalExecutor(open, small.settings.ruleset));
    const result = await searchOrchestrated(executor, settingsOf(small, 3));
    expect(turns()).toBe(0);
    expect(result.depthCompleted).toBe(1);
  }, 120_000);

  test('the small game stands at a forced request and the turn searches match the reference', async () => {
    const { result, side } = await expectTurnValues(small, small.serialized, settingsOf(small, 3));
    expect(side).toBe('p1');
    expect(result.depthCompleted).toBe(2);
    expect(result.perSide.p1).toHaveLength(3);
  }, 120_000);

  test('the sync search and the orchestrated search agree at a forced root', async () => {
    const settings = settingsOf(small, 3);
    const sync = searchPosition(small.serialized, settings);
    const orchestrated = await search(small, small.serialized, settings);
    expect(sync.depthCompleted).toBe(orchestrated.depthCompleted);
    expect(sync.score).toBeCloseTo(orchestrated.score, 9);
    expect(rowsOf(sync, 'p1')).toEqual(rowsOf(orchestrated, 'p1'));
  }, 120_000);

  test.each([
    ['singles (the small game)', 'small'],
    ['doubles (VGC 2630685175 turn 2)', 'vgc'],
  ])('the tree keeps its own forced node, %s: no turn search', async (_name, which) => {
    const scene = which === 'vgc' ? read('forced-root/vgc-2630685175-t2.json') : small;
    await loadSimModsFor(scene.serialized);
    const previous = searchBudget();
    configureSearchBudget({ ...previous, trees: 2, iterations: 50 });
    try {
      const base = createLocalTreeExecutor(scene.serialized, scene.settings.ruleset);
      const counted = counting(base);
      await searchTreesOrchestrated({ ...base, subSearch: counted.executor.subSearch }, { ...settingsOf(scene, 1), mode: 'mcts' });
      expect(counted.turns()).toBe(0);
    } finally {
      configureSearchBudget(previous === SEARCH_BUDGET_DEFAULT ? null : previous);
    }
  }, 240_000);

  test('Auto keeps the tree in doubles from the first turn and the matrix in early singles', () => {
    expect(autoTurnSettings(0.12, true).mode).toBe('mcts');
    expect(autoTurnSettings(0.08, false)).toEqual({ depth: 1, samples: 3, mode: 'matrix' });
  });

  test('a stop before the turn searches leaves the depth-1 result, sync and orchestrated', async () => {
    const settings = settingsOf(small, 3);
    const { executor, turns } = counting(createLocalExecutor(small.serialized, small.settings.ruleset));
    const stopped = await searchOrchestrated(executor, settings, { shouldStop: () => true });
    const sync = searchPosition(small.serialized, settings, { shouldStop: () => true });
    expect(turns()).toBe(0);
    expect(stopped.depthCompleted).toBe(1);
    expect(sync.depthCompleted).toBe(1);
    expect(rowsOf(sync, 'p1')).toEqual(rowsOf(stopped, 'p1'));
  }, 120_000);

  test('a stop during the turn searches discards them: no row mixes a turn value with an arrival value', async () => {
    const settings = settingsOf(small, 3);
    const baseline = await searchOrchestrated(createLocalExecutor(small.serialized, small.settings.ruleset), settings, { shouldStop: () => true });
    let stop = false;
    const { executor } = counting(createLocalExecutor(small.serialized, small.settings.ruleset), () => { stop = true; });
    const orchestrated = await searchOrchestrated(executor, settings, { shouldStop: () => stop });
    expect(orchestrated.depthCompleted).toBe(1);
    expect(rowsOf(orchestrated, 'p1')).toEqual(rowsOf(baseline, 'p1'));
    let flipped = false;
    const sync = searchPosition(small.serialized, settings, { shouldStop: () => flipped, onProgress: progress => { if (progress.depth === 2) flipped = true; } });
    expect(sync.depthCompleted).toBe(1);
    expect(rowsOf(sync, 'p1')).toEqual(rowsOf(baseline, 'p1'));
  }, 240_000);

  test('an explicit depth 2 reads the turn after the replacement once: rows equal the depth-1 forced rows', async () => {
    const d1 = await search(small, small.serialized, settingsOf(small, 3, 1));
    const d2 = await search(small, small.serialized, settingsOf(small, 3, 2));
    expect(d2.depthCompleted).toBe(2);
    expect(rowsOf(d2, 'p1')).toEqual(rowsOf(d1, 'p1'));
  }, 240_000);
});
