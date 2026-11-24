import { describe, expect, test } from 'vitest';
import { lineRequests } from '../src/search/line-donors';
import type { EvalResult, EvalSettings, MctsTreeStats, RankedChoice, TreeLineStep } from '../src/types';

const row = (choice: string, label: string): RankedChoice => ({ choice, label, worstCase: 0, expected: 0, ev: 0, punishedBy: null });
const step = (p1: string, p2: string, visits: number): TreeLineStep => ({ p1, p2, visits });

const options = (labels: [string, string][]) => labels.map(([choice, label]) => ({ choice, label }));

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
    expect(request.side).toBe('p2');
    expect(request.donors.map(donor => donor[0].p1)).toEqual(['Surf', 'Ice Beam']);
  });
});

describe('a host names the answers its card ranks first (lineReplies)', () => {
  const two = [tree({ Surf: [step('Surf', 'Draining Kiss', 8)], 'Ice Beam': [step('Ice Beam', '→ Mew', 40)] }, { 'Draining Kiss': [[step('Surf', 'Draining Kiss', 30)], [step('Ice Beam', 'Draining Kiss', 12)]] })];

  test('the named answer comes before the merged top answer, singles', () => {
    const asked = { ...settings(null), lineReplies: { p1: ['→ Mew'] } };
    const [request] = lineRequests([tree({ Surf: [[step('Surf', 'Draining Kiss', 30)], [step('Surf', '→ Mew', 9)]] })], result(), asked);
    expect(request.donors.map(donor => donor[0].p2)).toEqual(['→ Mew', 'Draining Kiss']);
  });

  test('without lineReplies the merged ranking decides, as before', () => {
    const [request] = lineRequests([tree({ Surf: [[step('Surf', 'Draining Kiss', 30)], [step('Surf', '→ Mew', 9)]] })], result(), settings(null));
    expect(request.donors.map(donor => donor[0].p2)).toEqual(['Draining Kiss', '→ Mew']);
  });

  test('each side reads its own entry: the opponent\'s lines meet the answer named for player 2', () => {
    const asked = { ...settings(null), lineReplies: { p2: ['Ice Beam'] } };
    const requests = lineRequests(two, result(), asked);
    const second = requests.find(request => request.side === 'p2')!;
    expect(second.donors.map(donor => donor[0].p1)).toEqual(['Ice Beam', 'Surf']);
  });
});

describe('the line against the reply that hurts a row most (versus worst)', () => {
  const hurt = (): EvalResult => ({
    ...result(),
    perSide: {
      p1: [{ ...row('move surf', 'Surf'), punishedBy: '→ Mew' }, { ...row('move icebeam', 'Ice Beam'), punishedBy: 'Draining Kiss' }],
      p2: [{ ...row('move drainingkiss', 'Draining Kiss'), punishedBy: 'Surf' }, { ...row('switch 2', '→ Mew'), punishedBy: 'Surf' }],
    },
  });
  const withFloor = (base: MctsTreeStats, floor: NonNullable<MctsTreeStats['rowLines']>['floor']): MctsTreeStats => ({ ...base, rowLines: { ...base.rowLines!, floor } });

  test('the row asks twice: the usual line first, then the line against its floor answer, with the same roles', () => {
    const trees = [tree({ Surf: [[step('Surf', 'Draining Kiss', 30)], [step('Surf', '→ Mew', 12)]] })];
    const requests = lineRequests(trees, hurt(), settings(null));
    expect(requests.map(request => [request.side, request.label, request.for, request.versus])).toEqual([['p1', 'Surf', ['engine'], undefined], ['p1', 'Surf', ['engine'], 'worst']]);
    expect(requests[0].donors.map(donor => donor[0].p2)).toEqual(['Draining Kiss', '→ Mew']);
    expect(requests[1].donors).toEqual([[step('Surf', '→ Mew', 12)]]);
    expect(requests[1].visits).toBe(12);
  });

  test('a tree\'s floor line is a donor of the worst request and never of the usual one', () => {
    const trees = [withFloor(tree({ Surf: [step('Surf', 'Draining Kiss', 30)] }), { p1: { Surf: [step('Surf', '→ Mew', 9)] }, p2: {} })];
    const requests = lineRequests(trees, hurt(), settings(null));
    expect(requests[0].donors.map(donor => donor[0].p2)).toEqual(['Draining Kiss']);
    expect(requests[1].versus).toBe('worst');
    expect(requests[1].donors).toEqual([[step('Surf', '→ Mew', 9)]]);
  });

  test('no request when no tree holds a line against the floor answer, or when the usual line already meets it', () => {
    const none = lineRequests([tree({ Surf: [step('Surf', 'Draining Kiss', 30)] })], hurt(), settings(null));
    expect(none.map(request => request.versus)).toEqual([undefined]);
    const same = lineRequests([tree({ 'Ice Beam': [step('Ice Beam', 'Draining Kiss', 12)] })], { ...hurt(), perSide: { ...hurt().perSide, p1: [hurt().perSide.p1[1], hurt().perSide.p1[0]] } }, settings(null));
    expect(same.map(request => [request.label, request.versus])).toEqual([['Ice Beam', undefined]]);
  });

  test('the played row gets its own worst request, and the opponent\'s rows read their own floor (doubles read the joint labels the same way)', () => {
    const trees = [tree(
      { Surf: [[step('Surf', 'Draining Kiss', 30)], [step('Surf', '→ Mew', 12)]], 'Ice Beam': [[step('Ice Beam', '→ Mew', 8)], [step('Ice Beam', 'Draining Kiss', 6)]] },
      { 'Draining Kiss': [[step('Surf', 'Draining Kiss', 30)], [step('Ice Beam', 'Draining Kiss', 12)]] },
    )];
    const requests = lineRequests(trees, hurt(), settings({ p1: { kind: 'move', name: 'Ice Beam' }, p2: { kind: 'move', name: 'Draining Kiss' } }));
    expect(requests.map(request => [request.side, request.label, request.for, request.versus])).toEqual([
      ['p1', 'Surf', ['engine'], undefined], ['p1', 'Surf', ['engine'], 'worst'],
      ['p1', 'Ice Beam', ['played'], undefined],
      ['p2', 'Draining Kiss', ['engine', 'played'], undefined],
    ]);
  });
});
