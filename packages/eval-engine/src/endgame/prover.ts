import type { Battle } from '@pkmn/sim';
import { sideIndex } from '@fulllifegames/replay-core';
import type { CellEvent } from '../cell-blend.ts';
import { createMatchupCache, type MatchupCache, type StaticRuleset } from '../eval-function.ts';
import { createRootPosition, legalChoices, positionBattle, type ChoiceOption, type SimPosition } from '../forward-model.ts';
import { isCombined } from '../search/hints.ts';
import { leafValue } from '../search/leaf.ts';
import { searchOptions } from '../search/options.ts';
import { MIN_FORCED_MASS, type ForcedWinCaveat, type ForcedWinProof, type TeraAllowance } from '../types.ts';
import { endgameChildren, type EndgameChildren } from './children.ts';
import { endgameKey } from './key.ts';
import { helpedSources, splitClassKey } from './prover-helping.ts';
import { firstMoveId, openFields, orderByOdds, orderByRanking, other, type Cell, type CellProof, type Proven, type Side } from './prover-order.ts';

/**
 * The forced-win prover (round 35): an AND/OR proof search from the root.
 * An own move (OR) proves when EVERY reply (AND) still proves, down to a
 * battle the side has won; every reply is every legal choice, never the
 * doubles cut of the tree (round 64). Chance is priced per cell as the endgame
 * solver's outcome classes; a proof holds per class, and the result is
 * the proven MASS (the analytic share of the classes proven along every
 * reply), a lower bound on the win probability under the class model.
 * Crits sit outside the model (caveat 'barring-crit'); plain-path cells
 * (doubles, guards) prove over the sampled rolls only. A cells cap (matrix
 * cells drawn, the cost that scales with the reply count) and a states cap
 * keep it cheap and deterministic; no wall clock.
 *
 * The root tries the ranking's first three own candidates (the odds order
 * when no ranking is given) with the full budget, singles and doubles alike.
 * Round 89 (A5f-7) dropped the greedy scout that once gated them: it followed
 * one reply per turn under a 16-cell allowance shared by the three candidates,
 * which a doubles root with 6 to 16 replies spends in about one turn, and it
 * missed 8 to 20 % of the doubles proofs the full proof finds (A5f-6).
 */
export interface ProverBudget {
  states: number;
  /** Matrix cells drawn per position. */
  cells: number;
  depth: number;
}
export const PROVER_BUDGET: ProverBudget = { states: 200, cells: 100, depth: 12 };
/**
 * Forced draws per class cell (round 43): a class the five base seeds
 * never showed is drawn on demand; the cap bounds those draws, retries
 * included. Root cells may take six, inner cells three, so a cell with a
 * tie and three classes still closes; a class beyond the cap stays OPEN
 * (its share leaves the mass).
 */
const PROVER_DRAW_BUDGET = 6;
const PROVER_INNER_DRAW_BUDGET = 3;
/** Own candidates tried at the root (ranking order) and at inner nodes (odds order). */
const ROOT_CANDIDATES = 3;
const INNER_CANDIDATES = 2;

export interface ProveRequest {
  side: 'p1' | 'p2';
  /** Root candidates best first (choice ids from the ranking); empty = odds order. */
  rootOrder: string[];
  tera?: TeraAllowance;
  sleepClause?: boolean;
  /** Round 65: the rule set whose weight table the prover's statics read. */
  ruleset?: StaticRuleset;
  budget?: Partial<ProverBudget>;
  /** States and cells already spent by an earlier attempt on this position. */
  spent?: { states: number; cells: number };
}

interface Memo extends Proven { remaining: number }
interface ReplyProof { proven: Proven; cells: CellProof[] }
interface ProverOptions { tera?: TeraAllowance; sleepClause?: boolean; ruleset?: StaticRuleset }

const NONE: Proven = { mass: 0, turns: 0, caveat: 'none' };
const CAVEAT_RANK: Record<ForcedWinCaveat, number> = { none: 0, 'barring-crit': 1, 'sampled-rolls': 2 };
const worse = (a: ForcedWinCaveat, b: ForcedWinCaveat): ForcedWinCaveat => (CAVEAT_RANK[b] > CAVEAT_RANK[a] ? b : a);

