import { readFileSync } from 'node:fs';
import { State } from '@pkmn/sim';
import { describe, expect, test } from 'vitest';
import { endgameChildren } from '../src/endgame/children';
import { ForcedWinProver, PROVER_BUDGET } from '../src/endgame/prover';
import { createRootPosition, positionBattle } from '../src/forward-model';
import { loadSimMods } from '../src/forward/sim-mods';
import type { StaticRuleset } from '../src/eval-function';
import { forcedWinFor } from '../src/search/forced-win';
import type { ForcedWinInput, TeraAllowance } from '../src/types';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 89 (A6-3b, #145): the root candidates no longer share one cell budget through their turned dice. A6-2 priced the dice of
 * the plain path, so every cell of a failing candidate also drew the cells of its dice (a 5 % miss and what follows it), and the
 * first two candidates of Doubles OU 2695084835 turn 8 spent 98 of the shared 100 cells before the third one, which wins on the
 * spot in 95 of 100 games, found a cell left. Each candidate now runs a lazy pass first, with the turned dice left aside (the
 * children `turned` marks), and only a candidate that passes it gets the full proof. The lazy mass is a lower bound of the full
 * mass without a game rule: a child left aside counts mass 0.
 */
interface BudgetScene {
  id: string;
  turn: number;
  serialized: string;
  input: ForcedWinInput;
  expected: { side: 'p1' | 'p2'; mass: number; turns: number };
}
const budgetScene = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/forced-win/budget-${name}.json`, import.meta.url), 'utf-8')) as BudgetScene;

/** The scenes of the other forced-win specs: a captured root, the side that proves and its ranking. */
interface RankedScene {
  id: string;
  turn: number;
  serialized: string;
  tera: TeraAllowance;
  sleepClause: boolean;
  ruleset?: StaticRuleset;
  side: 'p1' | 'p2';
  rootOrder: string[];
}
const rankedScene = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/forced-win/${name}.json`, import.meta.url), 'utf-8')) as RankedScene;

const modOf = (ruleset: StaticRuleset | undefined) => (ruleset === 'champions' ? 'gen9championsdoublescustomgame' : 'gen9doublescustomgame');

describe('the budget scenes: the third root candidate finds its cells again (A6-2 priced the dice and spent the shared 100 cells)', () => {
  // All four games were won by the side that proves. The mass is the proven share of the classes along every reply; the cells are
  // those the two sides' attempts spend together (the second side starts with what the first one left).
  test.each([
    ['Doubles OU 2695084835 turn 8 (the trace scene)', 'gen9doublesou-2695084835-t8'],
    ['VGC 2400507766 turn 7', 'gen9vgc2025regi-2400507766-t7'],
    ['VGC 2474083068 turn 10', 'gen9vgc2025regh-2474083068-t10'],
    ['VGC 2532857804 turn 7', 'gen9vgc2026regf-2532857804-t7'],
  ])('%s', async (_title, name) => {
    const board = budgetScene(name);
    await loadSimMods('gen9doublescustomgame');
    const root = createRootPosition(board.serialized, board.input.ruleset);
    const outcome = forcedWinFor(root, board.input);
    expect(outcome, `${name} proves`).not.toBeNull();
    expect(outcome!.side).toBe(board.expected.side);
    expect(outcome!.proof.mass).toBeCloseTo(board.expected.mass, 9);
    expect(outcome!.proof.turns).toBe(board.expected.turns);
    expect(outcome!.proof.cells).toBeLessThanOrEqual(PROVER_BUDGET.cells);
  });
});

