import { describe, expect, test } from 'vitest';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { configureSearchBudget, parseSearchBudget } from '../src/search/budget';
import { createMatchupCache } from '../src/eval-function';
import { mctsRoot, mctsTreeSearch } from '../src/mcts';
import { floorCells, linePass, linePassQuota, wantedCells, LINE_PASS_MAX } from '../src/search/line-pass';
import { LINE_MIN_VISITS, lineFrom, type Node } from '../src/search/mcts-node';
import type { EvalSettings, MctsTreeStats } from '../src/types';

const sets = (names: [string, string[]][]): PokemonSet[] => names.map(([species, moves]) => ({
  name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy',
  evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100, gender: '',
}));

function board(format: string, p1: [string, string[]][], p2: [string, string[]][]): string {
  const battle = new Battle({ formatid: toID(format), seed: '1,2,3,4', p1: { name: 'Alpha', team: Teams.pack(sets(p1)) }, p2: { name: 'Beta', team: Teams.pack(sets(p2)) } });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', 'team 123456');
    battle.choose('p2', 'team 123456');
  }
  return JSON.stringify(State.serializeBattle(battle));
}

const SINGLES = board('gen9customgame',
  [['Machamp', ['Seismic Toss', 'Bulk Up']], ['Gyarados', ['Waterfall', 'Earthquake']], ['Mew', ['Psychic', 'Ice Beam']], ['Tyranitar', ['Crunch', 'Rock Slide']]],
  [['Pikachu', ['Thunderbolt', 'Surf']], ['Eevee', ['Tackle', 'Quick Attack']]]);
const TEAM: [string, string[]][] = [['Incineroar', ['Fake Out', 'Flare Blitz']], ['Rillaboom', ['Grassy Glide', 'Wood Hammer']], ['Amoonguss', ['Spore', 'Rage Powder']], ['Urshifu', ['Close Combat', 'Sucker Punch']]];
const DOUBLES = board('gen9doublescustomgame', TEAM, TEAM.slice().reverse());

const BASE: EvalSettings = { depth: 1, samples: 1, mode: 'mcts', tera: false };
const BOARDS = [['singles', SINGLES], ['doubles', DOUBLES]] as const;

const withoutLines = (stats: MctsTreeStats): Omit<MctsTreeStats, 'rowLines'> => { const { rowLines, ...rest } = stats; void rowLines; return rest; };

const longRows = (stats: MctsTreeStats, side: 'p1' | 'p2'): number => Object.values(stats.rowLines![side]).filter(list => list.some(line => line.length >= 2)).length;

describe('the settings key', () => {
  test('a quota is a whole number from 1 up, bounded', () => {
    expect([undefined, 0, -3, 2.5, Number.NaN].map(linePass => linePassQuota({ linePass }))).toEqual([0, 0, 0, 0, 0]);
    expect(linePassQuota({ linePass: 300 })).toBe(300);
    expect(linePassQuota({ linePass: LINE_PASS_MAX + 1 })).toBe(LINE_PASS_MAX);
  });
});

describe.each(BOARDS)('the line pass of a %s tree', (_name, serialized) => {
  const off = mctsTreeSearch(serialized, { ...BASE, linePass: 0 }, 0);
  const on = mctsTreeSearch(serialized, { ...BASE, linePass: 300 }, 0);

  test('every statistic of the tree outside the lines equals the tree without the pass', () => {
    expect(withoutLines(on)).toEqual(withoutLines(off));
    expect(on.p1N).toEqual(off.p1N);
    expect(on.p2W).toEqual(off.p2W);
  });

  test('a best row whose line stops after the graded turn holds two turns after the pass (a thin tree of 100 iterations)', () => {
    configureSearchBudget(parseSearchBudget('iterations=100'));
    try {
      const thin = mctsTreeSearch(serialized, { ...BASE, linePass: 0 }, 0);
      const passed = mctsTreeSearch(serialized, { ...BASE, linePass: 300 }, 0);
      const length = (stats: MctsTreeStats, side: 'p1' | 'p2'): number => stats.rowLines![side][stats.result.perSide[side][0].label]?.[0].length ?? 0;
      for (const side of ['p1', 'p2'] as const) {
        expect(length(thin, side), `${side} before`).toBe(1);
        expect(length(passed, side), `${side} after`).toBeGreaterThanOrEqual(2);
      }
      expect(withoutLines(passed)).toEqual(withoutLines(thin));
    } finally {
      configureSearchBudget(null);
    }
  });

  test('a sibling tree of another seed stays equal outside the lines as well', () => {
    const sibling = mctsTreeSearch(serialized, { ...BASE, linePass: 0 }, 2);
    expect(withoutLines(mctsTreeSearch(serialized, { ...BASE, linePass: 300 }, 2))).toEqual(withoutLines(sibling));
  });

  test('no row loses its line, and the rows with a line of two turns do not shrink in number', () => {
    for (const side of ['p1', 'p2'] as const) {
      for (const label of Object.keys(off.rowLines![side])) expect(on.rowLines![side][label], `${side} ${label}`).toBeDefined();
      expect(longRows(on, side), side).toBeGreaterThanOrEqual(longRows(off, side));
    }
  });

  test('the pass is deterministic: two runs give the same tree and the same lines', () => {
    expect(mctsTreeSearch(serialized, { ...BASE, linePass: 300 }, 0)).toEqual(on);
  });

  test('a search that is stopped runs no pass', () => {
    const stopped = (linePass: number) => {
      let calls = 0;
      return mctsTreeSearch(serialized, { ...BASE, linePass }, 0, { shouldStop: () => ++calls > 100 });
    };
    expect(stopped(300)).toEqual(stopped(0));
  });
});

