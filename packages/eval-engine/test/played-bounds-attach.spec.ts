import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Battle } from '@pkmn/sim';
import { getBranchSimulatorFormat, logRules, replayRuleset, type ReplayData } from '@fulllifegames/replay-core';
import { analyzeTurn } from '../src/analysis';
import { blendWorlds } from '../src/branch/bring-worlds';
import { loadSimMods } from '../src/forward/sim-mods';
import { serializeBattleStable } from '../src/forward/serialize';
import { mctsSearch, mctsTreeSearch } from '../src/mcts';
import { mergeMctsTrees } from '../src/mcts-merge';
import { searchOrchestrated } from '../src/orchestrator';
import { parsePlayedActions, parsePlayedActionsDoubles, turnEvents, type PlayedBounds, type PlayedTurn } from '../src/played';
import { createLocalExecutor, searchPosition } from '../src/search';
import { configureSearchBudget, parseSearchBudget } from '../src/search/budget';
import { createLocalTreeExecutor, searchTreesOrchestrated } from '../src/tree-orchestrator';
import { playedBoundsOf } from '../src/branch/action-bound';
import { playedIndices } from '../src/verify-select';
import type { SimBattle } from '../src/branch/types';
import type { EvalResult, EvalSettings, RankedChoice } from '../src/types';
import type { StaticRuleset } from '../src/eval-function';
import { mon, RULES } from './dice-fixtures';
import { battleOf } from './power-oracle';

/**
 * Round 89 (#108, C4b): the order bound of a body that fell before it acted travels with the search. The worker computes it once per
 * root with the root battle (`playedBoundsOf`, from the `fell` mark the played turn carries in `keepPlayed`) and ships it as
 * `EvalResult.playedBounds`, the way it ships the kill odds and the unanswered profile: on a tree's result, through the merge, through
 * both matrix paths and the choices info of the engine path. The grading's own readers (`analyzeTurn`, `playedIndices`) read it from the
 * result; a result without it (a cache entry from before) grades as it did. Rows: Champions VGC 2710981835 turn 7 (the report of #108),
 * Doubles OU and singles on constructed boards (a Prankster Grafaiai that fell to a Psyshock before it acted).
 */
const replay = JSON.parse(readFileSync(new URL('./fixtures/gen9championsvgc2026regmc-2710981835.json', import.meta.url), 'utf-8')) as ReplayData;
await loadSimMods(getBranchSimulatorFormat(replay));

beforeAll(() => configureSearchBudget(parseSearchBudget('trees=2,iterations=50')));
afterAll(() => configureSearchBudget(null));

interface Scene { name: string; doubles: boolean; serialized: string; ruleset: StaticRuleset; played: PlayedTurn; battle?: SimBattle }

const GEN9 = RULES.find(entry => entry.generation === 9)!;
const grafaiai = () => ({ ...mon(GEN9, { species: 'Grafaiai', moves: ['partingshot', 'lowkick', 'foulplay', 'gunkshot'], gender: 'M' }), ability: 'prankster', item: 'choiceband' });
const valiant = () => mon(GEN9, { species: 'Iron Valiant', moves: ['psyshock', 'closecombat'], gender: 'M' });
const snorlax = () => mon(GEN9, { species: 'Snorlax', moves: ['bodyslam', 'rest'], gender: 'M' });
const pikachu = () => mon(GEN9, { species: 'Pikachu', moves: ['thunderbolt', 'surf'] });

function constructed(doubles: boolean): Scene {
  const board: Battle = doubles
    ? battleOf(GEN9.doubles!, [grafaiai(), snorlax()], [valiant(), pikachu()])
    : battleOf(GEN9.singles, [grafaiai(), snorlax()], [valiant(), pikachu()]);
  const lines = doubles
    ? ['|move|p2a: Iron Valiant|Psyshock|p1a: Grafaiai', '|faint|p1a: Grafaiai', '|move|p1b: Snorlax|Body Slam|p2b: Pikachu', '|move|p2b: Pikachu|Thunderbolt|p1b: Snorlax']
    : ['|move|p2a: Iron Valiant|Psyshock|p1a: Grafaiai', '|faint|p1a: Grafaiai'];
  const played = doubles ? parsePlayedActionsDoubles(lines) : parsePlayedActions(lines, logRules(''));
  return {
    name: doubles ? 'Doubles OU, constructed (Prankster Grafaiai)' : 'singles, constructed (Prankster Grafaiai)', doubles,
    serialized: serializeBattleStable(board), ruleset: 'standard', played, battle: board as unknown as SimBattle,
  };
}

