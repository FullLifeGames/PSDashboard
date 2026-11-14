import { describe, expect, test } from 'vitest';
import { lineRequests } from '../src/search/line-donors';
import type { EvalResult, EvalSettings, MctsTreeStats, RankedChoice, TreeLineStep } from '../src/types';

/**
 * Round 89 (#104), step G2: which lines the lines job replays. Each side's best row and its played row; one request with both roles
 * when they are the row; the donors of a row are the trees that hold its line, the ones whose first step answers with the other side's
 * best row first, then by the visits of the first step.
 */

const row = (choice: string, label: string): RankedChoice => ({ choice, label, worstCase: 0, expected: 0, ev: 0, punishedBy: null });
const step = (p1: string, p2: string, visits: number): TreeLineStep => ({ p1, p2, visits });

const options = (labels: [string, string][]) => labels.map(([choice, label]) => ({ choice, label }));

/** The lines a tree holds for a row: one list per row, the tree's own line first (a bare line is a list of one). */
type Held = Record<string, TreeLineStep[] | TreeLineStep[][]>;
const listed = (held: Held): Record<string, TreeLineStep[][]> => Object.fromEntries(Object.entries(held).map(([label, value]) => [label, Array.isArray(value[0]) ? (value as TreeLineStep[][]) : [value as TreeLineStep[]]]));

function tree(p1Lines: Held, p2Lines: Held = {}): MctsTreeStats {
  return {
    p1Options: options([['move surf', 'Surf'], ['move icebeam', 'Ice Beam']]), p2Options: options([['move drainingkiss', 'Draining Kiss'], ['switch 2', '→ Mew']]),
    rowLines: { p1: listed(p1Lines), p2: listed(p2Lines) },
  } as unknown as MctsTreeStats;
}

const result = (): EvalResult => ({
  score: 0, interval: 0, depthCompleted: 1,
  perSide: { p1: [row('move surf', 'Surf'), row('move icebeam', 'Ice Beam')], p2: [row('move drainingkiss', 'Draining Kiss'), row('switch 2', '→ Mew')] },
});

const settings = (played: EvalSettings['keepPlayed']): EvalSettings => ({ depth: 1, samples: 1, mode: 'mcts', keepPlayed: played });

describe('the requests of the lines job', () => {
  test('the best row and the played row of each side, one request with both roles when they are the row', () => {
    const trees = [tree({ Surf: [step('Surf', 'Draining Kiss', 30)], 'Ice Beam': [step('Ice Beam', 'Draining Kiss', 12)] }, { 'Draining Kiss': [step('Surf', 'Draining Kiss', 30)] })];
    const requests = lineRequests(trees, result(), settings({ p1: { kind: 'move', name: 'Ice Beam' }, p2: { kind: 'move', name: 'Draining Kiss' } }));
    expect(requests.map(request => [request.side, request.label, request.for])).toEqual([
      ['p1', 'Surf', ['engine']], ['p1', 'Ice Beam', ['played']], ['p2', 'Draining Kiss', ['engine', 'played']],
    ]);
  });

  test('without a played side only the best rows ask; a row no tree holds a line for is left out', () => {
    const requests = lineRequests([tree({ Surf: [step('Surf', 'Draining Kiss', 30)] })], result(), settings(null));
    expect(requests.map(request => [request.side, request.label])).toEqual([['p1', 'Surf']]);
  });

  test('the donors answer with the other side\'s best row first, then the heavier first step, then the lower tree', () => {
    const trees = [
      tree({ Surf: [step('Surf', '→ Mew', 50)] }),
      tree({ Surf: [step('Surf', 'Draining Kiss', 20)] }),
      tree({ Surf: [step('Surf', 'Draining Kiss', 31)] }),
      tree({ Surf: [step('Surf', '→ Mew', 50)] }),
    ];
    const [request] = lineRequests(trees, result(), settings(null));
    expect(request.donors.map(donor => [donor[0].p2, donor[0].visits])).toEqual([['Draining Kiss', 31], ['Draining Kiss', 20], ['→ Mew', 50], ['→ Mew', 50]]);
    expect(request.visits).toBe(31);
  });

  test('a host that graded the turn elsewhere names the rows whose lines it wants (lineRows), the played row still comes along', () => {
    const trees = [tree({ Surf: [step('Surf', 'Draining Kiss', 30)], 'Ice Beam': [step('Ice Beam', 'Draining Kiss', 12)] })];
    const asked = { ...settings({ p1: { kind: 'move', name: 'Surf' } }), lineRows: { p1: ['Ice Beam'] } };
    expect(lineRequests(trees, result(), asked).map(request => [request.side, request.label, request.for])).toEqual([
      ['p1', 'Ice Beam', ['engine']], ['p1', 'Surf', ['played']],
    ]);
  });

  test('trees without rowLines (an older tree) ask for nothing', () => {
    expect(lineRequests([{ p1Options: [], p2Options: [] } as unknown as MctsTreeStats], result(), settings(null))).toEqual([]);
  });
});

