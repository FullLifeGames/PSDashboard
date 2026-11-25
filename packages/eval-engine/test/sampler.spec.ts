import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { analyzeTurn, findPlayedOption } from '../src/analysis';
import { createMatchupCache } from '../src/eval-function';
import { createRootPosition, advancePosition, positionBattle } from '../src/forward-model';
import { mctsTreeSearch } from '../src/mcts';
import { mergeMctsTrees } from '../src/mcts-merge';
import { benchOrder } from '../src/search/bench-order';
import { cellKey } from '../src/rank';
import { pairCellSample, FALLBACK_DRAWS, PAIR_DRAW_BUDGET, type PairCell } from '../src/pair/sampler';
import { summarizeTurn } from '../src/summary';
import type { PlayedTurn } from '../src/played';
import type { EvalSettings, MctsTreeStats, PlannedCell } from '../src/types';
import type { StaticRuleset } from '../src/score/weights';
import { anchorRoot, PLAYED, doublesRoot, pairSet, QUIET } from './pair-battles';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import { countFainted, leafValue } from '../src/search/leaf';
import { sampleCell, type CellSample } from '../src/search/cell-sampler';
import { cellSeeds } from '../src/search/root-quantile';


const position = JSON.parse(readFileSync(new URL('./fixtures/positions/gen9vgc2026regi-2630685175-t7-played.json', import.meta.url), 'utf-8')) as {
  serialized: string; tera: EvalSettings['tera']; sleepClause: boolean; ruleset: StaticRuleset; keepPlayed: NonNullable<EvalSettings['keepPlayed']>;
};
const settings: EvalSettings = {
  depth: 1, samples: 1, mode: 'mcts', tera: position.tera, sleepClause: position.sleepClause, ruleset: position.ruleset, keepPlayed: position.keepPlayed, prove: false,
};

