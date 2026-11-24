import { test, expect, describe, vi } from 'vitest';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { applyForcedWin, forcedWinInput, forcedWinPossible, PROVER_NEAR_TIE } from '../src/search/forced-win-apply';
import { forcedWinFor, forcedWinSides } from '../src/search/forced-win';
import { createRootPosition, positionBattle, legalChoices } from '../src/forward-model';
import type { EvalResult, RankedChoice, ForcedWinProof, EvalSettings } from '../src/types';
import { readFileSync } from 'node:fs';
import { endgameChildren } from '../src/endgame/children';
import { heldStall } from '../src/endgame/delay-facts';
import { readDelay } from '../src/endgame/delay-rule';
import { ForcedWinProver, PROVER_BUDGET, proveForcedWin } from '../src/endgame/prover';
import { loadSimMods } from '../src/forward/sim-mods';
import type { StaticRuleset } from '../src/eval-function';
import { playClicks } from './dice-fixtures';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';
import { sureStrike } from '../src/endgame/prover-strike';

await loadSimMods('gen9championsdoublescustomgame');

function makeSet(name: string, species: string, moves: string[], level = 100): PokemonSet {
  return {
    name, species, item: '', ability: 'No Ability', moves,
    nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level, gender: '',
  };
}

function makeBattle(p1Sets: PokemonSet[], p2Sets: PokemonSet[], formatid = 'gen9customgame'): Battle {
  const battle = new Battle({
    formatid: toID(formatid),
    seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1Sets) },
    p2: { name: 'Beta', team: Teams.pack(p2Sets) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', `team ${p1Sets.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2Sets.map((_, index) => index + 1).join('')}`);
  }
  return battle;
}

/** Sets every listed body to `hp` (slot order per side) and serializes. */
function serializeAt(battle: Battle, hp: { p1?: number[]; p2?: number[] }): string {
  for (const side of ['p1', 'p2'] as const) {
    (hp[side] ?? []).forEach((value, index) => { battle.sides[side === 'p1' ? 0 : 1].pokemon[index].hp = value; });
  }
  return JSON.stringify(State.serializeBattle(battle));
}

const row = (choice: string, ev: number): RankedChoice => ({ choice, label: choice, worstCase: ev, expected: ev, ev, punishedBy: 'Reply' });
const resultWith = (score: number, p1: string[], p2: string[], extra: Partial<EvalResult> = {}): EvalResult => ({
  score, interval: 0, depthCompleted: 1,
  perSide: { p1: p1.map(choice => row(choice, score)), p2: p2.map(choice => row(choice, -score)) },
  ...extra,
});