/** A move whose damage can crit: base power, not fixed damage or OHKO. */
function critable(battle: Battle, choice: string): boolean {
  const id = firstMoveId(choice);
  if (!id) return false;
  const move = battle.dex.moves.get(id);
  return move.exists && move.basePower > 0;
}

/**
 * A cell proven over sampled rolls only: every doubles cell (no class plan
 * prices a doubles turn), and a singles plain cell whose draws disagreed.
 * A singles plain cell whose three draws agree (fixed damage, status) has
 * no roll to name.
 */
const sampled = (root: Battle, cell: Cell): boolean => cell.plain && (root.gameType !== 'singles' || cell.spread);

/**
 * Whether a drawn class is at least as bad for the side as a class no draw
 * showed, so the drawn class's proof carries over: the same turn order and
 * the same outcomes except one event, where the opponent's move MISSED
 * (never better for them than the hit the draws showed) or the side's own
 * move KNOCKED OUT (never worse for the side than the survived hit). A
 * class model leaks mass on rare outcomes otherwise: a 90% Toxic whose
 * three draws all hit left ten percent of a certain win unproven.
 *
 * Round 88 (T336): a class in which a secondary that only helps the mover fired is a third case, and it is decided by the
 * positions the cell drew, not by the keys (prover-helping.ts: helpedSources). A class the draws never showed (the forced-draw cap
 * reached, or a secondary class under MIN_CLASS_MASS) keeps the two cases above, because no position says what its effect did.
 */
export function dominates(drawnKey: string, missingKey: string, events: CellEvent[], side: Side): boolean {
  const [drawnClass, missingClass] = [splitClassKey(drawnKey), splitClassKey(missingKey)];
  if (!drawnClass || !missingClass || drawnClass.order !== missingClass.order) return false;
  const [drawn, missing] = [drawnClass.outcomes, missingClass.outcomes];
  if (drawn.length !== missing.length || drawn.length !== events.length) return false;
  let differing = -1;
  for (let index = 0; index < drawn.length; index++) {
    if (drawn[index] === missing[index]) continue;
    if (differing >= 0) return false;
    differing = index;
  }
  if (differing < 0) return false;
  const event = events[differing];
  if (event.side !== side) return missing[differing] === 'miss' && drawn[differing].startsWith('hit');
  return missing[differing] === 'hit-kill' && drawn[differing] === 'hit-nokill';
}

/** Won by the side: battle.winner is the player's name ('' on a tie). */
const wonBy = (battle: Battle, side: Side): boolean => battle.ended && battle.winner === battle.sides[sideIndex(side)].name;

/** Round 89 (A6-2): the specs ask one root candidate by itself (`expand(root, 0, [own])`), the way a repeated-Protect scene reads its proving move. */
export class ForcedWinProver {
  private readonly memo = new Map<string, Memo>();
  /** Cells drawn once per (position, pair): a position the proof reaches twice draws its cell once. */
  private readonly cellCache = new Map<string, EndgameChildren>();
  private readonly inProgress = new Set<string>();
  private readonly cache: MatchupCache;
  private readonly side: Side;
  private readonly opts: ProverOptions;
  private readonly budget: ProverBudget;
  states: number;
  cells: number;

  constructor(side: Side, opts: ProverOptions, budget: ProverBudget, spent: { states: number; cells: number }) {
    this.side = side;
    this.opts = opts;
    this.cache = createMatchupCache(opts.ruleset);
    this.budget = budget;
    this.states = spent.states;
    this.cells = spent.cells;
  }

  prove(position: SimPosition, ply: number): Proven {
    const battle = positionBattle(position);
    if (battle.ended) return wonBy(battle, this.side) ? { mass: 1, turns: 0, caveat: 'none' } : NONE;
    const key = endgameKey(battle);
    const hit = this.memo.get(key);
    if (hit && (hit.mass >= 1 || hit.remaining >= this.budget.depth - ply)) return hit;
    if (this.inProgress.has(key) || ply >= this.budget.depth || this.states >= this.budget.states) return NONE;
    this.states += 1;
    this.inProgress.add(key);
    const { proven } = this.expand(position, ply, null);
    this.inProgress.delete(key);
    this.memo.set(key, { ...proven, remaining: this.budget.depth - ply });
    return proven;
  }

