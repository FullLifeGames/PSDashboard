import { describe, expect, onTestFinished, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { replayRuleset } from '@fulllifegames/replay-core';
import { mctsTreeSearch } from '../src/mcts';
import { mergeMctsTrees, rowCompletedCells, starvedSupportCells } from '../src/mcts-merge';
import { playedIndices } from '../src/verify-select';
import { createLocalExecutor } from '../src/search';
import { applyForcedWin, forcedWinInput } from '../src/search/forced-win-apply';
import { cellKey } from '../src/rank';
import { createLocalTreeExecutor, searchTreesOrchestrated, type TreeExecutor } from '../src/tree-orchestrator';
import type {
  EvalCellJob,
  EvalCellValue,
  EvalSettings,
  ForcedWinInput,
  ForcedWinOutcome,
  MctsTreeStats,
  EvalLine,
  EvalResult,
} from '../src/types';
import type { StaticRuleset } from '../src/eval-function';
import { configureSearchBudget, parseSearchBudget, searchBudget } from '../src/search/budget';
import { State } from '@pkmn/sim';
import { createBranchStateFromBattle } from '../src/branch/state';
import { requiredChoicesForActiveSlots, type BranchSlotChoice } from '../src/branch-choices';
import { resolveSideChoices } from '../src/branch/execute';
import { dieKey } from '../src/dice/types';
import { createMatchupCache } from '../src/eval-function';
import { leafValue } from '../src/search/leaf';
import { worstAnswer } from '../src/turn-analysis/worst-answer';
import { branchOf, runTurn, type Commands } from './branch-dice-support';
import { set } from './move-oracle';
import { loadSimModsFor } from '../src/forward/sim-mods';

interface Fixture { serialized: string; tera?: EvalSettings['tera']; sleepClause?: boolean; keepPlayed?: EvalSettings['keepPlayed'] | null; played?: EvalSettings['keepPlayed'] }

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/positions/${name}.json`, import.meta.url), 'utf-8')) as Fixture;
const position = (name: string) => fixture(name).serialized;
const rulesetOf = (name: string): StaticRuleset => replayRuleset({ id: name.replace(/-t\d+$/, ''), log: '' });
const CASES = ['smogtours-gen9ou-749828-t23', 'gen9ou-2658658993-t2', 'gen9doublesou-2663093831-t12'];
const VERIFYING = ['smogtours-gen6ou-648453-t13', 'gen9doublesou-2663093831-t12'];

interface Recording {
  offsets: number[];
  trees: MctsTreeStats[];
  rounds: { jobs: EvalCellJob[]; values: EvalCellValue[] }[];
  proofs: { input: ForcedWinInput; outcome: ForcedWinOutcome | null }[];
}

// `lastFirst` holds tree 0 back until the other trees are done, so they finish out of seed-offset order.
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
      if (offset !== 0 && ++finished === searchBudget().trees - 1) release();
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

// The verify round is the first cells round whose jobs all deepen.
const verifyRound = (record: Recording) => record.rounds.find(round => round.jobs.length > 0 && round.jobs.every(job => job.deepen !== undefined && !job.plain));

async function withAnswers<T>(mode: 'off' | 'protect' | 'full', run: () => Promise<T>): Promise<T> {
  const saved = process.env.EVAL_DOUBLES_ANSWERS;
  process.env.EVAL_DOUBLES_ANSWERS = mode;
  try {
    return await run();
  } finally {
    if (saved === undefined) delete process.env.EVAL_DOUBLES_ANSWERS;
    else process.env.EVAL_DOUBLES_ANSWERS = saved;
  }
}

const recordedRuns = new Map<string, Promise<{ result: EvalResult; record: Recording }>>();

async function recorded(name: string, answers?: 'off'): Promise<{ result: EvalResult; record: Recording }> {
  const key = `${name}|${answers ?? 'default'}|${JSON.stringify(searchBudget())}`;
  if (!recordedRuns.has(key)) {
    const run = async () => {
      const { executor, record } = recordingExecutor(position(name));
      const search = () => searchTreesOrchestrated(executor, settingsOf(name));
      return { result: await (answers ? withAnswers(answers, search) : search()), record };
    };
    recordedRuns.set(key, run());
  }
  return structuredClone(await recordedRuns.get(key)!);
}

const withoutLines = <T extends { lines?: unknown }>(result: T): T => ({ ...result, lines: undefined });

const settingsOf = (name: string, keepPlayed?: EvalSettings['keepPlayed']): EvalSettings => {
  const { tera, sleepClause } = fixture(name);
  return {
    depth: 1, samples: 1, mode: 'mcts', tera: tera ?? true, sleepClause: sleepClause ?? true, ruleset: rulesetOf(name),
    ...(keepPlayed ? { keepPlayed } : {}),
  };
};

describe('tree orchestration through the executor', () => {
  test('the answer round follows the verify round with plain cells, and the prover proves its ranking', { timeout: 600_000 }, async () => {
    const name = 'gen9vgc2026regi-2630685175-t7-played';
    const played = fixture(name);
    const settings: EvalSettings = { depth: 1, samples: 1, mode: 'mcts', tera: played.tera ?? true, sleepClause: played.sleepClause ?? false, ruleset: 'vgc', keepPlayed: played.keepPlayed ?? undefined };
    const { executor, record } = recordingExecutor(position(name), false, 'vgc');
    const result = await withAnswers('protect', () => searchTreesOrchestrated(executor, settings));
    const verifyAt = record.rounds.indexOf(verifyRound(record)!);
    const answers = record.rounds.slice(verifyAt + 1);
    expect(answers.length).toBeGreaterThan(0);
    expect(answers[0].jobs.every(job => job.plain && job.deepen === undefined)).toBe(true);
    expect(answers.every(round => round.jobs.every(job => job.plain || job.deepen !== undefined))).toBe(true);
    expect(record.proofs[0].input.rootOrder).toEqual(forcedWinInput(result, settings).rootOrder);
  });

  test.each([
    ['singles', CASES[0], [4, 5, 4, 5]],
    ['doubles', CASES[2], [4, 5, 3, 5]],
    ['doubles with three trees of unequal depth', CASES[2], [2, 5, 3]],
  ])('the depth the trees report never falls: %s', { timeout: 120_000 }, async (_name, name, depths) => {
    configureSearchBudget({ ...searchBudget(), trees: depths.length, iterations: 30 });
    onTestFinished(() => configureSearchBudget(null));
    const local = createLocalTreeExecutor(position(name), rulesetOf(name));
    const executor: TreeExecutor = {
      ...local,
      tree: (settings, offset, onProgress, onPartial) => {
        onProgress?.({ done: 1, total: 30, depth: depths[offset] });
        return local.tree(settings, offset, undefined, onPartial);
      },
    };
    const seen: number[] = [];
    await searchTreesOrchestrated(executor, settingsOf(name), { onProgress: progress => seen.push(progress.depth) });
    expect(seen).toEqual(depths.map((_, at) => Math.max(...depths.slice(0, at + 1))));
  });

  // Count the trees the budget in force runs: a constant beside it makes the late run wait for trees never started.
  test('a budget of three trees runs three offsets, whatever order they finish in', { timeout: 120_000 }, async () => {
    configureSearchBudget(parseSearchBudget('trees=3'));
    onTestFinished(() => configureSearchBudget(null));
    const name = VERIFYING[0];
    const late = recordingExecutor(position(name), true);
    await searchTreesOrchestrated(late.executor, settingsOf(name));
    expect([...late.record.offsets].sort()).toEqual([0, 1, 2]);
  });

  test('runs every tree offset once and merges them in offset order, whatever order they finish in', { timeout: 600_000 }, async () => {
    for (const name of VERIFYING) {
      const settings = settingsOf(name);
      const late = recordingExecutor(position(name), true);
      const { result: expected } = await recorded(name);
      const result = await searchTreesOrchestrated(late.executor, settings);
      expect([...late.record.offsets].sort(), name).toEqual(Array.from({ length: searchBudget().trees }, (_, offset) => offset));
      expect(result, name).toEqual(expected);
    }
  });

  test('verifies one ply deeper with the search\'s own Tera and sleep clause; doubles asks the pair plan first', { timeout: 600_000 }, async () => {
    // The answer round adds rounds of its own where it finds an answer, so this contract runs with it off.
    for (const name of VERIFYING) {
      const settings = settingsOf(name);
      const { record } = await recorded(name, 'off');
      const doubles = name.includes('doubles');
      expect(record.rounds.filter(round => !round.jobs.some(job => job.plain)).length, name).toBe(doubles ? 2 : 1);
      const verify = verifyRound(record)!;
      expect(verify.jobs.length, name).toBeGreaterThan(0);
      for (const job of verify.jobs) {
        expect(job.deepen, name).toEqual({ depth: 1, samples: 1, tera: settings.tera, sleepClause: settings.sleepClause, ruleset: settings.ruleset });
      }
      if (doubles) expect(record.rounds[0].jobs.every(job => job.deepen === undefined), name).toBe(true);
    }
  });

  test('the played row joins the verify set (singles: the same trees with and without the played turn)', { timeout: 600_000 }, async () => {
    const name = VERIFYING[0];
    const without = await recorded(name);
    const trees = without.record.trees;
    const visits = (i: number) => trees.reduce((sum, tree) => sum + tree.p1N[i], 0);
    const rare = trees[0].p1Options.map((option, i) => ({ option, i })).filter(entry => entry.option.label.startsWith('→ '))
      .sort((a, b) => visits(a.i) - visits(b.i))[0];
    const species = rare.option.label.slice(2);
    const keepPlayed: EvalSettings['keepPlayed'] = { p1: { kind: 'switch', name: species, species }, p2: null };
    const withPlayed = recordingExecutor(position(name));
    await searchTreesOrchestrated(withPlayed.executor, settingsOf(name, keepPlayed));
    expect(withPlayed.record.trees).toEqual(without.record.trees);
    const merged = mergeMctsTrees(withPlayed.record.trees);
    const played = playedIndices(withPlayed.record.trees, merged, keepPlayed);
    const keys = (record: Recording) => new Set((verifyRound(record)?.jobs ?? []).map(job => cellKey(job.i, job.j)));
    const onlyWithPlayed = [...keys(withPlayed.record)].filter(key => !keys(without.record).has(key));
    expect(played.p1).toBe(rare.i);
    expect(onlyWithPlayed.length).toBeGreaterThan(0);
    for (const key of onlyWithPlayed) expect(Math.floor(key / 10_000), `cell ${key}`).toBe(played.p1);
  });

  test('the played row joins the verify set (doubles: VGC 2630685175 t7, p1 U-turn + Tera Starstorm)', { timeout: 600_000 }, async () => {
    const name = 'gen9vgc2026regi-2630685175-t7-played';
    const keepPlayed = fixture(name).keepPlayed!;
    expect(rulesetOf(name)).toBe('vgc');
    const { executor, record } = recordingExecutor(position(name), false, rulesetOf(name));
    await searchTreesOrchestrated(executor, settingsOf(name, keepPlayed));
    const merged = mergeMctsTrees(record.trees);
    const played = playedIndices(record.trees, merged, keepPlayed);
    expect(played.p1).toBeDefined();
    expect(verifyRound(record)!.jobs.some(job => job.i === played.p1)).toBe(true);
  });

  test('the matrix reads the verified values and the prover proves the verified result', { timeout: 600_000 }, async () => {
    const shifted: string[] = [];
    for (const name of [...VERIFYING, 'smogtours-gen6ou-649664-t14-g1']) {
      const settings = settingsOf(name);
      const { result, record } = await recorded(name, 'off');
      const values = verifyRound(record)!.values;
      const verified = mergeMctsTrees(record.trees, new Map(values.map(value => [cellKey(value.i, value.j), value])));
      const unverified = mergeMctsTrees(record.trees);
      expect(verified.matrix!.values, name).not.toEqual(unverified.matrix!.values);
      expect(record.proofs.length, name).toBe(1);
      expect(record.proofs[0].input, name).toEqual(forcedWinInput(verified, settings));
      if (JSON.stringify(forcedWinInput(verified, settings)) !== JSON.stringify(forcedWinInput(unverified, settings))) shifted.push(name);
      applyForcedWin(verified, record.proofs[0].outcome);
      expect(withoutLines(result), name).toEqual(verified);
    }
    // Required: one shifted scene per game type; the Monte-Carlo reference (24 draws, blocks 1001 and 5001) shows it.
    expect(shifted, 'the verified ranking reaches the prover (singles)').toContain('smogtours-gen6ou-649664-t14-g1');
    expect(shifted, 'the verified ranking reaches the prover (doubles)').toContain('gen9doublesou-2663093831-t12');
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
        if (++trees === searchBudget().trees) stop = true;
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
      const trees = Array.from({ length: searchBudget().trees }, (_, offset) => mctsTreeSearch(serialized, settings, offset));
      const merged = mergeMctsTrees(trees);
      if (rowCompletedCells(trees, merged, starvedSupportCells(trees, merged)).length === 0) continue;
      applyForcedWin(merged, await createLocalExecutor(serialized).prove(forcedWinInput(merged, settings)));
      const local = createLocalTreeExecutor(serialized);
      const executor: TreeExecutor = { ...local, evalCells: async () => { throw new Error('worker crashed'); } };
      expect(withoutLines(await searchTreesOrchestrated(executor, settings)), name).toEqual(merged);
      return;
    }
    throw new Error('no case runs the verify round');
  });
});

const SETTINGS: EvalSettings = { depth: 1, samples: 1, mode: 'mcts', tera: false };

const looksLikeCommands = (battle: Parameters<typeof createBranchStateFromBattle>[0], side: 'p1' | 'p2', slots: (BranchSlotChoice | null)[]) => {
  const state = createBranchStateFromBattle(battle, [], {});
  const required = requiredChoicesForActiveSlots(side === 'p1' ? state.p1ActiveSlots : state.p2ActiveSlots, side === 'p1' ? state.p1ForceSwitches : state.p2ForceSwitches);
  return resolveSideChoices(battle!, side, slots, required);
};

async function playAsVariation(scene: Scene, line: EvalLine, seed: string): Promise<{ value: number; steps: number }> {
  const runtime = await branchOf(scene.format, scene.p1, scene.p2, seed);
  scene.prepare?.(runtime.battleStream.battle!);
  for (const step of line.steps) {
    const battle = runtime.battleStream.battle!;
    const commands: Commands = [];
    for (const side of ['p1', 'p2'] as const) {
      const choice = side === 'p1' ? step.p1 : step.p2;
      if (choice.choice === 'wait') continue;
      const resolved = looksLikeCommands(battle, side, choice.slots);
      expect(resolved.ok, `${line.side} ${line.label}: ${side} ${choice.label} resolves${resolved.ok ? '' : ` (${resolved.error})`}`).toBe(true);
      if (!resolved.ok) return { value: NaN, steps: 0 };
      commands.push({ side, command: resolved.command });
    }
    const played = await runTurn(runtime, commands, { p1: step.p1.slots, p2: step.p2.slots });
    expect(played.ok, `${line.side} ${line.label}: the turn plays${played.ok ? '' : ` (${played.error})`}`).toBe(true);
  }
  return { value: leafValue(runtime.battleStream.battle!, createMatchupCache()), steps: line.steps.length };
}

interface Scene {
  name: string;
  format: string;
  p1: ReturnType<typeof set>[];
  p2: ReturnType<typeof set>[];
  prepare?: (battle: NonNullable<Awaited<ReturnType<typeof branchOf>>['battleStream']['battle']>) => void;
  played: NonNullable<EvalSettings['keepPlayed']>;
}

const mon = (species: string, moves: string[]) => set(species, moves, { level: 50 });

const SCENES: Scene[] = [
  {
    name: 'singles: a hit that can miss, a knock-out and a replacement',
    format: 'gen9customgame',
    p1: [mon('Machamp', ['Dynamic Punch', 'Seismic Toss', 'Bulk Up']), mon('Gyarados', ['Waterfall', 'Earthquake']), mon('Mew', ['Psychic', 'Ice Beam'])],
    p2: [mon('Pikachu', ['Thunderbolt', 'Surf']), mon('Eevee', ['Tackle', 'Quick Attack']), mon('Snorlax', ['Body Slam', 'Rest'])],
    prepare: battle => { battle.sides[1].pokemon[0].hp = 1; },
    played: { p1: { kind: 'move', name: 'Bulk Up' }, p2: { kind: 'move', name: 'Surf' } },
  },
  {
    name: 'doubles: four choices a turn and a replacement',
    format: 'gen9doublescustomgame',
    p1: [mon('Incineroar', ['Fake Out', 'Flare Blitz', 'U-turn']), mon('Rillaboom', ['Grassy Glide', 'Wood Hammer']), mon('Amoonguss', ['Spore', 'Rage Powder']), mon('Urshifu', ['Close Combat', 'Sucker Punch'])],
    p2: [mon('Urshifu', ['Close Combat', 'Sucker Punch']), mon('Amoonguss', ['Spore', 'Rage Powder']), mon('Rillaboom', ['Grassy Glide', 'Wood Hammer']), mon('Incineroar', ['Fake Out', 'Flare Blitz', 'U-turn'])],
    played: {
      p1Slots: [{ kind: 'move', name: 'Fake Out', targetLoc: 1 }, { kind: 'move', name: 'Grassy Glide', targetLoc: null }],
      p2Slots: [{ kind: 'move', name: 'Close Combat', targetLoc: -1 }, { kind: 'move', name: 'Spore', targetLoc: -2 }],
    },
  },
];

const searched = new Map<string, Promise<EvalResult>>();

function search(scene: Scene, kind: 'lines' | 'plain' | 'pass'): Promise<EvalResult> {
  const key = `${scene.name}|${kind}`;
  if (!searched.has(key)) searched.set(key, searchOnce(scene, kind));
  return searched.get(key)!;
}

async function searchOnce(scene: Scene, kind: 'lines' | 'plain' | 'pass'): Promise<EvalResult> {
  const runtime = await branchOf(scene.format, scene.p1, scene.p2, '1,2,3,4');
  scene.prepare?.(runtime.battleStream.battle!);
  const serialized = JSON.stringify(State.serializeBattle(runtime.battleStream.battle!));
  const executor: TreeExecutor = kind !== 'plain' ? createLocalTreeExecutor(serialized) : { ...createLocalTreeExecutor(serialized), lines: undefined };
  return searchTreesOrchestrated(executor, { ...SETTINGS, keepPlayed: scene.played, ...(kind === 'pass' ? { linePass: 300 } : {}) });
}

describe.each(SCENES)('the lines of a tree search: $name', scene => {
  test('each side has its best row\'s line, and the lines change nothing else', async () => {
    const result = await search(scene, 'lines');
    const plain = await search(scene, 'plain');
    expect(plain.lines).toBeUndefined();
    expect(result.lines, 'the search carries lines').toBeDefined();
    const { lines, ...rest } = result;
    expect(rest, 'the score, the rankings, the matrix and the rest equal the run without the lines job').toEqual(plain);
    // the best rows of a singles search have a line; a doubles best row may stand on fewer visits than a line needs
    const held = (['p1', 'p2'] as const).filter(side => lines!.some(line => line.side === side && line.for.includes('engine') && line.label === result.perSide[side][0].label));
    expect(held.length, 'a best row holds its line').toBeGreaterThanOrEqual(scene.name.startsWith('singles') ? 2 : 1);
    for (const side of ['p1', 'p2'] as const) {
      const own = lines!.filter(line => line.side === side);
      for (const line of own) {
        expect(result.perSide[side].some(row => row.label === line.label), `${side} ${line.label} is a row of the result`).toBe(true);
        expect(line.steps.length).toBeGreaterThanOrEqual(1);
        expect(line.steps.length).toBeLessThanOrEqual(3);
        expect(Number.isFinite(line.end)).toBe(true);
      }
    }
  }, 120_000);

  test('the line pass changes no score, rank or grade, and the lines hold at least the turns they held', async () => {
    const passed = await search(scene, 'pass');
    const plain = await search(scene, 'plain');
    const lined = await search(scene, 'lines');
    const { lines, ...rest } = passed;
    expect(rest, 'the result outside the lines equals the run without the lines job').toEqual(plain);
    expect(lines, 'the passed search carries lines').toBeDefined();
    const turns = (list: EvalLine[] | undefined): number => (list ?? []).reduce((sum, line) => sum + line.steps.length, 0);
    expect(turns(lines)).toBeGreaterThanOrEqual(turns(lined.lines));
    for (const line of lines!) expect(line.steps.length).toBeLessThanOrEqual(3);
  }, 120_000);

  test('a step\'s dice ride on their holders, and the waiting side of a replacement holds no choice', async () => {
    const result = await search(scene, 'lines');
    for (const line of result.lines!) {
      for (const step of line.steps) {
        const carried = [...step.p1.slots, ...step.p2.slots].flatMap(slot => slot?.dice ?? []).map(die => dieKey(die.name)).sort();
        expect(carried, `${line.label}: every die of the step rides on a choice`).toEqual(step.dice.map(entry => dieKey(entry.die.name)).sort());
        if (step.replacement === 'p1') expect(step.p2.slots.every(slot => slot === null) && step.p2.choice === 'wait').toBe(true);
        if (step.replacement === 'p2') expect(step.p1.slots.every(slot => slot === null) && step.p1.choice === 'wait').toBe(true);
      }
    }
  }, 120_000);

  test('an engine line meets the answer that the merged ranking puts first, as far as a tree holds a line against it', async () => {
    const result = await search(scene, 'lines');
    for (const line of result.lines!.filter(entry => entry.for.includes('engine') && !entry.versus)) {
      const other = line.side === 'p1' ? 'p2' : 'p1';
      const first = line.steps[0];
      if (first.replacement) continue;
      const ranking = result.perSide[other].map(row => row.label);
      const at = ranking.indexOf(first[other].label);
      expect(at, `${line.side} ${line.label}: the answer ${first[other].label} is among the merged top three`).toBeGreaterThanOrEqual(0);
      expect(at, `${line.side} ${line.label}: the answer ${first[other].label} is among the merged top three`).toBeLessThanOrEqual(2);
    }
  }, 120_000);

  test('a line plays as a variation under two seeds and ends at its value', async () => {
    const result = await search(scene, 'lines');
    for (const line of result.lines!) {
      const first = await playAsVariation(scene, line, '1,2,3,4');
      const second = await playAsVariation(scene, line, '905,17,333,4096');
      const own = line.side === 'p1' ? 1 : -1;
      expect(first.steps).toBe(line.steps.length);
      if (!line.unforced) {
        expect(first.value * own, `${line.side} ${line.label}: the position after the line is worth what the line says`).toBeCloseTo(line.end, 9);
        expect(second.value, 'the other seed reaches the same position').toBeCloseTo(first.value, 9);
      }
    }
  }, 180_000);
});

describe.each(SCENES)('the line against the reply that hurts most: $name', scene => {
  test.each(['lines', 'pass'] as const)('a worst line meets the row\'s worst answer and sits beside the row\'s usual line (%s)', async kind => {
    const result = await search(scene, kind);
    const plain = await search(scene, 'plain');
    const { lines, ...rest } = result;
    expect(rest, 'nothing outside the lines moves').toEqual(plain);
    const worst = lines!.filter(line => line.versus === 'worst');
    for (const line of worst) {
      const row = result.perSide[line.side].find(entry => entry.label === line.label)!;
      const answer = worstAnswer(result, line.side, row);
      const other = line.side === 'p1' ? 'p2' : 'p1';
      expect(answer, `${line.side} ${line.label}: the result names a worst answer`).not.toBeNull();
      expect(line.steps[0][other].label, `${line.side} ${line.label}: the line meets the worst answer`).toBe(answer!.label);
      const usual = lines!.find(entry => entry.side === line.side && entry.label === line.label && !entry.versus && entry.for.join() === line.for.join());
      expect(usual, `${line.side} ${line.label}: the usual line stands beside it`).toBeDefined();
      expect(usual!.steps[0][other].label, 'the worst line is asked for only when the usual one meets another answer').not.toBe(answer!.label);
    }
    const usual = lines!.filter(line => !line.versus);
    expect(new Set(usual.map(line => `${line.side}|${line.label}|${line.for.join()}`)).size).toBe(usual.length);
  }, 120_000);

  test('the line pass finds a worst line on a singles scene; a doubles tree is thinner and may hold none (its best rows already meet their worst answer)', async () => {
    const result = await search(scene, 'pass');
    const worst = result.lines!.filter(line => line.versus === 'worst');
    if (scene.name.startsWith('singles')) expect(worst.length, 'at least one row holds its worst line').toBeGreaterThanOrEqual(1);
    else expect(worst.length).toBeGreaterThanOrEqual(0);
  }, 120_000);
});

describe('tree-partials', () => {
  interface Scene { serialized: string; settings?: { tera: boolean; ruleset: StaticRuleset; sleepClause: boolean }; tera?: EvalSettings['tera']; sleepClause?: boolean }
  const read = (path: string): Scene => JSON.parse(readFileSync(new URL(`./fixtures/${path}`, import.meta.url), 'utf-8')) as Scene;

  // Two trees of 160 iterations: the one interim result (iteration 150) lies before the end of every tree.
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
      const run = searchTreesOrchestrated(executor, b.settings, { onPartial: result => heard.push(result) });
      await othersDone;
      await new Promise(resolve => setTimeout(resolve, 0));
      const after = heard.length;
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
});
