import { readFileSync } from 'node:fs';
import { State } from '@pkmn/sim';
import { describe, expect, test } from 'vitest';
import { endgameChildren } from '../src/endgame/children';
import { ForcedWinProver as Prover, PROVER_BUDGET, proveForcedWin } from '../src/endgame/prover';
import { createRootPosition, positionBattle } from '../src/forward-model';
import { loadSimMods } from '../src/forward/sim-mods';
import type { StaticRuleset } from '../src/eval-function';
import type { TeraAllowance } from '../src/types';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 89 (A6-2, ruling 24, #145): the plain path of the forced-win prover prices the dice it can. A cell whose five draws agree
 * on who faints used to count as certain although a die decided the turn: a second Protect that holds one time in three, a
 * confused body that hits itself, a hold the draws all failed. The cell now has one child per turned die with the simulator's own
 * chance (`randomChance(33, 100)` for the confusion, one in three for the Protect counter), and the proof reads the mass. The
 * scenes are the four proofs of the plan's section 3 (saved roots of the corpus games, `fixtures/forced-win/plain-dice-*`) and
 * #145's own singles scene, which the game decides by a third as well.
 */
interface Scene {
  id: string;
  turn: number;
  serialized: string;
  tera: TeraAllowance;
  sleepClause: boolean;
  ruleset: StaticRuleset;
  side: 'p1' | 'p2';
  rootOrder: string[];
  p1Won: boolean;
}
const scene = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/forced-win/plain-dice-${name}.json`, import.meta.url), 'utf-8')) as Scene;

/** One root candidate by itself with the production budget (the proving move of a scene that A5f5's scout proved). */
function alone(board: Scene) {
  const root = createRootPosition(board.serialized, board.ruleset);
  const prover = new Prover(board.side, { tera: board.tera, sleepClause: board.sleepClause, ruleset: board.ruleset }, { ...PROVER_BUDGET }, { states: 0, cells: 0 });
  prover.states += 1;
  const { proven, cells } = prover.expand(root, 0, board.rootOrder);
  return { proven, cells };
}

describe('the lost-side proof of VGC 2408473310 turn 13 (the confusion self-hit)', () => {
  test('Miraidon hits itself one time in three: the root cell has that child, the proof reads below 1 and at most 0.80', async () => {
    const board = scene('gen9vgc2025regi-2408473310-t13');
    await loadSimMods('gen9doublescustomgame');
    const root = createRootPosition(board.serialized, board.ruleset);
    const cell = endgameChildren(root, 'move dracometeor 2', 'move protect', 6);
    expect(cell.plain).toBe(true);
    expect(cell.children.map(child => child.share).sort((a, b) => a - b)).toEqual([expect.closeTo(0.33, 12), expect.closeTo(0.67, 12)]);
    const proof = proveForcedWin(board.serialized, { side: board.side, rootOrder: board.rootOrder, tera: board.tera, sleepClause: board.sleepClause, ruleset: board.ruleset });
    expect(proof.mass).toBeLessThan(1);
    expect(proof.mass).toBeLessThanOrEqual(0.8);
    expect(proof.mass).toBeGreaterThan(0.5);
  });
});

describe('a repeated Protect is priced at the proving move (doubles, A5f5 proofs that A7 no longer finds)', () => {
  // the proving move alone: the hold the draws all failed is one third, so no turn proves the win in one turn
  test.each([
    ['Champions VGC 2679549596 turn 7', 'gen9championsvgc2026regmbbo3-2679549596-t7', 'gen9championsdoublescustomgame'],
    ['VGC 2468711188 turn 7', 'gen9vgc2025regj-2468711188-t7', 'gen9doublescustomgame'],
    ['VGC 2532538236 turn 7', 'gen9vgc2026regi-2532538236-t7', 'gen9doublescustomgame'],
  ])('%s: the proof is no longer a one-turn proof', async (_title, name, mod) => {
    const board = scene(name);
    await loadSimMods(mod);
    const { proven } = alone(board);
    expect(proven.turns, `${name} turns`).toBeGreaterThan(1);
  });

  test('the cell of the Detect against Rock Blast splits two thirds and one third', async () => {
    const board = scene('gen9vgc2025regj-2468711188-t7');
    await loadSimMods('gen9doublescustomgame');
    const { cells } = alone(board);
    const worst = cells.find(cell => cell.proven.mass < 1)?.cell;
    // the cell the proof reads at its root with the hold: the mass of the proof is the sum of the shares of the proven children
    const shares = (worst?.children ?? []).map(child => child.share);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 12);
    expect(shares.some(share => Math.abs(share - 1 / 3) < 1e-9)).toBe(true);
  });
});

describe('#145 singles scene: a second Spiky Shield holds one time in three', () => {
  // Chesnaught at 1 HP behind a Protect counter of 1 against a Garchomp that needs one more hit: the shield holds with the chance
  // the counter gives, and the game decides the rest. The sweep proves the share for every stalling move of every rule set.
  test.each([
    ['Scarlet/Violet', 'gen9customgame', 'standard', 100, undefined],
    ['Champions', 'gen9championscustomgame', 'champions', 50, { hp: 32, atk: 32, def: 0, spa: 32, spd: 2, spe: 0 }],
  ] as const)('%s: the cell has a child of 2/3 and one of 1/3, the proof reads 2/3', async (_title, format, ruleset, level, evs) => {
    await loadSimMods('gen9championsou');
    const extra = { level, ...(evs ? { evs } : {}) };
    const battle = battleOf(format, [set('Chesnaught', ['spikyshield', 'woodhammer'], extra)], [set('Garchomp', ['dragonclaw'], extra)]);
    const chesnaught = battle.sides[0].active[0]!;
    const garchomp = battle.sides[1].active[0]!;
    chesnaught.hp = 1;
    garchomp.hp = Math.max(1, Math.floor(garchomp.maxhp / 8) - 1);
    chesnaught.addVolatile('stall');
    const root = createRootPosition(JSON.stringify(State.serializeBattle(battle)), ruleset);
    const cell = endgameChildren(root, 'move spikyshield', 'move dragonclaw', 6);
    expect(cell.plain).toBe(true);
    expect(cell.unpriced).toBe(false);
    expect(cell.children.map(child => child.share).sort((a, b) => a - b)).toEqual([expect.closeTo(1 / 3, 12), expect.closeTo(2 / 3, 12)]);
    expect(positionBattle(root).gameType).toBe('singles');
    const proof = proveForcedWin(root, { side: 'p2', rootOrder: [], tera: false });
    expect(proof.mass).toBeCloseTo(2 / 3, 9);
  });
});

describe('the tie path: each order plays apart and prices its dice (doubles)', () => {
  // Snorlax against Snorlax at one speed in the leading slots: the order is a coin flip (a child of one half each), and the confusion
  // of the first one decides inside each order (the self-hit, `randomChance(33, 100)`). Nobody faints, so the draws agree on the faints.
  test('two orders of one half, the self-hit splits 33 to 67 inside each', async () => {
    await loadSimMods('gen9championsou');
    const slow = { evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } };
    const battle = battleOf(
      'gen9doublescustomgame', [set('Snorlax', ['tackle'], slow), set('Blissey', ['splash'])], [set('Snorlax', ['tackle'], slow), set('Chansey', ['splash'])],
    );
    battle.sides[0].active[0]!.addVolatile('confusion');
    const root = createRootPosition(JSON.stringify(State.serializeBattle(battle)), 'standard');
    const cell = endgameChildren(root, 'move tackle 1, move splash', 'move tackle 1, move splash', 6);
    expect(cell.plain).toBe(true);
    expect(cell.unpriced).toBe(false);
    const shares = cell.children.map(child => child.share).sort((a, b) => a - b);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 12);
    expect(shares).toEqual([0.165, 0.165, 0.335, 0.335].map(share => expect.closeTo(share, 12)));
  });
});