describe('forced-win trigger and bar', () => {
  test('forcedWinInput carries score, profile, ranking order and the search allowance', () => {
    // Rows a band apart keep the ranking's order; a near tie goes by label (the prover-near-tie rows below).
    const result = resultWith(0.3, ['move seismictoss', 'move protect'], ['move softboiled'], {
      unanswered: { p1: [], p2: [], decided: { side: 'p1', species: 'Machamp' } },
    });
    result.perSide.p1[1] = row('move protect', 0.2);
    expect(forcedWinInput(result, { depth: 1, samples: 1, tera: false, sleepClause: true })).toEqual({
      score: 0.3,
      unanswered: result.unanswered,
      rootOrder: { p1: ['move seismictoss', 'move protect'], p2: ['move softboiled'] },
      tera: false,
      sleepClause: true,
    });
  });

  test('sides: endgame scope tries the favored side then the other; a decided profile names its side only', () => {
    const endgame = positionBattle(createRootPosition(serializeAt(makeBattle(
      [makeSet('Champ', 'Machamp', ['Seismic Toss'])],
      [makeSet('Egg', 'Chansey', ['Soft-Boiled'])],
    ), { p2: [1] })));
    expect(forcedWinSides(endgame, { score: -0.1, rootOrder: { p1: [], p2: [] } })).toEqual(['p2', 'p1']);
    expect(forcedWinSides(endgame, { score: 0.2, rootOrder: { p1: [], p2: [] } })).toEqual(['p1', 'p2']);
    const full = positionBattle(createRootPosition(JSON.stringify(State.serializeBattle(makeBattle(
      [makeSet('A', 'Machamp', ['Seismic Toss']), makeSet('B', 'Chansey', ['Soft-Boiled']), makeSet('C', 'Snorlax', ['Rest'])],
      [makeSet('D', 'Machamp', ['Seismic Toss']), makeSet('E', 'Chansey', ['Soft-Boiled']), makeSet('F', 'Snorlax', ['Rest'])],
    )))));
    expect(forcedWinSides(full, { score: 0.5, rootOrder: { p1: [], p2: [] } })).toEqual([]);
    expect(forcedWinSides(full, {
      score: -0.7, rootOrder: { p1: [], p2: [] },
      unanswered: { p1: [], p2: [], decided: { side: 'p2', species: 'Machamp' } },
    })).toEqual(['p2']);
    // A named side with a lukewarm score stays out on a full board: no bank proof ever stood there.
    expect(forcedWinSides(full, {
      score: -0.5, rootOrder: { p1: [], p2: [] },
      unanswered: { p1: [], p2: [], decided: { side: 'p2', species: 'Machamp' } },
    })).toEqual([]);
    expect(forcedWinSides(full, {
      score: 0.6, rootOrder: { p1: [], p2: [] },
      unanswered: { p1: [], p2: [], nearDecided: { side: 'p1', species: 'Machamp', odds: 0.95, removes: 'Chansey' } },
    })).toEqual(['p1']);
  });

  test('forcedWinPossible mirrors the trigger without the sim: profiles, small boards, the last pair', () => {
    const noProfile = { score: 0.5, rootOrder: { p1: [], p2: [] } };
    const full = JSON.stringify(State.serializeBattle(makeBattle(
      [makeSet('A', 'Machamp', ['Seismic Toss']), makeSet('B', 'Chansey', ['Soft-Boiled']), makeSet('C', 'Snorlax', ['Rest'])],
      [makeSet('D', 'Machamp', ['Seismic Toss']), makeSet('E', 'Chansey', ['Soft-Boiled']), makeSet('F', 'Snorlax', ['Rest'])],
    )));
    expect(forcedWinPossible(full, noProfile)).toBe(false);
    expect(forcedWinPossible(full, { ...noProfile, unanswered: { p1: [], p2: [], decided: { side: 'p1', species: 'Machamp' } } })).toBe(false);
    expect(forcedWinPossible(full, { ...noProfile, score: 0.7, unanswered: { p1: [], p2: [], decided: { side: 'p1', species: 'Machamp' } } })).toBe(true);
    expect(forcedWinPossible(full, {
      ...noProfile, score: -0.9, unanswered: { p1: [], p2: [], nearDecided: { side: 'p2', species: 'Machamp', odds: 0.9, removes: 'Chansey' } },
    })).toBe(true);
    const pair = serializeAt(makeBattle([makeSet('Champ', 'Machamp', ['Seismic Toss'])], [makeSet('Egg', 'Chansey', ['Soft-Boiled'])]), { p2: [1] });
    expect(forcedWinPossible(pair, noProfile)).toBe(true);
    const twoVsOne = makeBattle(
      [makeSet('A', 'Machamp', ['Seismic Toss']), makeSet('B', 'Chansey', ['Soft-Boiled'])],
      [makeSet('D', 'Machamp', ['Seismic Toss']), makeSet('E', 'Chansey', ['Soft-Boiled'])],
    );
    twoVsOne.sides[1].pokemon[1].faint();
    twoVsOne.resolveFaints();
    expect(forcedWinPossible(JSON.stringify(State.serializeBattle(twoVsOne)), noProfile)).toBe(true);
    expect(forcedWinPossible('not json', noProfile)).toBe(true);
  });

  test('forcedWinFor proves the endgame for the favored side and the bar lifts the score to the mass', () => {
    const serialized = serializeAt(makeBattle(
      [makeSet('Champ', 'Machamp', ['Seismic Toss', 'Protect'])],
      [makeSet('Egg', 'Chansey', ['Soft-Boiled'])],
    ), { p2: [1] });
    const result = resultWith(0.4, ['move seismictoss', 'move protect'], ['move softboiled']);
    // A band apart keeps Seismic Toss first. Equal rows order by label, Protect would lead, and the full proof (no greedy scout names
    // the winning line first) reads that stalling line's win in 11 turns instead of the Toss's one.
    result.perSide.p1[1] = row('move protect', 0.2);
    const outcome = forcedWinFor(createRootPosition(serialized), forcedWinInput(result, { depth: 1, samples: 1, tera: false }));
    expect(outcome?.side).toBe('p1');
    expect(outcome?.proof.mass).toBe(1);
    applyForcedWin(result, outcome);
    expect(result.score).toBe(1);
    expect(result.forcedWin).toEqual({ side: 'p1', turns: 1, mass: 1, caveat: 'none', engineScore: 0.4, states: outcome!.proof.states });
  });

  test('the bar blends a partial mass with the open branch static', () => {
    const result = resultWith(0.2, ['move thunder'], ['move closecombat']);
    applyForcedWin(result, { side: 'p1', proof: { mass: 0.7, turns: 1, caveat: 'none', openValue: -1, states: 3 } });
    expect(result.score).toBeCloseTo(0.4, 6);
    expect(result.forcedWin?.engineScore).toBe(0.2);
  });

  test('a coin flip (mass exactly one half) keeps the proof on the result but moves no score', () => {
    const result = resultWith(0.2, ['move tackle'], ['move tackle']);
    applyForcedWin(result, { side: 'p1', proof: { mass: 0.5, turns: 1, caveat: 'none', openValue: -1, states: 1, cells: 1 } });
    expect(result.score).toBe(0.2);
    expect(result.forcedWin).toEqual({ side: 'p1', turns: 1, mass: 0.5, caveat: 'none', engineScore: 0.2, states: 1 });
  });

  test('a mass below the threshold and a null outcome change nothing', () => {
    const result = resultWith(0.2, ['move thunder'], ['move closecombat']);
    applyForcedWin(result, { side: 'p1', proof: { mass: 0.4, turns: 1, caveat: 'none', openValue: -1, states: 3 } });
    applyForcedWin(result, null);
    expect(result.score).toBe(0.2);
    expect(result.forcedWin).toBeUndefined();
  });

  test('p2 proofs bar toward -1', () => {
    const result = resultWith(-0.3, ['move softboiled'], ['move seismictoss']);
    applyForcedWin(result, { side: 'p2', proof: { mass: 1, turns: 2, caveat: 'barring-crit', openValue: null, states: 5 } });
    expect(result.score).toBe(-1);
  });

  test('doubles: a 2v1 field is in scope and proves for the two-body side', () => {
    const battle = makeBattle(
      [makeSet('Champ', 'Machamp', ['Seismic Toss']), makeSet('Champ2', 'Machamp', ['Seismic Toss'])],
      [makeSet('Egg', 'Chansey', ['Soft-Boiled']), makeSet('Chu', 'Pikachu', ['Tackle'], 5)],
      'gen9doublescustomgame',
    );
    battle.sides[1].active[1]!.faint();
    battle.resolveFaints();
    const serialized = serializeAt(battle, { p2: [1] });
    const result = resultWith(0.1, [], []);
    const outcome = forcedWinFor(createRootPosition(serialized), forcedWinInput(result, { depth: 1, samples: 1, tera: false }));
    expect(outcome?.side).toBe('p1');
    expect(outcome?.proof.caveat).toBe('sampled-rolls');
  });
});

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