describe('a die turned for the price marks its child (singles and doubles)', () => {
  test('singles: a second Spiky Shield holds one time in three; the one child the recorded turn does not show is turned', async () => {
    await loadSimMods('gen9championsou');
    const battle = battleOf('gen9customgame', [set('Chesnaught', ['spikyshield', 'woodhammer'], { level: 100 })], [set('Garchomp', ['dragonclaw'], { level: 100 })]);
    const chesnaught = battle.sides[0].active[0]!;
    const garchomp = battle.sides[1].active[0]!;
    chesnaught.hp = 1;
    garchomp.hp = Math.max(1, Math.floor(garchomp.maxhp / 8) - 1);
    chesnaught.addVolatile('stall');
    const root = createRootPosition(JSON.stringify(State.serializeBattle(battle)), 'standard');
    const cell = endgameChildren(root, 'move spikyshield', 'move dragonclaw', 6);
    expect(positionBattle(root).gameType).toBe('singles');
    expect(cell.children).toHaveLength(2);
    expect(cell.children.filter(child => child.turned)).toHaveLength(1);
  });

  test('doubles, the tie path: each of the two orders keeps its recorded child and turns the confusion once', async () => {
    await loadSimMods('gen9championsou');
    const slow = { evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } };
    const battle = battleOf(
      'gen9doublescustomgame', [set('Snorlax', ['tackle'], slow), set('Blissey', ['splash'])], [set('Snorlax', ['tackle'], slow), set('Chansey', ['splash'])],
    );
    battle.sides[0].active[0]!.addVolatile('confusion');
    const root = createRootPosition(JSON.stringify(State.serializeBattle(battle)), 'standard');
    const cell = endgameChildren(root, 'move tackle 1, move splash', 'move tackle 1, move splash', 6);
    expect(cell.children).toHaveLength(4);
    expect(cell.children.filter(child => child.turned)).toHaveLength(2);
  });

  test('a class cell has no turned child (the lazy pass leaves it alone)', async () => {
    await loadSimMods('gen9championsou');
    const battle = battleOf('gen9customgame', [set('Jolteon', ['thunder'], { level: 100 })], [set('Machamp', ['closecombat'], { level: 100 })]);
    for (const side of battle.sides) side.active[0]!.sethp(1);
    const root = createRootPosition(JSON.stringify(State.serializeBattle(battle)), 'standard');
    const cell = endgameChildren(root, 'move thunder', 'move closecombat', 6);
    expect(cell.plain).toBe(false);
    expect(cell.children.some(child => child.turned)).toBe(false);
  });
});

describe('the lazy pass is a lower bound of the full proof (candidate by candidate, on the doubles scenes of the forced-win specs)', () => {
  // Both passes on one prover, as the root loop runs them: the lazy mass never exceeds the full mass. A candidate counts only where
  // both finish: a prover that came within `CUT_MARGIN` cells of its limit may have refused the full pass a reply batch the lazy pass
  // still had, and the row leaves it out. The scenes are the budget scenes (the winning side's ranking), the plain-dice scenes and the
  // four scout-miss scenes; the three that need more than the limit (VGC 2400507766 t7, 2468711188 t7, 2532538236 t7) run in the
  // budget rows above only.
  const LIMIT = 300;
  const CUT_MARGIN = 60;
  const scenes: Array<[string, () => RankedScene]> = [
    ...['gen9doublesou-2695084835-t8', 'gen9vgc2025regh-2474083068-t10', 'gen9vgc2026regf-2532857804-t7'].map(name => [`budget ${name}`, () => {
      const board = budgetScene(name);
      const side = board.expected.side;
      return { id: board.id, turn: board.turn, serialized: board.serialized, side, rootOrder: board.input.rootOrder[side], tera: board.input.tera ?? false, sleepClause: board.input.sleepClause ?? false, ruleset: board.input.ruleset };
    }] as [string, () => RankedScene]),
    ...['plain-dice-gen9championsvgc2026regmbbo3-2679549596-t7', 'plain-dice-gen9vgc2025regi-2408473310-t13',
      'scout-miss-gen9championsvgc2026regmbbo3-2682637901-t6', 'scout-miss-gen9championsvgc2026regmc-2694684816-t8', 'scout-miss-gen9doublesou-2661746817-t8', 'scout-miss-gen9vgc2024regg-2163312677-t8',
    ].map(name => [name, () => rankedScene(name)] as [string, () => RankedScene]),
  ];
  let compared = 0;
  let leftAside = 0;
  test.each(scenes)('%s', { timeout: 240_000 }, async (name, load) => {
    const board = load();
    await loadSimMods(modOf(board.ruleset));
    const root = createRootPosition(board.serialized, board.ruleset);
    const prover = new ForcedWinProver(board.side, { tera: board.tera, sleepClause: board.sleepClause, ruleset: board.ruleset }, { states: LIMIT, cells: LIMIT, depth: PROVER_BUDGET.depth }, { states: 0, cells: 0 });
    for (const choice of prover.rootCandidates(root, board.rootOrder)) {
      const lazy = prover.candidateMass(root, choice, true);
      const full = prover.candidateMass(root, choice, false);
      if (prover.cells > LIMIT - CUT_MARGIN || prover.states >= LIMIT) break;
      expect(lazy.mass, `${name} ${choice}`).toBeLessThanOrEqual(full.mass + 1e-12);
      compared += 1;
      if (lazy.mass < full.mass - 1e-9) leftAside += 1;
    }
  });

  test('the rows compared candidates where both passes finished, and the pass left real mass aside in some', () => {
    expect(compared).toBeGreaterThan(5);
    expect(leftAside).toBeGreaterThan(0);
  });
});
