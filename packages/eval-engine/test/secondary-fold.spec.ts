import type { Battle } from '@pkmn/sim';
import { describe, expect, test } from 'vitest';
import { classifyChild, foldClassWeights, planCellEvents, type CellEvent } from '../src/cell-blend';
import { advancePositionWithLog } from '../src/forward-model';
import { loadSimMods } from '../src/forward/sim-mods';
import { DiceSink } from '../src/forward/scripted-prng';
import { hitClasses, hitKey, truncates, type EventSecondary } from '../src/search/secondary-classes';
import { playClicks, seedOf } from './dice-fixtures';
import { dexOfRules, SWEEP_CASES, sweepBoard } from './dice-sweep-support';
import { battleOf } from './power-oracle';
import { set } from './move-oracle';
import { FAST, rootOf } from './secondary-classes-support';

/**
 * Round 86 (T305), step A5a: the arithmetic of the secondary classes in `cell-blend.ts` and `search/secondary-classes.ts`.
 *
 * - Which effects cut the target's move is read from the Dex condition (`truncates`: lasts one turn, has a `BeforeMove`
 *   handler). The sweep holds that to the simulator: for every volatile status that any move of a rule set can put on a target
 *   as a secondary, a target that carries it either loses its move on every seed or keeps it on some.
 * - The classes of a hit split by the subsets of the entries, two entries of one effect land in one class, and the weights sum
 *   to the hit's.
 * - `classifyChild` with the fork's dice record names the effects that came true, also those that leave no mark that the
 *   protocol shows beside the move (a burn the target already carries would show nothing, a blocked effect still counts by its die).
 */
await loadSimMods('gen9championsou');

describe.each(SWEEP_CASES.filter(entry => entry.mode === 'singles'))('which secondary effects cut the target\'s move: $name', ({ rules, name }) => {
  const dex = dexOfRules(rules);
  const ids = [...new Set(dex.moves.all()
    .filter(move => move.exists && move.gen <= dex.gen)
    .flatMap(move => ((move as unknown as { secondaries?: { volatileStatus?: string; self?: unknown }[] }).secondaries ?? []))
    .filter(entry => entry.volatileStatus && !entry.self)
    .map(entry => entry.volatileStatus!))];

  /** The simulator's answer: does a target that carries the volatile lose its move on every one of the seeds? */
  function losesMove(id: string): boolean {
    for (let index = 0; index < 8; index++) {
      const board = sweepBoard(rules, 'tackle', 'singles', seedOf(index + 1), false, FAST);
      const [user, target] = [board.sides[0].active[0]!, board.sides[1].active[0]!];
      target.addVolatile(id, user);
      playClicks(board, { p1: 'move 1', p2: 'move 1' });
      if (board.log.some(line => line.startsWith('|move|p2a:'))) return false;
    }
    return true;
  }

  test(`${name}: truncates() equals the simulator for every volatile a secondary can put on a target`, () => {
    expect(ids.length).toBeGreaterThan(0);
    const problems = ids.filter(id => truncates(board(rules).dex, id) !== losesMove(id)).map(id => `${id}: dex ${truncates(board(rules).dex, id)}`);
    expect(problems.join(' | ')).toBe('');
  });
});

const board = (rules: { singles: string }): Battle => battleOf(rules.singles, [set('Pikachu', ['splash'])], [set('Vaporeon', ['splash'])]);

describe('the classes of a hit', () => {
  const entry = (effectId: string, chance: number, cuts = false): EventSecondary => ({ effectId, chance, truncates: cuts });

  test('no entry is one class without a token', () => {
    expect(hitClasses(undefined)).toEqual([{ tokens: [], weight: 1, cuts: false }]);
  });

  test('two independent entries make four classes that sum to 1, the flinch class cuts', () => {
    const classes = hitClasses([entry('brn', 0.1), entry('flinch', 0.1, true)]);
    expect(classes.map(cls => hitKey(cls.tokens)).sort()).toEqual(['hit-nokill', 'hit-nokill+brn', 'hit-nokill+brn+flinch', 'hit-nokill+flinch']);
    expect(classes.reduce((sum, cls) => sum + cls.weight, 0)).toBeCloseTo(1, 12);
    expect(classes.find(cls => cls.tokens.join('+') === 'brn+flinch')!.weight).toBeCloseTo(0.01, 12);
    expect(classes.filter(cls => cls.cuts).map(cls => cls.tokens.join('+')).sort()).toEqual(['brn+flinch', 'flinch']);
  });

  test('two entries of one effect (a move\'s flinch and a King\'s Rock\'s) land in one class: one of two dice came true', () => {
    const classes = hitClasses([entry('flinch', 0.3, true), entry('flinch', 0.1, true)]);
    expect(classes).toHaveLength(2);
    expect(classes.find(cls => cls.tokens.length === 0)!.weight).toBeCloseTo(0.7 * 0.9, 12);
    expect(classes.find(cls => cls.tokens[0] === 'flinch')!.weight).toBeCloseTo(1 - 0.7 * 0.9, 12);
  });
});

describe('classifyChild with the fork\'s dice record', () => {
  // Flamethrower into a Vaporeon that splashes: a sure hit that cannot kill, with a 10 percent burn
  const cell = battleOf('gen9customgame', [set('Pikachu', ['flamethrower'])], [set('Vaporeon', ['splash'])]);
  const root = rootOf(cell);
  const plan = planCellEvents(cell, 'move flamethrower', 'move splash');
  const events = (plan as { events: CellEvent[] }).events ?? [];

  test('the cell is a plan of two classes: the burn is an outcome class', () => {
    expect(plan.kind).toBe('events');
    expect([...foldClassWeights(events, 'p1')].map(([key, weight]) => `${key} ${weight.toFixed(2)}`)).toEqual(['hit-nokill 0.90', 'hit-nokill+brn 0.10']);
  });

  test('the key of a draw names the burn when its die came true, the other draws keep the plain key', () => {
    const seen = new Set<string>();
    for (let index = 0; index < 60; index++) {
      const sink = new DiceSink();
      const { log } = advancePositionWithLog(root, 'move flamethrower', 'move splash', seedOf(index + 1), { scripts: sink as never });
      const key = classifyChild(log, events, sink.secondaries);
      const burned = log.some(line => line.startsWith('|-status|p2a:') && line.endsWith('|brn'));
      expect(key, log.join(' / ').slice(0, 200)).toBe(burned ? 'hit-nokill+brn' : 'hit-nokill');
      seen.add(key!);
    }
    expect(seen.size).toBe(2);
  });
});