describe('the four Champions scenes the user reported', () => {
  test('Champions VGC 2694505370 turn 10: the held Protect lets the partner hit, no proof for the side that lost', () => {
    const proof = sceneProof(scene('forced-win-delay/champions-vgc-2694505370-t10'));
    expect(proof.delay).toBeUndefined();
    expect(proof.mass).toBe(0);
  });

  test('Champions VGC 2628166702 turn 7: Umbreon\'s Leftovers heal each held Protect, no forced win (the game gives P1 about 0.64)', () => {
    const proof = sceneProof(scene('forced-win-delay/champions-vgc-2628166702-t7'));
    expect(proof.delay).toBeUndefined();
    expect(proof.mass).toBe(0);
  });

  // the ranking's three root candidates and the sure strike before them, as the app asks: each repeated Protect is a delay, and Aqua Jet knocks
  // Raichu out before Zap Cannon lands, so the proof reads mass 1 in 2 turns (the first Protect is sure, the second can hold, then Aqua Jet).
  // Without the strike these two boards read 0.765625, 7/8 of 7/8 (Volcarona's paralysis die at each of two levels).
  test.each([
    ['the fixture', 'forced-win/scout-miss-gen9championsvgc2026regmbbo3-2682637901-t6'],
    ['today\'s bank root', 'forced-win-delay/champions-vgc-2682637901-t6-bank'],
  ])('Champions VGC 2682637901 turn 6, %s: the repeated Protect is a delay and the sure strike proves it: mass 1 in 2 turns', (_title, name) => {
    const proof = sceneProof(scene(name));
    expect(proof.mass).toBeCloseTo(1, 9);
    expect(proof.turns).toBe(2);
    expect(proof.delay).toBe('protect');
  });

  test('Heat Wave with Aqua Jet alone on the fixture: the proof reads 1 (stage P2 alone read 0.765625: the inner node played Zap Cannon\'s losing side)', () => {
    const board = scene('forced-win/scout-miss-gen9championsvgc2026regmbbo3-2682637901-t6');
    const root = createRootPosition(board.serialized, board.ruleset);
    const choice = 'move heatwave, move aquajet 1';
    const prover = () => new ForcedWinProver(board.side, { tera: false, ruleset: board.ruleset }, { ...PROVER_BUDGET }, { states: 0, cells: 0 });
    const lazy = prover().candidateMass(root, choice, true);
    const full = prover().candidateMass(root, choice, false);
    expect(full.mass).toBeCloseTo(1, 9);
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

const proofOf = (board: Scene): ForcedWinProof =>
  proveForcedWin(createRootPosition(board.serialized, board.ruleset), { side: board.side, rootOrder: board.rootOrder, tera: false, ruleset: board.ruleset });

const SCENE_1 = 'forced-win/scout-miss-gen9championsvgc2026regmbbo3-2682637901-t6';
const SCENE_1_BANK = 'forced-win-delay/champions-vgc-2682637901-t6-bank';
const WINNING_CHOICE = 'move heatwave, move aquajet 1';

describe('Champions VGC 2682637901 turn 6: Aqua Jet knocks Raichu out before it moves, in every roll', () => {
  test.each([['the fixture', SCENE_1], ['today\'s bank root', SCENE_1_BANK]])('%s: the proof reads mass 1 in 2 turns within 20 cells, names the delay and the winning choice', (_title, name) => {
    const proof = proofOf(scene(name));
    expect(proof.mass).toBeCloseTo(1, 9);
    expect(proof.turns).toBe(2);
    expect(proof.delay).toBe('protect');
    expect(proof.cells).toBeLessThanOrEqual(20);
    // the search's own list holds Aqua Jet only beside Quiver Dance: the strike with Heat Wave comes from the legal choices
    expect(proof.choice).toBe(WINNING_CHOICE);
  });

  test.each([['the fixture', SCENE_1], ['today\'s bank root', SCENE_1_BANK]])('%s: the strike leads the root candidates, before the ranking\'s three', (_title, name) => {
    const board = scene(name);
    const prover = new ForcedWinProver(board.side, { tera: false, ruleset: board.ruleset }, { ...PROVER_BUDGET }, { states: 0, cells: 0 });
    const candidates = prover.rootCandidates(createRootPosition(board.serialized, board.ruleset), board.rootOrder);
    expect(candidates[0]).toBe(WINNING_CHOICE);
    expect(candidates.slice(1, 4)).toEqual(board.rootOrder.slice(0, 3));
  });

  // the foe's first Protect is sure and Volcarona's paralysis die is a turned child in that root cell (the board stays, only a PP count and the last
  // move differ): the lazy pass leaves it aside and reads 7/8, the full pass reads the child and proves the whole share
  test('the strike by itself: the lazy pass reads 7/8 (the paralysis die left aside, the ended failed repeat read), the full pass reads 1', () => {
    const board = scene(SCENE_1);
    const root = createRootPosition(board.serialized, board.ruleset);
    const prover = () => new ForcedWinProver(board.side, { tera: false, ruleset: board.ruleset }, { ...PROVER_BUDGET }, { states: 0, cells: 0 });
    const lazy = prover().candidateMass(root, WINNING_CHOICE, true);
    const full = prover().candidateMass(root, WINNING_CHOICE, false);
    expect(lazy.mass).toBeCloseTo(0.875, 9);
    expect(full.mass).toBeCloseTo(1, 9);
    expect(lazy.mass).toBeLessThanOrEqual(full.mass + 1e-12);
  });
});

describe('a strike that does not end the root runs on cells of its own', () => {
  // VGC 2470704517 turn 6: the strike (Stomping Tantrum with Knock Off) proves 2/3 on 35 cells; the ranking's third candidate proves the win
  // on 98 of the 100. Inside the shared budget the strike left 65 and the proof fell to 2/3; on cells of its own the ranking's
  // candidates keep their budget (the strike's partial proof is the 0.963 of a longer line).
  test('the ranking\'s proving candidate keeps its cells: mass 0.96 or more, at most 100 cells', () => {
    const proof = proofOf(scene('forced-win-delay/vgc-2470704517-t6'));
    expect(proof.mass).toBeGreaterThanOrEqual(0.96);
    expect(proof.cells).toBeLessThanOrEqual(PROVER_BUDGET.cells);
  });
});

describe('the boards where no strike exists keep their proofs', () => {
  test('Champions VGC 2694684816 turn 8 on the bank root: the proof stays at 0.5747 or above (the strike-only order costs no proof)', () => {
    expect(proofOf(scene('forced-win-delay/champions-vgc-2694684816-t8-bank')).mass).toBeGreaterThanOrEqual(0.5747);
  });
});
const serialize = (battle: Battle): string => JSON.stringify(State.serializeBattle(battle));
const strikeOn = (battle: Battle, side: 'p1' | 'p2' = 'p1'): string | null => {
  const position = createRootPosition(serialize(battle), 'standard');
  return sureStrike(position, side, legalChoices(position, side, { tera: false }), false)?.choice ?? null;
};

describe('singles: a sure kill that moves before the foe', () => {
  // Pikachu outruns Snorlax: Tackle kills Pikachu at 1 HP in every roll but Pikachu moves first; Quick Attack goes first
  const board = (prepare: (battle: Battle) => void = oneHp) => {
    const battle = battleOf(SINGLES, [set('Snorlax', ['Tackle', 'Quick Attack'])], [set('Pikachu', ['Tackle', 'Splash'])]);
    prepare(battle);
    return battle;
  };

  test('the faster kill is the strike, and the root tries it before the ranking\'s Tackle', () => {
    const battle = board();
    expect(strikeOn(battle)).toBe('move quickattack');
    const candidates = new ForcedWinProver('p1', { tera: false, ruleset: 'standard' }, { ...PROVER_BUDGET }, { states: 0, cells: 0 })
      .rootCandidates(createRootPosition(serialize(battle), 'standard'), ['move tackle']);
    expect(candidates).toEqual(['move quickattack', 'move tackle']);
  });

  test('Trick Room turns the order: the slow Snorlax moves first, so a plain Tackle is a strike (the Dex priority alone would miss it)', () => {
    const slowOnly = battleOf(SINGLES, [set('Snorlax', ['Tackle', 'Splash'])], [set('Pikachu', ['Tackle', 'Splash'])]);
    oneHp(slowOnly);
    expect(strikeOn(slowOnly)).toBeNull();
    slowOnly.field.addPseudoWeather('trickroom', slowOnly.sides[0].active[0]!);
    expect(strikeOn(slowOnly)).toBe('move tackle');
  });

  // the strike takes none of the candidates' places: with the strike among the engine's own options and named first in the root's list,
  // an order that reads it twice drops the ranking's third candidate (the proving one in three corpus rows)
  test('the root tries the strike and the ranking\'s first three: four candidates, none displaced (the strike is also an option of the engine\'s list)', () => {
    const battle = battleOf(SINGLES, [set('Snorlax', ['Tackle', 'Quick Attack', 'Body Slam', 'Splash'])], [set('Pikachu', ['Tackle', 'Splash'])]);
    oneHp(battle);
    const ranking = ['move tackle', 'move bodyslam', 'move splash', 'move quickattack'];
    const loop = vi.spyOn(ForcedWinProver.prototype as unknown as { rootLoop: (...args: unknown[]) => unknown }, 'rootLoop');
    try {
      proveForcedWin(createRootPosition(serialize(battle), 'standard'), { side: 'p1', rootOrder: ranking, tera: false });
      const tried = (loop.mock.calls[0][2] as { choice: string }[]).map(candidate => candidate.choice);
      expect(tried).toEqual(['move quickattack', 'move tackle', 'move bodyslam', 'move splash']);
    } finally {
      loop.mockRestore();
    }
  });

  test('a foe at full HP is no strike (the kill is not in every roll)', () => {
    expect(strikeOn(board(() => undefined))).toBeNull();
  });

  test('the strike is read from a copy: the live battle is unchanged', () => {
    const battle = board();
    const position = createRootPosition(serialize(battle), 'standard');
    const before = serialize(positionBattle(position));
    sureStrike(position, 'p1', legalChoices(position, 'p1', { tera: false }), false);
    expect(serialize(positionBattle(position))).toBe(before);
  });
});

describe('doubles: the strike only takes the foe\'s last standing body', () => {
  const lead = [set('Pikachu', ['Quick Attack', 'Splash']), set('Pidgeot', ['Splash'])];

  test('the foe\'s last body at 1 HP: Quick Attack at it is the strike', () => {
    const battle = battleOf(DOUBLES, lead, [set('Snorlax', ['Tackle', 'Splash']), set('Machamp', ['Splash'])]);
    oneHp(battle);
    fall(battle, 1);
    expect(strikeOn(battle)).toBe('move quickattack 1, move splash');
  });

  test('a second foe body standing, the same kill: no strike', () => {
    const battle = battleOf(DOUBLES, lead, [set('Snorlax', ['Tackle', 'Splash']), set('Machamp', ['Splash'])]);
    oneHp(battle);
    expect(strikeOn(battle)).toBeNull();
  });
});

describe('the proof names its choice only when the search\'s list lacks it', () => {
  test('a strike the search lists (singles Quick Attack) leaves the field out', () => {
    const battle = battleOf(SINGLES, [set('Snorlax', ['Tackle', 'Quick Attack'])], [set('Pikachu', ['Protect', 'Splash'])]);
    oneHp(battle);
    const proof = proveForcedWin(createRootPosition(serialize(battle), 'standard'), { side: 'p1', rootOrder: [], tera: false });
    expect(proof.mass).toBeCloseTo(1, 9);
    expect('choice' in proof).toBe(false);
  });

  const proof = (extra: Partial<ForcedWinProof>): ForcedWinProof => ({ mass: 1, turns: 2, caveat: 'sampled-rolls', openValue: null, states: 3, cells: 5, ...extra });
  test.each([
    ['named', WINNING_CHOICE, { choice: WINNING_CHOICE }],
    ['absent', undefined, {}],
  ])('a proof with the choice %s: result.forcedWin.choice is %s', (_title, expected, extra) => {
    const result = { score: 0.2 } as EvalResult;
    applyForcedWin(result, { side: 'p1', proof: proof(extra) });
    expect(result.forcedWin?.choice).toBe(expected);
    expect('choice' in (result.forcedWin ?? {})).toBe(expected !== undefined);
  });
});

describe('prover-near-tie', () => {
  const settings: EvalSettings = { depth: 1, samples: 1, mode: 'mcts', tera: false };
  const row = (label: string, choice: string, ev: number): RankedChoice => ({ label, choice, ev, worstCase: ev, expected: ev, punishedBy: null });
  const result = (rows: RankedChoice[]): EvalResult => ({ score: 0, interval: 0, depthCompleted: 1, perSide: { p1: rows, p2: [] } });

  describe('the prover’s root order across near ties', () => {
    test('two rankings that differ only inside a near tie give the prover one root order (653785 t24)', () => {
      // The ranking of 653785 t24: U-turn and Hidden Power Ice stand 0.0017 apart. The second ranking is a noise-sized estimate of
      // the same root with the two swapped (every value moved by less than 0.016).
      const official = result([
        row('Hurricane', 'move hurricane', 0.1764), row('U-turn', 'move uturn', -0.0136), row('Hidden Power Ice', 'move hiddenpower', -0.0153),
        row('→ Cofagrigus', 'switch 4', -0.0329), row('Knock Off', 'move knockoff', -0.0359), row('→ Volcanion', 'switch 3', -0.1073),
      ]);
      const swapped = result([
        row('Hurricane', 'move hurricane', 0.1915), row('Hidden Power Ice', 'move hiddenpower', -0.0130), row('U-turn', 'move uturn', -0.0134),
        row('→ Cofagrigus', 'switch 4', -0.0332), row('Knock Off', 'move knockoff', -0.0358), row('→ Volcanion', 'switch 3', -0.1069),
      ]);
      expect(forcedWinInput(swapped, settings).rootOrder.p1.slice(0, 3)).toEqual(forcedWinInput(official, settings).rootOrder.p1.slice(0, 3));
    });

    test('rows further apart than the band keep the ranking order', () => {
      const ranked = result([row('B', 'move b', 0.3), row('A', 'move a', 0.3 - 2 * PROVER_NEAR_TIE), row('C', 'move c', 0.3 - 4 * PROVER_NEAR_TIE)]);
      expect(forcedWinInput(ranked, settings).rootOrder.p1).toEqual(['move b', 'move a', 'move c']);
    });

    test('a near tie goes by label from the top of its group, and the group ends one band below its top', () => {
      const ranked = result([
        row('Z', 'move z', 0.1), row('Y', 'move y', 0.1 - PROVER_NEAR_TIE / 2), row('X', 'move x', 0.1 - 0.9 * PROVER_NEAR_TIE),
        row('W', 'move w', 0.1 - 1.4 * PROVER_NEAR_TIE),
      ]);
      // W sits within one band of X but more than one band below the group's top Z: it starts a group of its own.
      expect(forcedWinInput(ranked, settings).rootOrder.p1).toEqual(['move x', 'move y', 'move z', 'move w']);
    });
  });
});