  /** The children of one cell, drawn once per proof run and counted once; root cells may force six draws, inner cells three. */
  private cellsFor(position: SimPosition, p1Choice: string, p2Choice: string, ply: number): EndgameChildren {
    const drawBudget = ply === 0 ? PROVER_DRAW_BUDGET : PROVER_INNER_DRAW_BUDGET;
    const key = `${endgameKey(positionBattle(position))}|${p1Choice}|${p2Choice}|${drawBudget}`;
    const hit = this.cellCache.get(key);
    if (hit) return hit;
    this.cells += 1;
    const drawn = endgameChildren(position, p1Choice, p2Choice, drawBudget);
    this.cellCache.set(key, drawn);
    return drawn;
  }

  private pair(ownChoice: string, replyChoice: string): [string, string] {
    return this.side === 'p1' ? [ownChoice, replyChoice] : [replyChoice, ownChoice];
  }

  /**
   * The root candidates the full proof tries: the ranking's order (the kill odds when no ranking is given), the first
   * ROOT_CANDIDATES. The proof proves or refutes every one of them against every legal reply; nothing gates them first.
   */
  rootCandidates(root: SimPosition, rootOrder: string[]): string[] {
    const own = searchOptions(root, this.side, this.opts);
    const ordered = rootOrder.length > 0 ? orderByRanking(own, rootOrder) : orderByOdds(positionBattle(root), this.side, own);
    return ordered.slice(0, ROOT_CANDIDATES).map(candidate => candidate.choice);
  }

  /**
   * The OR node: candidates in order until one proves with mass 1 or the
   * list ends. The own side picks from the engine's list; the replies are
   * every legal choice of the simulator (round 64, T118): the doubles combo
   * list the tree keeps (16 by static hints) is a search budget, not a
   * refutation. VGC 2630685175 turn 7 proved a win against the 12 combos
   * p2's tree kept, and Zamazenta's Protect, cut from them, escapes it. A
   * single-slot list stays the engine's (field moves that fail into a
   * standing condition dropped), so singles proofs read as before.
   */
  expand(position: SimPosition, ply: number, rootOrder: string[] | null): ReplyProof {
    const battle = positionBattle(position);
    const own = searchOptions(position, this.side, this.opts);
    const legal = legalChoices(position, other(this.side), { tera: this.opts.tera });
    const replies = isCombined(legal) ? legal : searchOptions(position, other(this.side), this.opts);
    if (own.length === 0 || replies.length === 0) return { proven: NONE, cells: [] };
    const ordered = rootOrder && rootOrder.length > 0 ? orderByRanking(own, rootOrder) : orderByOdds(battle, this.side, own);
    const candidates = ordered.slice(0, rootOrder ? ROOT_CANDIDATES : INNER_CANDIDATES);
    let best: ReplyProof = { proven: NONE, cells: [] };
    for (const candidate of candidates) {
      const attempt = this.replies(position, candidate.choice, replies, ply);
      if (attempt.proven.mass > best.proven.mass) best = attempt;
      if (best.proven.mass >= 1) break;
    }
    return best;
  }

  /** The AND node: every reply, worst static first; the running minimum stops at the first escape. */
  private replies(position: SimPosition, ownChoice: string, replies: ChoiceOption[], ply: number): ReplyProof {
    const battle = positionBattle(position);
    if (this.cells + replies.length > this.budget.cells) return { proven: NONE, cells: [] };
    const cells: Cell[] = replies.map(reply => {
      const [p1Choice, p2Choice] = this.pair(ownChoice, reply.choice);
      return { reply, p1Choice, p2Choice, ...this.cellsFor(position, p1Choice, p2Choice, ply) };
    });
    cells.sort((a, b) => this.ownStatic(a) - this.ownStatic(b));
    const proofs: CellProof[] = [];
    let mass = 1;
    let turns = 0;
    let caveat: ForcedWinCaveat = 'none';
    for (const cell of cells) {
      const proof = this.cell(battle, cell, ply);
      proofs.push(proof);
      mass = Math.min(mass, proof.proven.mass);
      if (mass < MIN_FORCED_MASS) return { proven: NONE, cells: proofs };
      turns = Math.max(turns, proof.proven.turns);
      caveat = worse(caveat, proof.proven.caveat);
    }
    return { proven: { mass, turns, caveat }, cells: proofs };
  }

