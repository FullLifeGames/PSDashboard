import type { Battle } from '@pkmn/sim';
import { ENDGAME_MAX_BODIES, type TeraAllowance } from '../types.ts';
import { createMatchupCache, type MatchupCache, type StaticRuleset } from '../eval-function.ts';
import { createRootPosition, positionBattle, type ChoiceOption, type SimPosition } from '../forward-model.ts';
import { solveMatrixGame } from '../ranking/solve.ts';
import { livingMons } from '../score/threat.ts';
import { leafValue } from '../search/leaf.ts';
import { searchOptions } from '../search/options.ts';
import { endgameChildren } from './children.ts';
import { endgameKey } from './key.ts';

/**
 * The endgame solver (round 34): the exact value of a small endgame (at
 * most three living bodies) under best play by both sides. Every state is
 * a turn boundary; its value is the equilibrium of the choice-pair matrix
 * over the children's values, recursively to the game's end, memoized on
 * the endgame key. Chance is priced per cell (children.ts). Three caps
 * keep it finite (turns from the root, states, wall clock); at a cap the
 * search's leaf value stands in and the result is flagged. Ground truth
 * for the estimators. Round 89 (#130, D2): `oneTurnMatrix` is also a
 * production path, the engine's first choice at a position of a win-path
 * search (endgame/win-paths/first-choice.ts); `solveEndgame` stays as it was.
 */
export interface EndgameCaps { turns: number; states: number; wallMs: number }
export const ENDGAME_CAPS: EndgameCaps = { turns: 30, states: 20000, wallMs: 120000 };
export type EndgameFlag = 'capped' | 'unpriced' | 'loop';
export interface EndgameResult {
  /** False when the position has more than three living bodies; nothing else is filled then. */
  scope: boolean;
  /** p1 perspective, win-prob units (-1 to 1). */
  value: number;
  /** No cap, no unpriced chance, and no loop touched anywhere in the solve. */
  exact: boolean;
  flags: EndgameFlag[];
  /** States expanded (memo hits and terminals excluded). */
  states: number;
  /** The deepest ply expanded. */
  depth: number;
  /** The principal variation as choice-pair labels, the heaviest child at each step. */
  pv: string[];
}

const MAX_BODIES = ENDGAME_MAX_BODIES;
const PV_LIMIT = 12;

export function endgameScope(battle: Battle): boolean {
  return livingMons(battle, 0).length + livingMons(battle, 1).length <= MAX_BODIES;
}

interface Solved { value: number; exact: boolean; pv: string[] }
interface Memo extends Solved { remaining: number }

const argmax = (mix: number[]): number => mix.reduce((best, weight, index) => (weight > mix[best] ? index : best), 0);

class EndgameSolver {
  private readonly memo = new Map<string, Memo>();
  private readonly inProgress = new Set<string>();
  private readonly cache: MatchupCache;
  private readonly start = Date.now();
  private readonly caps: EndgameCaps;
  readonly flags = new Set<EndgameFlag>();
  states = 0;
  depth = 0;

  private readonly options: { tera: TeraAllowance; sleepClause?: boolean };

  constructor(caps: EndgameCaps, ruleset: StaticRuleset, options: { tera?: TeraAllowance; sleepClause?: boolean } = {}) {
    this.caps = caps;
    this.cache = createMatchupCache(ruleset);
    this.options = { tera: options.tera ?? false, ...(options.sleepClause === undefined ? {} : { sleepClause: options.sleepClause }) };
  }

  solve(position: SimPosition, ply: number): Solved {
    const battle = positionBattle(position);
    if (battle.ended) return { value: leafValue(battle, this.cache), exact: true, pv: [] };
    const key = endgameKey(battle);
    const hit = this.memo.get(key);
    if (hit && (hit.exact || hit.remaining >= this.caps.turns - ply)) return hit;
    if (this.inProgress.has(key)) return this.standIn(battle, 'loop');
    if (this.atCap(ply)) return this.standIn(battle, 'capped');
    this.states += 1;
    this.depth = Math.max(this.depth, ply);
    this.inProgress.add(key);
    const solved = this.expand(position, ply);
    this.inProgress.delete(key);
    this.memo.set(key, { ...solved, remaining: this.caps.turns - ply });
    return solved;
  }

  private atCap(ply: number): boolean {
    return ply >= this.caps.turns || this.states >= this.caps.states || Date.now() - this.start >= this.caps.wallMs;
  }

  /** The search's leaf stands in where the solver stops; the flag says why. */
  private standIn(battle: Battle, flag: EndgameFlag): Solved {
    this.flags.add(flag);
    return { value: leafValue(battle, this.cache), exact: false, pv: [] };
  }

