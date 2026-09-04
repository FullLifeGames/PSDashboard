import type { Battle } from '@pkmn/sim';
import { createMatchupCache, type MatchupCache } from '../eval-function.ts';
import { createRootPosition, positionBattle, type SimPosition } from '../forward-model.ts';
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
 * for the estimators, never a production path.
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

const MAX_BODIES = 3;
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
  private readonly cache: MatchupCache = createMatchupCache();
  private readonly start = Date.now();
  private readonly caps: EndgameCaps;
  readonly flags = new Set<EndgameFlag>();
  states = 0;
  depth = 0;

  constructor(caps: EndgameCaps) {
    this.caps = caps;
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
    const p1Options = searchOptions(position, 'p1', { tera: false });
    const p2Options = searchOptions(position, 'p2', { tera: false });
    if (p1Options.length === 0 || p2Options.length === 0) return this.standIn(positionBattle(position), 'capped');
    const cells = p1Options.map(p1 => p2Options.map(p2 => this.cell(position, p1.choice, p2.choice, ply)));
    const solution = solveMatrixGame(cells.map(row => row.map(cell => cell.value)));
    const i = argmax(solution.p1Mix);
    const j = argmax(solution.p2Mix);
    const pv = [`${p1Options[i].label} / ${p2Options[j].label}`, ...cells[i][j].pv].slice(0, PV_LIMIT);
    return { value: solution.value, exact: cells.every(row => row.every(cell => cell.exact)), pv };
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

export function solveEndgame(serializedBattle: string, caps: Partial<EndgameCaps> = {}): EndgameResult {
  const root = createRootPosition(serializedBattle);
  if (!endgameScope(positionBattle(root))) {
    return { scope: false, value: 0, exact: false, flags: [], states: 0, depth: 0, pv: [] };
  }
  const solver = new EndgameSolver({ ...ENDGAME_CAPS, ...caps });
  const solved = solver.solve(root, 0);
  return {
    scope: true, value: solved.value, exact: solver.flags.size === 0, flags: [...solver.flags],
    states: solver.states, depth: solver.depth, pv: solved.pv,
  };
}