describe('the pass on a searched root', () => {
  const ctx = { tera: false, matchupCache: createMatchupCache() };
  const fresh = (serialized: string): Node => mctsRoot(serialized, BASE);
  const thinnest = (root: Node): number => [...root.children].filter(([, child]) => !child.ended).sort((a, b) => a[1].visits - b[1].visits)[0][0];
  const total = (root: Node, key: number): number => root.children.get(key)!.visits;

  test.each(BOARDS)('%s: the pass writes below the root only, one visit of the wanted cell per iteration', (_name, serialized) => {
    const root = fresh(serialized);
    const key = thinnest(root);
    const others = (): string => JSON.stringify([...root.children].filter(([cell]) => cell !== key).map(([cell, child]) => [cell, child.visits]));
    const rootStats = (): string => JSON.stringify([root.visits, root.p1N, root.p1W, root.p2N, root.p2W, others()]);
    const before = total(root, key);
    const held = rootStats();
    const used = linePass(root, [key], 9, ctx, 0, 600);
    expect(used).toBeLessThanOrEqual(9);
    expect(total(root, key) - before).toBe(used);
    expect(rootStats()).toBe(held);
  });

  test.each(BOARDS)('%s: the quota caps the pass, and a wanted cell whose line holds two turns costs nothing', (_name, serialized) => {
    const root = fresh(serialized);
    const key = thinnest(root);
    expect(linePass(root, [key], 0, ctx, 0, 600)).toBe(0);
    const deep = [...root.children].find(([cell]) => lineFrom(root, cell, LINE_MIN_VISITS).length >= 2);
    if (deep) expect(linePass(root, [deep[0]], 50, ctx, 0, 600)).toBe(0);
    expect(linePass(root, [], 50, ctx, 0, 600)).toBe(0);
  });

  test.each(BOARDS)('%s: the pass stops when its wanted line holds two turns, well inside a generous quota', (_name, serialized) => {
    const root = fresh(serialized);
    const key = thinnest(root);
    const used = linePass(root, [key], 3_000, ctx, 0, 600);
    expect(used).toBeLessThan(3_000);
    const child = root.children.get(key)!;
    expect(child.ended || lineFrom(root, key, LINE_MIN_VISITS).length >= 2 || used === 3_000).toBe(true);
  });

  test('the wanted cells are the best row and the played row against the top three answers, in key order', () => {
    const root = fresh(SINGLES);
    const stats = mctsTreeSearch(SINGLES, { ...BASE, keepPlayed: { p1: { kind: 'move', name: 'Bulk Up' }, p2: { kind: 'move', name: 'Surf' } } }, 0);
    const wanted = wantedCells(root, stats.result, { ...BASE, keepPlayed: { p1: { kind: 'move', name: 'Bulk Up' }, p2: { kind: 'move', name: 'Surf' } } });
    expect(wanted).toEqual([...wanted].sort((a, b) => a - b));
    expect(wanted.length).toBeGreaterThan(0);
    for (const key of wanted) expect(root.children.has(key)).toBe(true);
    const named = wantedCells(root, stats.result, { ...BASE, lineRows: { p1: [stats.p1Options[stats.p1Options.length - 1].label], p2: [] } });
    expect(named.length).toBeGreaterThan(0);
  });
});

describe.each(BOARDS)('the floor cells of a %s tree', (_name, serialized) => {
  const root = mctsRoot(serialized, BASE);
  const stats = mctsTreeSearch(serialized, { ...BASE, keepPlayed: { p1: { kind: 'move', name: 'Bulk Up' } } }, 0);

  test('they are cells the root holds, in key order, and none of the plain wanted cells', () => {
    const plain = wantedCells(root, stats.result, BASE);
    const floor = floorCells(root, stats.result, BASE, plain);
    expect(floor).toEqual([...floor].sort((a, b) => a - b));
    for (const key of floor) {
      expect(root.children.has(key)).toBe(true);
      expect(plain).not.toContain(key);
    }
  });

  test('a wanted row\'s worst answer is a floor cell unless the plain cells already hold it', () => {
    const plain = wantedCells(root, stats.result, BASE);
    const floor = floorCells(root, stats.result, BASE, plain);
    const row = stats.result.perSide.p1[0];
    expect(row.punishedBy, 'the best row has a floor').not.toBeNull();
    expect(plain.length + floor.length).toBeGreaterThanOrEqual(plain.length);
    expect(floorCells(root, stats.result, BASE, [...plain, ...floor])).toEqual([]);
  });
});
