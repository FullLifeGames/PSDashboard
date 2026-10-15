import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { analyzeTurn, findPlayedOption } from '../src/analysis';
import { createMatchupCache } from '../src/eval-function';
import { createRootPosition } from '../src/forward-model';
import { mctsTreeSearch } from '../src/mcts';
import { mergeMctsTrees } from '../src/mcts-merge';
import { cellKey } from '../src/rank';
import { pairCellSample } from '../src/pair/sampler';
import { summarizeTurn } from '../src/summary';
import type { PlayedTurn } from '../src/played';
import type { EvalSettings, MctsTreeStats, PlannedCell } from '../src/types';
import type { StaticRuleset } from '../src/score/weights';
import { anchorRoot, PLAYED } from './pair-battles';

/**
 * Round 70 (T217, gate of 13.10.2026 20:26, 2a): a doubles tree carries the pair plan's answer for the cells a replay turn's card
 * reads. T178 shipped the planner's answer per matrix cell for singles only (planCellEvents gives up on every combined choice);
 * the pair plan that prices doubles cells says the same thing: a plain cell has no accuracy roll and no kill range ("none"), a
 * planned cell lists its outcome classes ("events"), a guard that sends the cell to the plain mean leaves it unlisted (it
 * failed). The offset-0 tree plans the played row against every column and every row against the played column, the cells the
 * luck sentences (the played cell), the hindsight gate (the best row and the played row against the click) and the odds clause
 * read. The rest of the matrix stays unplanned: a full 13 x 13 grid would draw some 300 pair plans for a card that reads 25.
 */

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
    // Most of the cross answers; the cells a guard sends to the plain mean are missing, which the matrix reads as fail.
    expect(tree.plannedCells!.length).toBeGreaterThan(allowed.size / 2);
    expect(tree.plannedCells!.length).toBeLessThanOrEqual(allowed.size);
    expect(tree.plannedCells!.some(planned => planned.key === cellKey(row, column))).toBe(true);
  });

  test('each answer is the pair plan\'s own: plain is none, a planned cell lists its classes (heaviest first, weights summing to 1)', () => {
    const root = createRootPosition(position.serialized, position.ruleset);
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
    // The cross holds plain cells, planned cells and cells a guard sends to the plain mean, or the check proves nothing.
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
  // The anchor's played pair: p1 Life Dew and Play Rough into slot 2, p2 Matcha Gotcha and Flare Blitz into slot 1.
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

describe('the odds note reads the real keys of the pair plan (gate of 13.10.2026 20:26, 4a)', () => {
  // The played row's Tera Starstorm claim ("kills ~4%", slot b) meets the clicked Wide Guard, which turns the spread hit away,
  // and a click that lets the hit land: the cell of the played row against each click comes from the same search.
  const tree = mctsTreeSearch(position.serialized, settings, 0);
  const result = mergeMctsTrees([tree]);
  const against = (p2Slots: NonNullable<EvalSettings['keepPlayed']>['p2Slots']) => analyzeTurn({
    turn: 7, result, played: { p1: null, p2: null, p1Slots: position.keepPlayed.p1Slots, p2Slots }, playedOutcome: 0, scoreBefore: 0, scoreAfter: 0,
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

describe('a doubles turn without its protocol reads its luck from the planned cell (T217)', () => {
  const names: [string, string] = ['pixelfrost', 'Mstr_Hawk'];
  const played: PlayedTurn = { p1: null, p2: null, p1Slots: position.keepPlayed.p1Slots, p2Slots: position.keepPlayed.p2Slots };
  const tree = mctsTreeSearch(position.serialized, settings, 0);
  /** The turn as the card reads it, as a chance swing: the played cell's value as the played outcome, the position after the turn 0.8 below it. */
  function cardOf(stripPlans: boolean) {
    const result = mergeMctsTrees([tree]);
    const row = tree.p1Options.indexOf(findPlayedOption(tree.p1Options, position.keepPlayed.p1Slots)!);
    const column = tree.p2Options.indexOf(findPlayedOption(tree.p2Options, position.keepPlayed.p2Slots)!);
    const playedOutcome = result.matrix!.values[row][column];
    // A result from before the plan reached doubles (an old cache): the same cells without their answers.
    const cells = result.matrix!.cells!.map(line => line.map(cell => (stripPlans ? { visits: cell.visits, verified: cell.verified } : cell)));
    const bare = { ...result, matrix: { ...result.matrix!, cells } };
    const analysis = analyzeTurn({ turn: 7, result: bare, played, playedOutcome, scoreBefore: playedOutcome, scoreAfter: playedOutcome - 0.8 });
    // The attribution of this synthetic turn reads the sides' reads; the sentence under test is the chance card's.
    return { analysis, text: summarizeTurn({ ...analysis, attribution: 'chance' }, names) };
  }

  test('the played cell is plain and holds no unpriced effect: nothing rolled, so the card names the re-read (red before: no answer, the ungated wording)', () => {
    const planned = cardOf(false);
    expect(planned.analysis.rolledFor).toEqual({ p1: false, p2: false });
    expect(planned.text).toContain('the engine re-read the position after the turn');
    expect(planned.text).not.toContain('how the turn rolled');
  });

  test('a result without the answers (an old cache) keeps the ungated wording', () => {
    const unplanned = cardOf(true);
    expect(unplanned.analysis.rolledFor).toBeUndefined();
    expect(unplanned.text).toContain('how the turn rolled');
  });
});
