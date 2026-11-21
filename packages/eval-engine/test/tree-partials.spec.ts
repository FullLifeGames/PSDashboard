import { readFileSync } from 'node:fs';
import { describe, expect, onTestFinished, test } from 'vitest';
import { mctsTreeSearch } from '../src/mcts';
import { loadSimModsFor } from '../src/forward/sim-mods';
import { configureSearchBudget, parseSearchBudget } from '../src/search/budget';
import { createLocalTreeExecutor, searchTreesOrchestrated, type TreeExecutor } from '../src/tree-orchestrator';
import type { EvalResult, EvalSettings } from '../src/types';
import type { StaticRuleset } from '../src/eval-function';

/**
 * Round 89 (SB-9, gate finding BROKEN 1 of tester 4): a tree search streamed its first result only when a whole tree had ended, so a
 * stop in the first 45 seconds of a doubles or VGC replacement kept nothing. Tree 0 now forwards its own interim result (every 150
 * iterations, mcts.ts) until the first tree ends, and only for a caller that listens: the bank and the game analysis pass no listener
 * and get the code path they had. The rows below hold three things: the interim result comes before the first tree ends (VGC forced
 * replacement, a normal Doubles OU turn, a singles tree turn), only tree 0 is asked and only when someone listens, and a listener
 * changes no number of the search (final result, tree stats).
 */

interface Scene { serialized: string; settings?: { tera: boolean; ruleset: StaticRuleset; sleepClause: boolean }; tera?: EvalSettings['tera']; sleepClause?: boolean }
const read = (path: string): Scene => JSON.parse(readFileSync(new URL(`./fixtures/${path}`, import.meta.url), 'utf-8')) as Scene;

/** A lean budget: two trees of 160 iterations, so the one interim result (iteration 150) lies before the end of every tree. */
function leanBudget(): void {
  configureSearchBudget(parseSearchBudget('trees=2,iterations=160'));
  onTestFinished(() => configureSearchBudget(null));
}

interface Board { name: string; scene: Scene; settings: EvalSettings; ruleset: StaticRuleset }
const board = (name: string, path: string): Board => {
  const scene = read(path);
  const ruleset = scene.settings?.ruleset ?? 'standard';
  return {
    name, scene, ruleset,
    settings: {
      depth: 1, samples: 1, mode: 'mcts', tera: scene.settings?.tera ?? scene.tera ?? true, sleepClause: scene.settings?.sleepClause ?? scene.sleepClause,
      ruleset, prove: false,
    },
  };
};
const BOARDS = [
  board('VGC 2630685175 turn 4, forced replacement of p2 (two slots)', 'forced-root/vgc-2630685175-t4.json'),
  board('Doubles OU 2663093831 turn 12', 'positions/gen9doublesou-2663093831-t12.json'),
  board('singles OU 749828 turn 23 (a tree turn)', 'positions/smogtours-gen9ou-749828-t23.json'),
];

/** The local executor with a log: "partial" when a tree hands its interim result on, "tree-done" when a tree returns, and the fourth argument per offset. */
function logging(serialized: string, ruleset: StaticRuleset): { executor: TreeExecutor; events: string[]; asked: Map<number, unknown>; partials: EvalResult[] } {
  const local = createLocalTreeExecutor(serialized, ruleset);
  const events: string[] = [];
  const partials: EvalResult[] = [];
  const asked = new Map<number, unknown>();
  const executor: TreeExecutor = {
    ...local,
    tree: async (settings, offset, onProgress, onPartial) => {
      asked.set(offset, onPartial);
      const tree = await local.tree(settings, offset, onProgress, onPartial && (result => { events.push('partial'); partials.push(result); onPartial(result); }));
      events.push('tree-done');
      return tree;
    },
  };
  return { executor, events, asked, partials };
}

