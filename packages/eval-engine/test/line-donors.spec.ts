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

function tree(p1Lines: Record<string, TreeLineStep[]>, p2Lines: Record<string, TreeLineStep[]> = {}): MctsTreeStats {
  return {
    p1Options: options([['move surf', 'Surf'], ['move icebeam', 'Ice Beam']]), p2Options: options([['move drainingkiss', 'Draining Kiss'], ['switch 2', '→ Mew']]),
    rowLines: { p1: p1Lines, p2: p2Lines },
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
