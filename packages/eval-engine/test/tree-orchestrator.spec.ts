import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { replayRuleset } from '@fulllifegames/replay-core';
import { mctsTreeSearch } from '../src/mcts';
import { MCTS_TREES, mergeMctsTrees, rowCompletedCells, starvedSupportCells } from '../src/mcts-merge';
import { playedIndices } from '../src/verify-select';
import { createLocalExecutor } from '../src/search';
import { applyForcedWin, forcedWinInput } from '../src/search/forced-win-apply';
import { cellKey } from '../src/rank';
import { createLocalTreeExecutor, searchTreesOrchestrated, type TreeExecutor } from '../src/tree-orchestrator';
import type { EvalCellJob, EvalCellValue, EvalSettings, ForcedWinInput, ForcedWinOutcome, MctsTreeStats } from '../src/types';
import type { StaticRuleset } from '../src/eval-function';

interface Fixture { serialized: string; tera?: EvalSettings['tera']; sleepClause?: boolean; keepPlayed?: EvalSettings['keepPlayed'] | null; played?: EvalSettings['keepPlayed'] }

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/positions/${name}.json`, import.meta.url), 'utf-8')) as Fixture;
const position = (name: string) => fixture(name).serialized;
/** Round 65: a fixture's rule set, named from its replay id as the hosts name it (useEvalView, bankSettings). */
const rulesetOf = (name: string): StaticRuleset => replayRuleset({ id: name.replace(/-t\d+$/, ''), log: '' });
const CASES = ['smogtours-gen9ou-749828-t23', 'gen9ou-2658658993-t2', 'gen9doublesou-2663093831-t12'];
/** Positions whose search runs a verify round (the doubles one after the pair plan's check round). */
const VERIFYING = ['smogtours-gen6ou-648453-t13', 'gen9doublesou-2663093831-t12'];

/** What the orchestrator asked of its executor: tree offsets in call order, the trees by offset, every cells round, every proof. */
interface Recording {
  offsets: number[];
  trees: MctsTreeStats[];
  rounds: { jobs: EvalCellJob[]; values: EvalCellValue[] }[];
  proofs: { input: ForcedWinInput; outcome: ForcedWinOutcome | null }[];
}

/**
 * The local executor with a record of every call. `lastFirst` holds tree 0 back until the other trees
 * are done, so the trees finish in an order other than their seed offsets.
 */
function recordingExecutor(serialized: string, lastFirst = false, ruleset: StaticRuleset = 'standard'): { executor: TreeExecutor; record: Recording } {
  const local = createLocalTreeExecutor(serialized, ruleset);
  const record: Recording = { offsets: [], trees: [], rounds: [], proofs: [] };
  let release = () => {};
  const othersDone = new Promise<void>(resolve => { release = resolve; });
  let finished = 0;
  const executor: TreeExecutor = {
    ...local,
    tree: async (settings, offset, onProgress) => {
      record.offsets.push(offset);
      const tree = await local.tree(settings, offset, onProgress);
      if (lastFirst && offset === 0) await othersDone;
      record.trees[offset] = tree;
      if (offset !== 0 && ++finished === MCTS_TREES - 1) release();
      return tree;
    },
    evalCells: async (jobs, onDone) => {
      const values = await local.evalCells(jobs, onDone);
      record.rounds.push({ jobs, values });
      return values;
    },
    prove: async input => {
      const outcome = await local.prove(input);
      record.proofs.push({ input, outcome: structuredClone(outcome) });
      return outcome;
    },
  };
  return { executor, record };
}

const settingsOf = (name: string, keepPlayed?: EvalSettings['keepPlayed']): EvalSettings => {
  const { tera, sleepClause } = fixture(name);
  return {
    depth: 1, samples: 1, mode: 'mcts', tera: tera ?? true, sleepClause: sleepClause ?? true, ruleset: rulesetOf(name),
    ...(keepPlayed ? { keepPlayed } : {}),
  };
};

/**
 * Round 64 (T126): the real orchestrator, read through what it asks of its executor. Before, the test
 * compared it with a hand copy of itself that round 63 changed in the same commit, on cases without
 * keepPlayed and without a sleep clause, so dropping the played row, the sleep clause of the verify
 * step, the tree order or the verified input of the prover all passed (counter-probes in the lane C
 * ledger of round 64).
 */
describe('tree orchestration (round 61; read through the executor since round 64)', () => {
  test('runs every tree offset once and merges them in offset order, whatever order they finish in', { timeout: 600_000 }, async () => {
    for (const name of VERIFYING) {
      const settings = settingsOf(name);
      const inOrder = recordingExecutor(position(name));
      const late = recordingExecutor(position(name), true);
      const expected = await searchTreesOrchestrated(inOrder.executor, settings);
      const result = await searchTreesOrchestrated(late.executor, settings);
      expect([...late.record.offsets].sort(), name).toEqual(Array.from({ length: MCTS_TREES }, (_, offset) => offset));
      expect(result, name).toEqual(expected);
    }
  });

  test('verifies one ply deeper with the search\'s own Tera and sleep clause; doubles asks the pair plan first', { timeout: 600_000 }, async () => {
    for (const name of VERIFYING) {
      const settings = settingsOf(name);
      const { executor, record } = recordingExecutor(position(name));
      await searchTreesOrchestrated(executor, settings);
      const doubles = name.includes('doubles');
      expect(record.rounds.length, name).toBe(doubles ? 2 : 1);
      const verify = record.rounds.at(-1)!;
      expect(verify.jobs.length, name).toBeGreaterThan(0);
      for (const job of verify.jobs) {
        expect(job.deepen, name).toEqual({ depth: 1, samples: 1, tera: settings.tera, sleepClause: settings.sleepClause, ruleset: settings.ruleset });
      }
      if (doubles) expect(record.rounds[0].jobs.every(job => job.deepen === undefined), name).toBe(true);
    }
  });

  test('the played row joins the verify set (singles: the same trees with and without the played turn)', { timeout: 600_000 }, async () => {
    const name = VERIFYING[0];
    const without = recordingExecutor(position(name));
    await searchTreesOrchestrated(without.executor, settingsOf(name));
    // The played turn names p1's least visited switch: a row the trees leave out of their support.
    const trees = without.record.trees;
    const visits = (i: number) => trees.reduce((sum, tree) => sum + tree.p1N[i], 0);
    const rare = trees[0].p1Options.map((option, i) => ({ option, i })).filter(entry => entry.option.label.startsWith('→ '))
      .sort((a, b) => visits(a.i) - visits(b.i))[0];
    const species = rare.option.label.slice(2);
    const keepPlayed: EvalSettings['keepPlayed'] = { p1: { kind: 'switch', name: species, species }, p2: null };
    const withPlayed = recordingExecutor(position(name));
    await searchTreesOrchestrated(withPlayed.executor, settingsOf(name, keepPlayed));
    // keepPlayed reaches the singles options only through slots: the trees are the same.
    expect(withPlayed.record.trees).toEqual(without.record.trees);
    const merged = mergeMctsTrees(withPlayed.record.trees);
    const played = playedIndices(withPlayed.record.trees, merged, keepPlayed);
    const keys = (record: Recording) => new Set((record.rounds.at(-1)?.jobs ?? []).map(job => cellKey(job.i, job.j)));
    const onlyWithPlayed = [...keys(withPlayed.record)].filter(key => !keys(without.record).has(key));
    expect(played.p1).toBe(rare.i);
    expect(onlyWithPlayed.length).toBeGreaterThan(0);
    for (const key of onlyWithPlayed) expect(Math.floor(key / 10_000), `cell ${key}`).toBe(played.p1);
  });

  test('the played row joins the verify set (doubles: VGC 2629703929 t8, p1 Heat Wave + Protect)', { timeout: 600_000 }, async () => {
    const name = 'gen9vgc2026regi-2629703929-t8';
    const keepPlayed = fixture(name).keepPlayed!;
    // Round 65 gate (2b): a VGC position, searched under the VGC rule set (the hand doubles table) as the app searches it.
    expect(rulesetOf(name)).toBe('vgc');
    const { executor, record } = recordingExecutor(position(name), false, rulesetOf(name));
    await searchTreesOrchestrated(executor, settingsOf(name, keepPlayed));
    const merged = mergeMctsTrees(record.trees);
    const played = playedIndices(record.trees, merged, keepPlayed);
    expect(played.p1).toBeDefined();
    // The trees' own support leaves the played row out; the played option brings it into the check and verify rounds.
    const support = rowCompletedCells(record.trees, merged, starvedSupportCells(record.trees, merged));
    expect(support.some(job => job.i === played.p1)).toBe(false);
    expect(record.rounds.at(-1)!.jobs.some(job => job.i === played.p1)).toBe(true);
  });

  test('the matrix reads the verified values and the prover proves the verified result', { timeout: 600_000 }, async () => {
    for (const name of VERIFYING) {
      const settings = settingsOf(name);
      const { executor, record } = recordingExecutor(position(name));
      const result = await searchTreesOrchestrated(executor, settings);
      const values = record.rounds.at(-1)!.values;
      const verified = mergeMctsTrees(record.trees, new Map(values.map(value => [cellKey(value.i, value.j), value])));
      const unverified = mergeMctsTrees(record.trees);
      expect(verified.matrix!.values, name).not.toEqual(unverified.matrix!.values);
      expect(record.proofs.length, name).toBe(1);
      expect(record.proofs[0].input, name).toEqual(forcedWinInput(verified, settings));
      expect(forcedWinInput(verified, settings), `${name}: the verified ranking reaches the prover`).not.toEqual(forcedWinInput(unverified, settings));
      applyForcedWin(verified, record.proofs[0].outcome);
      expect(result, name).toEqual(verified);
    }
  });

  test('a stop after the trees skips verify and prover', { timeout: 300_000 }, async () => {
    const serialized = position(CASES[0]);
    const local = createLocalTreeExecutor(serialized);
    const calls = { evalCells: 0, prove: 0, partial: 0 };
    let stop = false;
    let trees = 0;
    const executor: TreeExecutor = {
      ...local,
      tree: async (settings, offset, onProgress) => {
        const tree = await local.tree(settings, offset, onProgress);
        if (++trees === MCTS_TREES) stop = true;
        return tree;
      },
      evalCells: async jobs => { calls.evalCells++; return local.evalCells(jobs); },
      prove: async input => { calls.prove++; return local.prove(input); },
    };
    await searchTreesOrchestrated(executor, { depth: 1, samples: 1, mode: 'mcts' }, {
      shouldStop: () => stop,
      onPartial: () => { if (stop) calls.partial++; },
    });
    expect(calls).toEqual({ evalCells: 0, prove: 0, partial: 0 });
  });

  test('a failing verify round returns the unverified merge and still proves', { timeout: 600_000 }, async () => {
    for (const name of CASES) {
      const serialized = position(name);
      const settings: EvalSettings = { depth: 1, samples: 1, mode: 'mcts', tera: true };
      const trees = Array.from({ length: MCTS_TREES }, (_, offset) => mctsTreeSearch(serialized, settings, offset));
      const merged = mergeMctsTrees(trees);
      if (rowCompletedCells(trees, merged, starvedSupportCells(trees, merged)).length === 0) continue;
      applyForcedWin(merged, await createLocalExecutor(serialized).prove(forcedWinInput(merged, settings)));
      const local = createLocalTreeExecutor(serialized);
      const executor: TreeExecutor = { ...local, evalCells: async () => { throw new Error('worker crashed'); } };
      expect(await searchTreesOrchestrated(executor, settings), name).toEqual(merged);
      return;
    }
    throw new Error('no case runs the verify round');
  });
});