describe('tree 0 streams its interim result until the first tree ends', () => {
  for (const b of BOARDS) {
    test(`${b.name}: a partial arrives before the first tree is done`, { timeout: 600_000 }, async () => {
      leanBudget();
      await loadSimModsFor(b.scene.serialized);
      const { executor, events, partials } = logging(b.scene.serialized, b.ruleset);
      const heard: EvalResult[] = [];
      await searchTreesOrchestrated(executor, b.settings, { onPartial: result => heard.push(result) });
      expect(events.indexOf('partial'), 'the tree handed on an interim result').toBeGreaterThanOrEqual(0);
      expect(events.indexOf('partial')).toBeLessThan(events.indexOf('tree-done'));
      expect(heard[0], 'the caller hears it first').toBe(partials[0]);
      expect(heard[0].perSide.p1.length + heard[0].perSide.p2.length).toBeGreaterThan(0);
    });
  }

  test('the forced replacement of VGC turn 4 shows the p2 switch-in pairs and p1 waiting', { timeout: 600_000 }, async () => {
    leanBudget();
    const b = BOARDS[0];
    await loadSimModsFor(b.scene.serialized);
    const { executor } = logging(b.scene.serialized, b.ruleset);
    const heard: EvalResult[] = [];
    await searchTreesOrchestrated(executor, b.settings, { onPartial: result => heard.push(result) });
    const first = heard[0];
    expect(first.perSide.p1.map(row => row.choice)).toEqual(['wait']);
    expect(first.perSide.p2.length).toBeGreaterThan(1);
    for (const row of first.perSide.p2) expect(row.choice, row.choice).toMatch(/^switch \d, switch \d$/);
  });

  test('only tree 0 is asked for interim results, and only when the caller listens', { timeout: 600_000 }, async () => {
    leanBudget();
    const b = BOARDS[0];
    await loadSimModsFor(b.scene.serialized);
    const listening = logging(b.scene.serialized, b.ruleset);
    await searchTreesOrchestrated(listening.executor, b.settings, { onPartial: () => {} });
    expect(typeof listening.asked.get(0)).toBe('function');
    expect(listening.asked.get(1)).toBeUndefined();
    const silent = logging(b.scene.serialized, b.ruleset);
    await searchTreesOrchestrated(silent.executor, b.settings);
    expect([...silent.asked.entries()].map(([offset, fn]) => [offset, fn]), 'the bank path').toEqual([[0, undefined], [1, undefined]]);
  });

  test('no interim result is forwarded once a tree has finished', { timeout: 600_000 }, async () => {
    leanBudget();
    const b = BOARDS[0];
    await loadSimModsFor(b.scene.serialized);
    const local = createLocalTreeExecutor(b.scene.serialized, b.ruleset);
    let release = () => {};
    const othersDone = new Promise<void>(resolve => { release = resolve; });
    let late: ((result: EvalResult) => void) | undefined;
    const executor: TreeExecutor = {
      ...local,
      tree: async (settings, offset, onProgress, onPartial) => {
        if (offset === 0) late = onPartial;
        const tree = await local.tree(settings, offset, onProgress);
        if (offset === 0) await othersDone;
        else release();
        return tree;
      },
    };
    const heard: EvalResult[] = [];
    let after = -1;
    const run = searchTreesOrchestrated(executor, b.settings, { onPartial: result => heard.push(result) });
    await othersDone;
    await new Promise(resolve => setTimeout(resolve, 0));
    after = heard.length;
    expect(late, 'tree 0 was handed a listener to drop').toBeTypeOf('function');
    late?.({ score: 0, interval: 0, depthCompleted: 9, perSide: { p1: [], p2: [] } });
    expect(heard.length, 'a late interim result of tree 0 is dropped').toBe(after);
    await run;
  });
});

describe('a listener changes no number of the search', () => {
  for (const b of BOARDS) {
    test(`${b.name}: the final result is the same with and without a listener`, { timeout: 600_000 }, async () => {
      leanBudget();
      await loadSimModsFor(b.scene.serialized);
      const heard: EvalResult[] = [];
      const withListener = await searchTreesOrchestrated(createLocalTreeExecutor(b.scene.serialized, b.ruleset), b.settings, { onPartial: result => heard.push(result) });
      const without = await searchTreesOrchestrated(createLocalTreeExecutor(b.scene.serialized, b.ruleset), b.settings);
      expect(heard.length).toBeGreaterThan(0);
      expect(withListener).toEqual(without);
    });
  }

  for (const b of [BOARDS[0], BOARDS[1]]) {
    test(`${b.name}: the tree's stats are byte-identical with and without onPartial`, { timeout: 600_000 }, async () => {
      leanBudget();
      await loadSimModsFor(b.scene.serialized);
      let calls = 0;
      const withPartial = mctsTreeSearch(b.scene.serialized, b.settings, 0, { onPartial: () => { calls++; } });
      const without = mctsTreeSearch(b.scene.serialized, b.settings, 0);
      expect(calls).toBeGreaterThan(0);
      expect(JSON.stringify(withPartial)).toBe(JSON.stringify(without));
    });
  }
});