describe('a doubles root plans the cells of the played row and column (VGC 2630685175 turn 7)', () => {
  const tree = mctsTreeSearch(position.serialized, settings, 0);
  const rowOf = findPlayedOption(tree.p1Options, position.keepPlayed.p1Slots);
  const columnOf = findPlayedOption(tree.p2Options, position.keepPlayed.p2Slots);
  const row = rowOf ? tree.p1Options.indexOf(rowOf) : -1;
  const column = columnOf ? tree.p2Options.indexOf(columnOf) : -1;
  const cross = (stats: MctsTreeStats): Set<number> => new Set([
    ...stats.p2Options.map((_, j) => cellKey(row, j)),
    ...stats.p1Options.map((_, i) => cellKey(i, column)),
  ]);

  test('the played pair is among the options (the premise of the fixture)', () => {
    expect(row).toBeGreaterThanOrEqual(0);
    expect(column).toBeGreaterThanOrEqual(0);
    expect(tree.p1Options.length).toBeGreaterThan(5);
    expect(tree.p2Options.length).toBeGreaterThan(5);
  });

  test('the planned cells lie in the cross of the played row and column, and the boundary list stays the verify step\'s (red before: none planned)', () => {
    expect(tree.plannedCells).toBeDefined();
    expect(tree.boundaryCells).toBeUndefined();
    const allowed = cross(tree);
    for (const planned of tree.plannedCells!) expect(allowed.has(planned.key)).toBe(true);
    expect(tree.plannedCells!.length).toBeGreaterThan(allowed.size / 2);
    expect(tree.plannedCells!.length).toBeLessThanOrEqual(allowed.size);
    expect(tree.plannedCells!.some(planned => planned.key === cellKey(row, column))).toBe(true);
  });

  test('each answer is the pair plan\'s own: plain is none, a planned cell lists its classes (heaviest first, weights summing to 1)', () => {
    const order = benchOrder(position.serialized);
    const root = createRootPosition(order ? order.serialized : position.serialized, position.ruleset);
    const cache = createMatchupCache(position.ruleset);
    const answered = new Map<number, PlannedCell>(tree.plannedCells!.map(entry => [entry.key, entry]));
    const seen = { none: 0, events: 0, unlisted: 0 };
    for (const key of cross(tree)) {
      const i = Math.floor(key / 10_000);
      const j = key % 10_000;
      const cell = pairCellSample(root, tree.p1Options[i].choice, tree.p2Options[j].choice, 1, cache);
      const listed = answered.get(key);
      if (cell.kind === 'plain') {
        expect(listed).toEqual({ key, plan: 'none' });
        seen.none++;
      } else if (cell.kind === 'sample' && cell.via === 'plan') {
        expect(listed?.plan).toBe('events');
        const classes = listed!.classes!;
        expect(classes.map(entry => entry.key).sort()).toEqual(cell.sample.blend!.classes.map(entry => entry.key).sort());
        expect(classes.reduce((sum, entry) => sum + entry.weight, 0)).toBeCloseTo(1, 9);
        for (let k = 1; k < classes.length; k++) expect(classes[k - 1].weight).toBeGreaterThanOrEqual(classes[k].weight);
        seen.events++;
      } else {
        expect(listed).toBeUndefined();
        seen.unlisted++;
      }
    }
    expect(seen.none).toBeGreaterThan(0);
    expect(seen.events).toBeGreaterThan(0);
    expect(seen.unlisted).toBeGreaterThan(0);
  });

  test('the cells of a single tree carry the answer, and the cells off the cross read fail', () => {
    const cells = mergeMctsTrees([tree]).matrix!.cells!;
    const allowed = cross(tree);
    const plans = new Set<string | undefined>();
    cells.forEach((line, i) => line.forEach((cell, j) => {
      plans.add(cell.plan);
      if (!allowed.has(cellKey(i, j))) expect(cell.plan).toBe('fail');
    }));
    expect(plans.has('none')).toBe(true);
    expect(plans.has('events')).toBe(true);
    expect(cells[row][column].plan).not.toBe('fail');
  });

  test('a sibling tree plans nothing, and a search without the played turn plans nothing (no card reads the cells)', () => {
    expect(mctsTreeSearch(position.serialized, settings, 1).plannedCells).toBeUndefined();
    const lone = mctsTreeSearch(position.serialized, { ...settings, keepPlayed: undefined }, 0);
    expect(lone.plannedCells).toBeUndefined();
    expect(lone.result.matrix!.cells!.flat().every(cell => cell.plan === undefined)).toBe(true);
  });

  test('a side whose click is not among the options plans the other side\'s line alone', () => {
    const partial = mctsTreeSearch(position.serialized, { ...settings, keepPlayed: { ...position.keepPlayed, p1Slots: undefined } }, 0);
    const col = partial.p2Options.indexOf(findPlayedOption(partial.p2Options, position.keepPlayed.p2Slots)!);
    expect(partial.plannedCells!.length).toBeGreaterThan(0);
    for (const planned of partial.plannedCells!) expect(planned.key % 10_000).toBe(col);
  });

  test('planning is deterministic: the same answers, ranking and values twice', () => {
    const again = mctsTreeSearch(position.serialized, settings, 0);
    expect(again.plannedCells).toEqual(tree.plannedCells);
    expect(again.result.perSide.p1.map(entry => entry.choice)).toEqual(tree.result.perSide.p1.map(entry => entry.choice));
    expect(again.result.matrix!.values).toEqual(tree.result.matrix!.values);
  });
});