const champions = (): Scene => ({
  name: 'Champions VGC 2710981835 turn 7', doubles: true,
  serialized: (JSON.parse(readFileSync(new URL('./fixtures/played-bounds/gen9championsvgc2026regmc-2710981835-t7.json', import.meta.url), 'utf-8')) as { serialized: string }).serialized,
  ruleset: replayRuleset(replay), played: parsePlayedActionsDoubles(turnEvents(replay.log, 7)),
});

const SCENES = [champions(), constructed(true), constructed(false)];
const EXPECTED: Record<string, PlayedBounds> = {
  'Champions VGC 2710981835 turn 7': { p1: [{ moves: ['extremespeed', 'protect'], switchOut: true }, null] },
};

const settingsOf = (scene: Scene, over: Partial<EvalSettings> = {}): EvalSettings =>
  ({ depth: 1, samples: 1, mode: 'matrix', tera: false, sleepClause: false, ruleset: scene.ruleset, prove: false, keepPlayed: scene.played, ...over });

/** What the rows must carry: the bound of the root battle itself (the champions row also pins the report's two moves). */
function expectedBounds(scene: Scene): PlayedBounds {
  const named = EXPECTED[scene.name];
  if (named) return named;
  const bounds = playedBoundsOf(scene.battle!, scene.played.fell);
  expect(bounds).toBeDefined();
  return bounds!;
}

describe.each(SCENES)('$name', scene => {
  const want = () => expectedBounds(scene);
  const mcts = (over: Partial<EvalSettings> = {}) => settingsOf(scene, { mode: 'mcts', ...over });

  test('the parse marks a fallen slot, and the keep of the search carries the mark', () => {
    expect(scene.played.fell).toBeDefined();
    expect(structuredClone(scene.played.fell)).toEqual(scene.played.fell);
  });

  test('a tree\'s result carries the bound, and so do the partial results', () => {
    const partials: EvalResult[] = [];
    const tree = mctsTreeSearch(scene.serialized, mcts(), 0, { onPartial: result => partials.push(result) });
    expect(tree.result.playedBounds).toEqual(want());
    expect(partials.length).toBeGreaterThan(0);
    expect(partials.every(result => result.playedBounds !== undefined)).toBe(true);
  }, 240_000);

  test('a single in-process tree carries it', () => {
    expect(mctsSearch(scene.serialized, mcts()).playedBounds).toEqual(want());
  }, 240_000);

  test('the merge keeps it: two trees, and one tree with a verify map', () => {
    const trees = [0, 1].map(offset => mctsTreeSearch(scene.serialized, mcts(), offset));
    expect(mergeMctsTrees(trees).playedBounds).toEqual(want());
    expect(mergeMctsTrees([trees[0]], new Map()).playedBounds).toEqual(want());
    expect(mergeMctsTrees([trees[0]]).playedBounds).toEqual(want());
  }, 240_000);

  test('the tree orchestration returns it', async () => {
    const result = await searchTreesOrchestrated(createLocalTreeExecutor(scene.serialized, scene.ruleset), mcts());
    expect(result.playedBounds).toEqual(want());
  }, 600_000);

  test('the matrix search carries it, orchestrated and in process', async () => {
    const orchestrated = await searchOrchestrated(createLocalExecutor(scene.serialized, scene.ruleset), settingsOf(scene));
    expect(orchestrated.playedBounds).toEqual(want());
    expect(searchPosition(scene.serialized, settingsOf(scene)).playedBounds).toEqual(want());
  }, 600_000);

  test('the choices info of the executor carries it (the HTTP engine path reads it there)', async () => {
    const info = await createLocalExecutor(scene.serialized, scene.ruleset).choices(false, scene.played, false);
    expect(info.playedBounds).toEqual(want());
  }, 240_000);

  test('the bound plain data survives the worker boundary', () => {
    expect(structuredClone(want())).toEqual(want());
  });

  test('a turn that did not fall before acting has none, and no keep has none', async () => {
    const quiet: PlayedTurn = { ...scene.played };
    delete quiet.fell;
    expect(mctsTreeSearch(scene.serialized, mcts({ keepPlayed: quiet }), 0).result.playedBounds).toBeUndefined();
    const info = await createLocalExecutor(scene.serialized, scene.ruleset).choices(false, undefined, false);
    expect(info.playedBounds).toBeUndefined();
    expect(searchPosition(scene.serialized, settingsOf(scene, { keepPlayed: undefined })).playedBounds).toBeUndefined();
  }, 240_000);
});

