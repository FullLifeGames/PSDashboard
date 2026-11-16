import { readFileSync } from 'node:fs';
import { State, type Battle } from '@pkmn/sim';
import { describe, expect, test } from 'vitest';
import { endgameChildren } from '../src/endgame/children';
import { heldStall } from '../src/endgame/delay-facts';
import { readDelay } from '../src/endgame/delay-rule';
import { ForcedWinProver, PROVER_BUDGET, proveForcedWin } from '../src/endgame/prover';
import { createRootPosition, positionBattle } from '../src/forward-model';
import { loadSimMods } from '../src/forward/sim-mods';
import { applyForcedWin } from '../src/search/forced-win-apply';
import type { EvalResult, ForcedWinProof } from '../src/types';
import type { StaticRuleset } from '../src/eval-function';
import { playClicks } from './dice-fixtures';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 89 (P2, 1.2.0): the delay rule of the forced-win prover. A foe that repeats a stalling move holds with a chance that only
 * falls along a chain, and the chain ends with its PP. When the held turn leaves the board as it was (`endgame/delay-facts.ts`), the
 * prover prices the cell by what the failed repeat gives, and the proof names the stalling move (`ForcedWinProof.delay`). Where the
 * held turn changes something (a heal, a status, the partner's hit, a contact shield, a stage), nothing is delayed and the
 * hold counts as a position of its own, as before. The boards are the probe's of lane P (P-DIAG2, `lanes/P/out/fix2-9.json`).
 */
await loadSimMods('gen9championsdoublescustomgame');

interface Scene { serialized: string; side: 'p1' | 'p2'; rootOrder: string[]; tera: boolean; sleepClause: boolean; ruleset?: StaticRuleset }
const scene = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf-8')) as Scene;

const asProof = (serialized: string, ruleset: StaticRuleset | undefined, rootOrder: string[], side: 'p1' | 'p2' = 'p1'): ForcedWinProof =>
  proveForcedWin(createRootPosition(serialized, ruleset), { side, rootOrder, tera: false, ruleset });
const sceneProof = (board: Scene): ForcedWinProof => asProof(board.serialized, board.ruleset, board.rootOrder, board.side);

/** A board of a custom format whose bodies the spec sets, serialized as the app serializes a live battle. */
function boardOf(format: string, p1: ReturnType<typeof set>[], p2: ReturnType<typeof set>[], prepare: (battle: Battle) => void): string {
  const battle = battleOf(format, p1, p2);
  prepare(battle);
  return JSON.stringify(State.serializeBattle(battle));
}
const fall = (battle: Battle, index: number): void => {
  const body = battle.sides[1].pokemon[index];
  body.hp = 0;
  body.fainted = true;
  body.faint();
  battle.sides[1].pokemonLeft--;
  battle.sides[1].faintedThisTurn = null;
};
const oneHp = (battle: Battle): void => void (battle.sides[1].active[0]!.hp = 1);

const SINGLES = 'gen9customgame';
const DOUBLES = 'gen9doublescustomgame';
const protectBoard = (foeItem?: Record<string, string>): string => boardOf(SINGLES, [set('Pikachu', ['Tackle'])], [set('Snorlax', ['Protect', 'Splash'], foeItem)], oneHp);
const doublesBoard = (stall: string, foe: string): string => boardOf(DOUBLES, [set('Pikachu', ['Tackle', 'Splash']), set('Pidgeot', ['Splash', 'Tackle'])], [set(foe, [stall, 'Splash']), set('Snorlax', ['Splash'])], battle => { oneHp(battle); fall(battle, 1); });

describe('a repeated Protect at a foe of 1 HP: the repeat only delays the knock-out', () => {
  test('singles: the proof reads mass 1 in 2 turns and names Protect (the repeat is an unpriced split without the delay rule, mass 0)', () => {
    const proof = asProof(protectBoard(), 'standard', ['move tackle']);
    expect(proof.mass).toBeCloseTo(1, 9);
    expect(proof.turns).toBe(2);
    expect(proof.delay).toBe('protect');
  });

  test('doubles, Protect: mass 1 in 2 turns within 6 cells (before: 12 turns at 100 cells)', () => {
    const proof = asProof(doublesBoard('Protect', 'Snorlax'), 'standard', ['move tackle 1, move splash']);
    expect(proof.mass).toBeCloseTo(1, 9);
    expect(proof.turns).toBe(2);
    expect(proof.delay).toBe('protect');
    expect(proof.cells).toBeLessThanOrEqual(6);
  });

  test('doubles, Detect: mass 1 in 2 turns, and the proof names Detect (before: 10 turns at 58 cells)', () => {
    const proof = asProof(doublesBoard('Detect', 'Hitmonchan'), 'standard', ['move tackle 1, move splash']);
    expect(proof.mass).toBeCloseTo(1, 9);
    expect(proof.turns).toBe(2);
    expect(proof.delay).toBe('detect');
  });

  test.each([['gen3customgame', 'Generation 3'], ['gen4customgame', 'Generation 4']])('%s (%s): the hold stays at 1 in 8 at its cap, and the miss of a 95 % Tackle is no stall cell: mass 0.9 to 1, delayed', format => {
    const board = boardOf(format, [set('Pikachu', ['Tackle'])], [set('Snorlax', ['Protect', 'Splash'])], oneHp);
    const proof = asProof(board, 'standard', ['move tackle']);
    expect(proof.delay).toBe('protect');
    expect(proof.mass).toBeGreaterThan(0.9);
    expect(proof.mass).toBeLessThanOrEqual(1);
  });
});

describe('the margin and the held turns that matter: no delay pricing', () => {
  test('Tackle at 2 PP against 16 Protect PP: the attacker runs dry first, no delay, mass 0', () => {
    const board = boardOf(SINGLES, [set('Pikachu', ['Tackle'])], [set('Snorlax', ['Protect', 'Splash'])], battle => {
      oneHp(battle);
      battle.sides[0].active[0]!.moveSlots[0].pp = 2;
    });
    const proof = asProof(board, 'standard', ['move tackle']);
    expect(proof.delay).toBeUndefined();
    expect(proof.mass).toBe(0);
  });

  // singles: a repeated Protect is an unpriced split of the end, and only the delay rule reads such a split, so a held turn that matters leaves
  // the cell at mass 0; the game's own bound is 2/3 (the failed repeat wins, the held one heals or hurts), which no proof may pass
  test('Leftovers: each held Protect heals the foe, so the hold counts: no delay, and no mass above 2/3', () => {
    const proof = asProof(protectBoard({ item: 'Leftovers' }), 'standard', ['move tackle']);
    expect(proof.delay).toBeUndefined();
    expect(proof.mass).toBeLessThanOrEqual(2 / 3 + 1e-9);
  });

  test('a poisoned attacker loses HP in each held turn: no delay, and no mass above 2/3', () => {
    const board = boardOf(SINGLES, [set('Pikachu', ['Tackle'])], [set('Snorlax', ['Protect', 'Splash'])], battle => {
      oneHp(battle);
      battle.sides[0].active[0]!.setStatus('tox');
    });
    const proof = asProof(board, 'standard', ['move tackle']);
    expect(proof.delay).toBeUndefined();
    expect(proof.mass).toBeLessThanOrEqual(2 / 3 + 1e-9);
  });

  test('the foe\'s partner attacks while Protect holds: no delay, mass 0', () => {
    const board = boardOf(DOUBLES, [set('Pikachu', ['Tackle', 'Splash']), set('Pidgeot', ['Splash'])], [set('Snorlax', ['Protect', 'Splash']), set('Machamp', ['Close Combat'])], battle => {
      oneHp(battle);
      battle.sides[0].active[0]!.hp = 60;
    });
    const proof = asProof(board, 'standard', ['move tackle 1, move splash']);
    expect(proof.delay).toBeUndefined();
    expect(proof.mass).toBe(0);
  });

  test('a contact shield hurts the attacker in each held turn: no delay, and no mass above 2/3', () => {
    const board = boardOf(SINGLES, [set('Pikachu', ['Tackle'])], [set('Chesnaught', ['Spiky Shield', 'Splash'])], battle => {
      oneHp(battle);
      battle.sides[0].active[0]!.hp = 30;
    });
    const proof = asProof(board, 'standard', ['move tackle']);
    expect(proof.delay).toBeUndefined();
    expect(proof.mass).toBeLessThanOrEqual(2 / 3 + 1e-9);
  });
});

describe('a held child that is no delay refuses the delay pricing for the whole cell', () => {
  test('a second held child with another HP: readDelay answers null, the plain split answers a delay', () => {
    // the position after the foe's first Protect (sure): its stall volatile stands, the second Protect is the die
    const battle = battleOf(SINGLES, [set('Pikachu', ['Tackle'])], [set('Snorlax', ['Protect', 'Splash'])]);
    playClicks(battle, { p1: 'move 1', p2: 'move 1' });
    battle.sides[1].active[0]!.hp = 1;
    const rolling = createRootPosition(JSON.stringify(State.serializeBattle(battle)), 'standard');
    const cell = { reply: { choice: 'move protect', label: 'Protect' }, p1Choice: 'move tackle', p2Choice: 'move protect', ...endgameChildren(rolling, 'move tackle', 'move protect', 6) };
    const read = readDelay(positionBattle(rolling), 'p1', cell);
    expect(read?.move).toBe('protect');
    const held = (cell.delaySplit?.() ?? cell.children).find(child => !child.ended && child.turned !== true)!;
    const moved = createRootPosition(JSON.stringify(State.serializeBattle(positionBattle(held.position))), 'standard');
    positionBattle(moved).sides[1].active[0]!.hp = 7;
    const mixed = { ...cell, unpriced: false, children: [held, { ...held, position: moved, share: held.share }] };
    expect(readDelay(positionBattle(rolling), 'p1', mixed)).toBeNull();
  });
});

describe('a failed repeat that missed is a delay too (the stall is reset)', () => {
  // Pikachu's attack is blocked by the second Protect when it holds, and when the repeat fails and the attack misses the board is the parent's
  // with one PP less and the stall volatile gone: the next Protect is sure, and the chain goes on until the foe's PP end
  test('readDelay marks the child of the missed attack and the child of the held repeat, and leaves the knock-out alone', () => {
    const battle = battleOf(SINGLES, [set('Pikachu', ['Tackle', 'Splash'])], [set('Snorlax', ['Protect', 'Splash'])]);
    playClicks(battle, { p1: 'move 2', p2: 'move 1' });
    battle.sides[1].active[0]!.hp = 1;
    const parent = createRootPosition(JSON.stringify(State.serializeBattle(battle)), 'standard');
    const held = battleOf(SINGLES, [set('Pikachu', ['Tackle', 'Splash'])], [set('Snorlax', ['Protect', 'Splash'])]);
    playClicks(held, { p1: 'move 2', p2: 'move 1' });
    held.sides[1].active[0]!.hp = 1;
    const missed = createRootPosition(JSON.stringify(State.serializeBattle(held)), 'standard');
    const body = positionBattle(missed).sides[1].active[0]!;
    delete body.volatiles['stall'];
    positionBattle(missed).sides[0].active[0]!.moveSlots[0].pp -= 1;
    const ko = createRootPosition(JSON.stringify(State.serializeBattle(held)), 'standard');
    const faint = positionBattle(ko);
    faint.sides[1].active[0]!.hp = 0;
    faint.sides[1].active[0]!.fainted = true;
    faint.winner = faint.sides[0].name;
    faint.ended = true;
    const child = (position: typeof parent, share: number, extra: { turned?: true; ended?: boolean } = {}) => ({ position, weight: share, share, ended: false, ...extra });
    const cell = {
      p1Choice: 'move tackle', p2Choice: 'move protect', unpriced: false, plain: true,
      children: [child(parent, 1 / 3), child(missed, 0.1, { turned: true }), child(ko, 0.5667, { turned: true, ended: true })],
    };
    const read = readDelay(positionBattle(parent), 'p1', cell);
    expect(read?.delays).toEqual([true, true, false]);
    expect(heldStall(positionBattle(parent), positionBattle(missed), 'p2')).toBe(false);
  });
});

describe('the scenes of the user\'s three Champions boards and #145', () => {
  test('#145, Champions VGC 2694505370 turn 10: the held Protect lets the partner hit, no proof for the side that lost', () => {
    const proof = sceneProof(scene('forced-win-delay/champions-vgc-2694505370-t10'));
    expect(proof.delay).toBeUndefined();
    expect(proof.mass).toBe(0);
  });

  test('Champions VGC 2628166702 turn 7: Umbreon\'s Leftovers heal each held Protect, no forced win (the game gives P1 about 0.64)', () => {
    const proof = sceneProof(scene('forced-win-delay/champions-vgc-2628166702-t7'));
    expect(proof.delay).toBeUndefined();
    expect(proof.mass).toBe(0);
  });

  // the ranking's three root candidates, as the app asks: each repeated Protect is a delay, and the inner node that follows Raichu's first
  // Protect still picks its own choice by the left slot's move, so Zap Cannon into Primarina goes first and the win rests on Volcarona's
  // 7/8 at each of two levels. Stage P3 puts the sure strike (Aqua Jet) first at the root and at inner nodes and moves these to mass 1.
  test.each([
    ['the fixture', 'forced-win/scout-miss-gen9championsvgc2026regmbbo3-2682637901-t6'],
    ['today\'s bank root', 'forced-win-delay/champions-vgc-2682637901-t6-bank'],
  ])('Champions VGC 2682637901 turn 6, %s: the repeated Protect is a delay, the proof reads 7/8 of 7/8 in 2 turns (3/4 of the way to the sure win)', (_title, name) => {
    const proof = sceneProof(scene(name));
    expect(proof.mass).toBeCloseTo(0.765625, 9);
    expect(proof.turns).toBe(2);
    expect(proof.delay).toBe('protect');
  });

  test('Heat Wave with Aqua Jet alone on the fixture: the lazy mass reads the ended failed repeat (never above the full mass)', () => {
    const board = scene('forced-win/scout-miss-gen9championsvgc2026regmbbo3-2682637901-t6');
    const root = createRootPosition(board.serialized, board.ruleset);
    const choice = 'move heatwave, move aquajet 1';
    const prover = () => new ForcedWinProver(board.side, { tera: false, ruleset: board.ruleset }, { ...PROVER_BUDGET }, { states: 0, cells: 0 });
    const lazy = prover().candidateMass(root, choice, true);
    const full = prover().candidateMass(root, choice, false);
    expect(full.mass).toBeCloseTo(0.765625, 9);
    expect(lazy.mass).toBeGreaterThan(0.5);
    expect(lazy.mass).toBeLessThanOrEqual(full.mass + 1e-12);
  });
});

describe('the delay rides on the result the bar keeps', () => {
  const proof = (extra: Partial<ForcedWinProof>): ForcedWinProof => ({ mass: 1, turns: 2, caveat: 'sampled-rolls', openValue: null, states: 3, cells: 5, ...extra });
  test.each([
    ['named', 'protect', { delay: 'protect' }],
    ['absent', undefined, {}],
  ])('a proof with the delay %s: result.forcedWin.delay is %s', (_title, expected, extra) => {
    const result = { score: 0.2 } as EvalResult;
    applyForcedWin(result, { side: 'p1', proof: proof(extra) });
    expect(result.forcedWin?.delay).toBe(expected);
    expect('delay' in (result.forcedWin ?? {})).toBe(expected !== undefined);
  });
});