  /** Share-weighted static of a cell's children from the own side. */
  private ownStatic(cell: Cell): number {
    const sign = this.side === 'p1' ? 1 : -1;
    return sign * cell.children.reduce((sum, child) => sum + child.share * leafValue(positionBattle(child.position), this.cache), 0);
  }

  private cell(root: Battle, cell: Cell, ply: number): CellProof {
    // A plain cell whose draws disagree on a knock-out has no class to
    // prove per; a class cell with a class the draws never showed keeps
    // that class open (its share never enters the mass) unless a drawn
    // class dominates it, and proves the rest.
    if (cell.unpriced && cell.plain) return { cell, proofs: [], proven: NONE };
    // Round 88 (T336, #72): a child in which a secondary that only helps this side fired takes the proof of the child in which it
    // did not (prover-helping.ts); only the sources are proven, so the positions behind the effect cost no cells.
    const sources = helpedSources(cell, this.side);
    const proofs: Proven[] = cell.children.map((child, index) => (sources[index] < 0 ? this.prove(child.position, ply + 1) : NONE));
    sources.forEach((source, index) => { if (source >= 0) proofs[index] = proofs[source]; });
    let mass = 0;
    let turns = 0;
    let caveat: ForcedWinCaveat = sampled(root, cell) ? 'sampled-rolls' : this.survivedHit(root, cell, proofs) ? 'barring-crit' : 'none';
    const credit = (share: number, proof: Proven) => {
      mass += share * proof.mass;
      if (proof.mass > 0) {
        turns = Math.max(turns, proof.turns);
        caveat = worse(caveat, proof.caveat);
      }
    };
    proofs.forEach((proof, index) => credit(cell.children[index].share, proof));
    for (const gap of cell.missing) {
      const index = cell.children.findIndex(child => child.key !== undefined && dominates(child.key, gap.key, cell.events, this.side));
      if (index >= 0) credit(gap.share, proofs[index]);
    }
    return { cell, proofs, proven: { mass, turns: turns + 1, caveat } };
  }

  /** A defender hit by a critable move and still standing in a PROVEN child: the class plan never priced a crit there. */
  private survivedHit(root: Battle, cell: Cell, proofs: Proven[]): boolean {
    for (const side of ['p1', 'p2'] as const) {
      const choice = side === 'p1' ? cell.p1Choice : cell.p2Choice;
      if (!critable(root, choice)) continue;
      const defender = root.sides[sideIndex(other(side))].active[0];
      if (!defender) continue;
      for (const [index, child] of cell.children.entries()) {
        if (proofs[index].mass === 0) continue;
        const after = positionBattle(child.position).sides[sideIndex(other(side))].pokemon.find(mon => mon.name === defender.name);
        if (after && !after.fainted && after.hp < defender.hp) return true;
      }
    }
    return false;
  }
}

/** Proves from a serialized battle or a root position the caller already holds (no second deserialization). */
export function proveForcedWin(rootOrSerialized: string | SimPosition, request: ProveRequest): ForcedWinProof {
  const root = typeof rootOrSerialized === 'string' ? createRootPosition(rootOrSerialized, request.ruleset) : rootOrSerialized;
  const battle = positionBattle(root);
  const budget = { ...PROVER_BUDGET, ...request.budget };
  const spent = request.spent ?? { states: 0, cells: 0 };
  const prover = new ForcedWinProver(request.side, { tera: request.tera, sleepClause: request.sleepClause, ruleset: request.ruleset }, budget, spent);
  if (battle.ended || prover.states >= budget.states) return { ...NONE, openValue: null, states: prover.states, cells: prover.cells };
  const candidates = prover.rootCandidates(root, request.rootOrder);
  if (candidates.length === 0) return { ...NONE, openValue: null, states: prover.states, cells: prover.cells };
  prover.states += 1;
  const { proven, cells } = prover.expand(root, 0, candidates);
  const fields = openFields(battle, request.side, cells, createMatchupCache(request.ruleset));
  return { ...proven, ...fields, states: prover.states, cells: prover.cells };
}