const option = (choice: string, label: string, ev: number): RankedChoice => ({ choice, label, worstCase: ev, expected: ev, ev, punishedBy: 'Reply' });
const DOUBLES_ROWS = [
  option('move extremespeed 1, move flashcannon 1', 'Extreme Speed→Floette + Flash Cannon→Floette', 0.9),
  option('move protect, move flashcannon 1', 'Protect + Flash Cannon→Floette', 0.8),
  option('switch 3, move flashcannon 1', '→ Sylveon + Flash Cannon→Floette', 0.95),
  option('move dragonpulse 1, move flashcannon 1', 'Dragon Pulse→Floette + Flash Cannon→Floette', 0.5),
  option('move thunderbolt 1, move flashcannon 1', 'Thunderbolt→Floette + Flash Cannon→Floette', 0.4),
];
const BOUND: PlayedBounds = { p1: [{ moves: ['extremespeed', 'protect'], switchOut: true }, null] };
const resultOf = (playedBounds?: PlayedBounds): EvalResult => ({
  score: 0, interval: 0, depthCompleted: 1, perSide: { p1: DOUBLES_ROWS, p2: [option('move dazzlinggleam, move protect', 'Dazzling Gleam + Protect', 0)] },
  ...(playedBounds ? { playedBounds } : {}),
});
const played: PlayedTurn = {
  p1: null, p2: null, p1Slots: [null, { kind: 'move', name: 'Flash Cannon', tera: false, targetLoc: 1 }],
  p2Slots: [{ kind: 'move', name: 'Dazzling Gleam', tera: false, targetLoc: null }, { kind: 'move', name: 'Protect', tera: false, targetLoc: null }],
};

describe('the grading reads the bound from the result', () => {
  const grade = (result: EvalResult) => analyzeTurn({ turn: 7, result, played, playedOutcome: null, scoreBefore: 0, scoreAfter: null }).p1;

  test('with the bound the played row is Dragon Pulse + Flash Cannon; without it the grading is as before', () => {
    expect(grade(resultOf(BOUND)).played?.choice).toBe('move dragonpulse 1, move flashcannon 1');
    expect(grade(resultOf()).played?.choice).toBe('switch 3, move flashcannon 1');
    expect(grade(resultOf(BOUND)).regret).toBeGreaterThan(grade(resultOf()).regret ?? 1);
  });

  test('the verify selection prices the same played row', () => {
    const trees = [{ p1Options: DOUBLES_ROWS.map(({ choice, label }) => ({ choice, label })), p2Options: [] }] as never;
    expect(playedIndices(trees, resultOf(BOUND), played)).toEqual({ p1: 3 });
    expect(playedIndices(trees, resultOf(), played)).toEqual({ p1: 2 });
  });
});

describe('a game with several worlds keeps the frame\'s bound', () => {
  test('the heaviest world is the frame, and its bound stays on the blend', () => {
    const light = resultOf({ p1: [{ moves: [], switchOut: false }, null] });
    const blended = blendWorlds([light, resultOf(BOUND)], [0.4, 0.6]);
    expect(blended.playedBounds).toEqual(BOUND);
    expect(blendWorlds([resultOf(BOUND)], [1]).playedBounds).toEqual(BOUND);
  });
});