  private expand(position: SimPosition, ply: number): Solved {
    const p1Options = searchOptions(position, 'p1', this.options);
    const p2Options = searchOptions(position, 'p2', this.options);
    if (p1Options.length === 0 || p2Options.length === 0) return this.standIn(positionBattle(position), 'capped');
    const cells = p1Options.map(p1 => p2Options.map(p2 => this.cell(position, p1.choice, p2.choice, ply)));
    const solution = solveMatrixGame(cells.map(row => row.map(cell => cell.value)));
    const i = argmax(solution.p1Mix);
    const j = argmax(solution.p2Mix);
    const pv = [`${p1Options[i].label} / ${p2Options[j].label}`, ...cells[i][j].pv].slice(0, PV_LIMIT);
    return { value: solution.value, exact: cells.every(row => row.every(cell => cell.exact)), pv };
  }

  /** The one-turn matrix of a position: every option pair played once, each child at its static value (see `oneTurnMatrix`). */
  oneTurn(position: SimPosition): OneTurnMatrix | null {
    const p1 = searchOptions(position, 'p1', this.options);
    const p2 = searchOptions(position, 'p2', this.options);
    if (positionBattle(position).ended || p1.length === 0 || p2.length === 0) return null;
    const cells = p1.map(first => p2.map(second => this.cell(position, first.choice, second.choice, 0)));
    const solution = solveMatrixGame(cells.map(row => row.map(cell => cell.value)));
    this.states += 1;
    return { p1, p2, values: cells.map(row => row.map(cell => cell.value)), p1Mix: solution.p1Mix, p2Mix: solution.p2Mix, value: solution.value, cells: p1.length * p2.length, unpriced: this.flags.has('unpriced') };
  }

  private cell(position: SimPosition, p1Choice: string, p2Choice: string, ply: number): Solved {
    const { children, unpriced } = endgameChildren(position, p1Choice, p2Choice);
    if (unpriced) this.flags.add('unpriced');
    let value = 0;
    let exact = !unpriced;
    let heaviest = { weight: -1, pv: [] as string[] };
    for (const child of children) {
      const solved = this.solve(child.position, ply + 1);
      value += child.weight * solved.value;
      exact &&= solved.exact;
      if (child.weight > heaviest.weight) heaviest = { weight: child.weight, pv: solved.pv };
    }
    return { value, exact, pv: heaviest.pv };
  }
}

/**
 * Round 89 (#130, D1): the one-turn matrix of a position, the engine's first choice past a search's root. Both sides' options are
 * the search's own (`searchOptions`), every pair is played once with its chance priced as the prover's cells price it, and every
 * child stands at its static value (the solver at one turn: every state below is a stand-in at its leaf). `values` is the p1
 * perspective (win-probability units, -1 to 1); the mixes are the equilibrium of the matrix. Null when the game is over or a side
 * has no option. `cells` is the number of pairs played, the caller's work counter.
 */
export interface OneTurnMatrix {
  p1: ChoiceOption[];
  p2: ChoiceOption[];
  values: number[][];
  p1Mix: number[];
  p2Mix: number[];
  value: number;
  cells: number;
  /** A cell of the matrix has a chance the class plan could not price (the value is the median draw's there). */
  unpriced: boolean;
}

export function oneTurnMatrix(
  position: SimPosition, options: { tera?: TeraAllowance; sleepClause?: boolean; ruleset?: StaticRuleset } = {},
): OneTurnMatrix | null {
  return new EndgameSolver({ ...ENDGAME_CAPS, turns: 1 }, options.ruleset ?? position.ruleset ?? 'standard', options).oneTurn(position);
}

/**
 * Round 65: `ruleset` names the weight table of the solver's statics
 * (EvalSettings.ruleset). Round 67 (T139): every caller names it (the
 * endgame bench passes each position's own); unset reads as 'standard'.
 */
export function solveEndgame(serializedBattle: string, caps: Partial<EndgameCaps> | undefined, ruleset: StaticRuleset | undefined): EndgameResult {
  const root = createRootPosition(serializedBattle, ruleset ?? 'standard');
  if (!endgameScope(positionBattle(root))) {
    return { scope: false, value: 0, exact: false, flags: [], states: 0, depth: 0, pv: [] };
  }
  const solver = new EndgameSolver({ ...ENDGAME_CAPS, ...caps }, ruleset ?? 'standard');
  const solved = solver.solve(root, 0);
  return {
    scope: true, value: solved.value, exact: solver.flags.size === 0, flags: [...solver.flags],
    states: solver.states, depth: solver.depth, pv: solved.pv,
  };
}
