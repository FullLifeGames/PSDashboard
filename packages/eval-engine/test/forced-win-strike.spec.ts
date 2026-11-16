import { readFileSync } from 'node:fs';
import { State, type Battle } from '@pkmn/sim';
import { describe, expect, test, vi } from 'vitest';
import { ForcedWinProver, PROVER_BUDGET, proveForcedWin } from '../src/endgame/prover';
import { sureStrike } from '../src/endgame/prover-strike';
import { createRootPosition, legalChoices, positionBattle } from '../src/forward-model';
import { loadSimMods } from '../src/forward/sim-mods';
import { applyForcedWin } from '../src/search/forced-win-apply';
import type { StaticRuleset } from '../src/eval-function';
import type { EvalResult, ForcedWinProof } from '../src/types';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 89 (P3, 1.2.0): the sure-strike candidate of the forced-win prover. When a move of the side knocks out the foe's last standing
 * body in every roll and moves before every damaging move the foe can click (the simulator's queue: priority after the Dex's modifiers,
 * then speed under Trick Room and the rest), and the simulator plays that turn to a win against each of those moves, the prover tries
 * it first: at the root before the ranking's three and at every inner node. The choice comes from the legal choices, not from the search's
 * list: Heat Wave with Aqua Jet in Champions VGC 2682637901 turn 6 is no row of the search's twelve. The scenes are the probe's of lane P
 * (`lanes/P/out/fix2-9.json`); the sweep over every Dex move with positive priority is `forced-win-strike-sweep.spec.ts`.
 */
await loadSimMods('gen9championsdoublescustomgame');

interface Scene { serialized: string; side: 'p1' | 'p2'; rootOrder: string[]; tera: boolean; sleepClause: boolean; ruleset?: StaticRuleset }
const scene = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf-8')) as Scene;
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
  // on 98 of the 100. Inside the shared budget the strike left 65 and the proof fell to 2/3; on cells of its own, given back, the ranking's
  // candidates meet the budget of before (stage P2 read 1 in 5 turns; the strike's partial proof is the 0.963 of a longer line).
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

  test('Champions VGC 2628166702 turn 7 (Umbreon\'s Leftovers) and #145\'s scene stay without a proof', () => {
    expect(proofOf(scene('forced-win-delay/champions-vgc-2628166702-t7')).mass).toBe(0);
    expect(proofOf(scene('forced-win-delay/champions-vgc-2694505370-t10')).mass).toBe(0);
  });
});

const SINGLES = 'gen9customgame';
const DOUBLES = 'gen9doublescustomgame';
const serialize = (battle: Battle): string => JSON.stringify(State.serializeBattle(battle));
const fall = (battle: Battle, index: number): void => {
  const body = battle.sides[1].pokemon[index];
  body.hp = 0;
  body.fainted = true;
  body.faint();
  battle.sides[1].pokemonLeft--;
  battle.sides[1].faintedThisTurn = null;
};
const oneHp = (battle: Battle): void => void (battle.sides[1].active[0]!.hp = 1);
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

  // the strike joins the candidates of before and takes none of their places: with the strike among the engine's own options and named first in
  // the root's list, the first draft of the order read it twice and the ranking's third candidate fell out (the proving one in three corpus rows)
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

describe('doubles: the strike only takes the foe\'s last standing body (decision D2 a)', () => {
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