describe('Pokémon Champions doubles plans the same cross (VGC Reg M-B, the round-56 anchor, turn 5)', () => {
  const keepPlayed: NonNullable<EvalSettings['keepPlayed']> = {
    p1: null, p2: null,
    p1Slots: [{ kind: 'move', name: 'Life Dew', targetLoc: null }, { kind: 'move', name: 'Play Rough', targetLoc: 2 }],
    p2Slots: [{ kind: 'move', name: 'Matcha Gotcha', targetLoc: null }, { kind: 'move', name: 'Flare Blitz', targetLoc: 1 }],
  };
  const root = anchorRoot();
  const championsSettings: EvalSettings = { depth: 1, samples: 1, mode: 'mcts', tera: false, ruleset: 'champions', keepPlayed, prove: false };

  test('the played cell answers with the events of the pair plan, the cells off the cross read fail', () => {
    const stats = mctsTreeSearch(root.serialized, championsSettings, 0);
    const row = stats.p1Options.findIndex(option => option.choice === PLAYED[0]);
    const column = stats.p2Options.findIndex(option => option.choice === PLAYED[1]);
    expect(row).toBeGreaterThanOrEqual(0);
    expect(column).toBeGreaterThanOrEqual(0);
    const answer = stats.plannedCells!.find(entry => entry.key === cellKey(row, column));
    expect(answer?.plan).toBe('events');
    const expected = pairCellSample(createRootPosition(root.serialized, 'champions'), PLAYED[0], PLAYED[1], 1, createMatchupCache('champions'));
    if (expected.kind !== 'sample') throw new Error('the played cell of the anchor is planned');
    expect(answer!.classes!.map(entry => entry.key).sort()).toEqual(expected.sample.blend!.classes.map(entry => entry.key).sort());
    const cells = mergeMctsTrees([stats]).matrix!.cells!;
    cells.forEach((line, i) => line.forEach((cell, j) => {
      if (i !== row && j !== column) expect(cell.plan).toBe('fail');
    }));
  });
});

describe('the odds note reads the real keys of the pair plan', () => {
  const tree = mctsTreeSearch(position.serialized, settings, 0);
  const result = mergeMctsTrees([tree]);
  const against = (p2Slots: NonNullable<EvalSettings['keepPlayed']>['p2Slots']) => analyzeTurn({
    turn: 7, result, played: { p1: null, p2: null, p1Slots: position.keepPlayed.p1Slots, p2Slots }, playedOutcome: 0, scoreBefore: 0, scoreAfter: 0, actives: { p1: null, p2: null, gen: 9 },
  });

  test('the played row prices a Tera Starstorm claim at the root (the premise)', () => {
    const played = against(position.keepPlayed.p2Slots).p1.played!;
    expect(played.label).toBe('U-turn→Zamazenta-Crowned + Tera Starstorm');
    expect(played.koOdds).toMatchObject({ label: 'Tera Starstorm→Zamazenta-Crowned', attacker: { slot: 1 } });
  });

  test('against the clicked Wide Guard the claim is stopped (a plain cell)', () => {
    expect(against(position.keepPlayed.p2Slots).p1.hitStopped?.played).toBe(true);
  });

  test('against a click where the spread hit lands the cell lists the own event of the claim, and the claim stays', () => {
    const lands = against([
      { kind: 'move', name: 'Pollen Puff', targetLoc: 1 },
      { kind: 'move', name: 'Body Press', targetLoc: 2 },
    ]);
    expect(lands.p2.played?.label).toBe('Pollen Puff→Rillaboom + Body Press→Terapagos-Stellar');
    const row = tree.p1Options.findIndex(option => option.label === lands.p1.played!.label);
    const column = tree.p2Options.findIndex(option => option.label === lands.p2.played!.label);
    const cell = result.matrix!.cells![row][column];
    expect(cell.plan).toBe('events');
    expect(cell.classes!.some(entry => entry.key.includes('p1b:terastarstorm>'))).toBe(true);
    expect(lands.p1.hitStopped?.played).toBeUndefined();
  });
});

describe('a doubles turn without its protocol reads its luck from the planned cell', () => {
  const names: [string, string] = ['pixelfrost', 'Mstr_Hawk'];
  const played: PlayedTurn = { p1: null, p2: null, p1Slots: position.keepPlayed.p1Slots, p2Slots: position.keepPlayed.p2Slots };
  const tree = mctsTreeSearch(position.serialized, settings, 0);
  function cardOf(stripPlans: boolean) {
    const result = mergeMctsTrees([tree]);
    const row = tree.p1Options.indexOf(findPlayedOption(tree.p1Options, position.keepPlayed.p1Slots)!);
    const column = tree.p2Options.indexOf(findPlayedOption(tree.p2Options, position.keepPlayed.p2Slots)!);
    const playedOutcome = result.matrix!.values[row][column];
    const cells = result.matrix!.cells!.map(line => line.map(cell => (stripPlans ? { visits: cell.visits, verified: cell.verified } : cell)));
    const bare = { ...result, matrix: { ...result.matrix!, cells } };
    const analysis = analyzeTurn({ turn: 7, result: bare, played, playedOutcome, scoreBefore: playedOutcome, scoreAfter: playedOutcome - 0.8, actives: { p1: null, p2: null, gen: 9 } });
    return { analysis, text: summarizeTurn({ ...analysis, attribution: 'chance' }, names) };
  }

  test('the played cell is plain and holds no unpriced effect: nothing rolled, so the card says no roll is behind it (red before: no answer, the ungated wording)', () => {
    const planned = cardOf(false);
    expect(planned.analysis.rolledFor).toEqual({ p1: false, p2: false });
    expect(planned.text).toContain('the estimate moved');
    expect(planned.text).toContain('with no roll behind it');
    expect(planned.text).not.toContain('how the turn rolled');
  });

  test('a result without the answers (an old cache) keeps the ungated wording', () => {
    const unplanned = cardOf(true);
    expect(unplanned.analysis.rolledFor).toBeUndefined();
    expect(unplanned.text).toContain('how the turn rolled');
  });
});