/**
 * Round 89 (#104), step G12 (ruling G8a): a tree ships up to three lines for a row, against its own top answers. The donors of a row are
 * every tree's lines, ordered by the rank of the first answer in the merged ranking of the other side (the best answer overall comes
 * first, an answer the ranking does not hold comes last), then by the first step's visits, then by the lower tree.
 */
describe('the donors follow the merged ranking of the answers', () => {
  const ranking = (answers: [string, string][]): EvalResult => ({
    ...result(),
    perSide: { p1: result().perSide.p1, p2: answers.map(([choice, label]) => row(choice, label)) },
  });

  test('the merged top answer wins over a heavier line against another answer, in any tree', () => {
    const trees = [
      tree({ Surf: [step('Surf', '→ Mew', 90)] }),
      tree({ Surf: [step('Surf', 'Draining Kiss', 8)] }),
    ];
    const [request] = lineRequests(trees, result(), settings(null));
    expect(request.donors.map(donor => donor[0].p2)).toEqual(['Draining Kiss', '→ Mew']);
  });

  test('a tree that holds three lines for the row offers them in the order of the merged ranking', () => {
    const trees = [tree({ Surf: [[step('Surf', '→ Mew', 40)], [step('Surf', 'Draining Kiss', 12)], [step('Surf', 'Surf Pair', 9)]] })];
    const merged = ranking([['switch 2', '→ Mew'], ['move drainingkiss', 'Draining Kiss'], ['move x', 'Surf Pair']]);
    const [request] = lineRequests(trees, merged, settings(null));
    // the merged ranking puts → Mew first, so the tree's own first line stays first and the rest follow by rank
    expect(request.donors.map(donor => donor[0].p2)).toEqual(['→ Mew', 'Draining Kiss', 'Surf Pair']);
    const swapped = ranking([['move drainingkiss', 'Draining Kiss'], ['move x', 'Surf Pair'], ['switch 2', '→ Mew']]);
    expect(lineRequests(trees, swapped, settings(null))[0].donors.map(donor => donor[0].p2)).toEqual(['Draining Kiss', 'Surf Pair', '→ Mew']);
    expect(lineRequests(trees, swapped, settings(null))[0].visits).toBe(12);
  });

  test('when no tree holds the top answer the merged second comes first, and an answer the ranking does not hold comes last', () => {
    const trees = [
      tree({ Surf: [step('Surf', 'Unranked', 99)] }),
      tree({ Surf: [step('Surf', '→ Mew', 10)] }),
      tree({ Surf: [step('Surf', 'Draining Kiss', 9), ] }),
    ];
    const merged = ranking([['move top', 'Top'], ['switch 2', '→ Mew'], ['move drainingkiss', 'Draining Kiss']]);
    const [request] = lineRequests(trees, merged, settings(null));
    expect(request.donors.map(donor => donor[0].p2)).toEqual(['→ Mew', 'Draining Kiss', 'Unranked']);
  });

  test('the opponent\'s rows are ordered by the merged ranking of the first side', () => {
    const trees = [tree({}, { 'Draining Kiss': [[step('Ice Beam', 'Draining Kiss', 50)], [step('Surf', 'Draining Kiss', 10)]] })];
    const [request] = lineRequests(trees, result(), settings(null));
    // the merged top of player 1 is Surf: its line comes first although Ice Beam's holds more visits
    expect(request.side).toBe('p2');
    expect(request.donors.map(donor => donor[0].p1)).toEqual(['Surf', 'Ice Beam']);
  });
});