const meanOver = (root: ReturnType<typeof anchorRoot>, p1: string, p2: string, seeds: readonly string[]) => {
  const cache = createMatchupCache();
  return seeds.reduce((sum, seed) => sum + leafValue(positionBattle(advancePosition(root, p1, p2, seed as never)), cache), 0) / seeds.length;
};

const seeds = (count: number) => Array.from({ length: count }, (_, k) => `${101 + 4 * k},${102 + 4 * k},${103 + 4 * k},${104 + 4 * k}`);

const asData = (sample: CellSample) => ({
  ...sample, firstChild: sample.firstChild.serialized,
  classChildren: sample.classChildren && [...sample.classChildren].map(([key, child]) => [key, child.serialized]),
});
const cellData = (cell: PairCell) => (cell.kind === 'sample' ? { ...cell, sample: asData(cell.sample) } : cell);

describe('the pair plan at the root', () => {
  test('the anchor\'s played cell prices the Play Rough kill: within 0.05 of 256 seeds, where one seed missed by 0.53', { timeout: 60_000 }, () => {
    const root = anchorRoot();
    const cell = pairCellSample(root, ...PLAYED, 1, createMatchupCache());
    expect(cell.kind).toBe('sample');
    if (cell.kind !== 'sample') return;
    expect(cell.via).toBe('plan');
    expect(cell.draws).toBeLessThanOrEqual(PAIR_DRAW_BUDGET);
    const truth = meanOver(root, ...PLAYED, seeds(256));
    expect(Math.abs(cell.sample.value - truth)).toBeLessThan(0.05);
    const blend = cell.sample.blend!;
    expect(blend.classes.reduce((sum, cls) => sum + cls.weight, 0)).toBeCloseTo(1, 9);
    expect(blend.classes.find(cls => cls.hasFirst)?.key).toBe('p1b:playrough>p2b=hit-kill|p2a:matchagotcha>p1a=hit-nokill|p2a:matchagotcha>p1b=hit-nokill');
  });

  test('sampleCell routes a doubles root cell through the plan and stays the same when computed twice', () => {
    const root = anchorRoot();
    const battle = positionBattle(root);
    const once = sampleCell(root, countFainted(battle), ...PLAYED, 1, createMatchupCache(), true);
    const twice = sampleCell(root, countFainted(battle), ...PLAYED, 1, createMatchupCache(), true);
    expect(asData(twice)).toEqual(asData(once));
    expect(once.blend).toBeDefined();
  });

  test('a quiet cell keeps today\'s value: the first seed\'s leaf', () => {
    const root = anchorRoot();
    const battle = positionBattle(root);
    expect(pairCellSample(root, ...QUIET, 1, createMatchupCache()).kind).toBe('plain');
    const cell = sampleCell(root, countFainted(battle), ...QUIET, 1, createMatchupCache(), true);
    expect(cell.value).toBe(meanOver(root, ...QUIET, ['1,2,3,4']));
    expect(cell.blend).toBeUndefined();
  });

  test('without blendRoot a doubles cell stays on the plain path (sub-searches)', () => {
    const root = anchorRoot();
    const battle = positionBattle(root);
    const cell = sampleCell(root, countFainted(battle), ...PLAYED, 1, createMatchupCache());
    // The cell's slot 0 prices -0.17427480662206596 (the mean over the fixed seed '1,2,3,4' was -0.6562485351511125).
    expect(cell.value).toBe(meanOver(root, ...PLAYED, cellSeeds(root, ...PLAYED).slice(0, 1)));
  });

  test('a paralyzed attacker falls back before any draw: the plain mean over the eight fallback seeds', () => {
    const root = doublesRoot(
      [pairSet('Act', 'Garchomp', ['Dragon Claw', 'Protect']), pairSet('Wall', 'Blissey', ['Soft-Boiled', 'Protect'])],
      [pairSet('A', 'Snorlax', ['Rest', 'Protect']), pairSet('B', 'Snorlax', ['Rest', 'Protect'])],
      battle => { battle.sides[0].active[0]!.setStatus('par'); },
    );
    const cell = pairCellSample(root, 'move dragonclaw 1, move softboiled', 'move rest, move rest', 1, createMatchupCache());
    expect(cell).toMatchObject({ kind: 'sample', via: 'fallback', reason: 'prevented:par', draws: 8 });
    if (cell.kind !== 'sample') return;
    expect(cell.sample.value).toBeCloseTo(meanOver(root, 'move dragonclaw 1, move softboiled', 'move rest, move rest', cellSeeds(root, 'move dragonclaw 1, move softboiled', 'move rest, move rest').slice(0, FALLBACK_DRAWS)), 12);
  });

  test('a flinch die is part of the plan: the classes with the flinch weigh its chance', () => {
    const root = doublesRoot(
      [pairSet('Fast', 'Aerodactyl', ['Extrasensory', 'Protect'], { nature: 'Jolly', evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 } }), pairSet('Wall', 'Blissey', ['Soft-Boiled', 'Protect'])],
      [pairSet('Slow1', 'Snorlax', ['Body Slam', 'Protect']), pairSet('Slow2', 'Munchlax', ['Body Slam', 'Protect'])],
    );
    const cell = pairCellSample(root, 'move extrasensory 1, move softboiled', 'move bodyslam 1, move bodyslam 1', 1, createMatchupCache());
    expect(cell).toMatchObject({ kind: 'sample', via: 'plan', reason: null });
    if (cell.kind !== 'sample') return;
    const blend = cell.sample.blend!;
    expect(blend.classes.reduce((sum, cls) => sum + cls.weight, 0)).toBeCloseTo(1, 9);
    const flinched = blend.classes.filter(cls => cls.key.split('|').some(part => part.startsWith('p1a:extrasensory>p2a=') && part.includes('+flinch')));
    expect(flinched.length).toBeGreaterThan(0);
    expect(flinched.reduce((sum, cls) => sum + cls.weight, 0)).toBeCloseTo(0.1, 1);
  });

  test('three base seeds (the verify path): same value on repeat, still near the truth', { timeout: 60_000 }, () => {
    const root = anchorRoot();
    const once = pairCellSample(root, ...PLAYED, 3, createMatchupCache());
    const twice = pairCellSample(root, ...PLAYED, 3, createMatchupCache());
    expect(cellData(twice)).toEqual(cellData(once));
    if (once.kind !== 'sample') throw new Error('expected a sample');
    // The cell's own three base seeds read 0.127 away from the 256-seed mean (a 3-draw estimate); bound 0.1 to 0.15.
    expect(Math.abs(once.sample.value - meanOver(root, ...PLAYED, seeds(256)))).toBeLessThan(0.15);
  });

  test('team preview at the root is not a pair cell', () => {
    const set = (name: string) => pairSet(name, 'Snorlax', ['Rest', 'Protect']);
    const battle = new Battle({ formatid: toID('gen9doublescustomgame'), seed: '1,2,3,4', p1: { name: 'A', team: Teams.pack([set('a'), set('b')]) }, p2: { name: 'B', team: Teams.pack([set('c'), set('d')]) } });
    const root = createRootPosition(JSON.stringify(State.serializeBattle(battle)));
    expect(pairCellSample(root, 'team 12', 'team 12', 1, createMatchupCache())).toEqual({ kind: 'skip' });
  });
});
