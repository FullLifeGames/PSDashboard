import type { Battle } from '@pkmn/sim';
import { sideIndex } from '@fulllifegames/replay-core';
import { createMatchupCache, type MatchupCache, type StaticRuleset } from '../eval-function.ts';
import { createRootPosition, legalChoices, positionBattle, type ChoiceOption, type SimPosition } from '../forward-model.ts';
import { isCombined } from '../search/hints.ts';
import { leafValue } from '../search/leaf.ts';
import { searchOptions } from '../search/options.ts';
import { MIN_FORCED_MASS, type ForcedWinCaveat, type ForcedWinProof, type TeraAllowance } from '../types.ts';
import { endgameChildren, type EndgameChildren } from './children.ts';
import { delayMass, readDelay } from './delay-rule.ts';
import { endgameKey } from './key.ts';
import { helpedSources } from './prover-helping.ts';
import { firstMoveId, openFields, orderByOdds, dominates, orderByRanking, other, wonBy, type Cell, type CellProof, type Proven, type Side } from './prover-order.ts';
import { cachedStrike, strikeNames } from './prover-strike.ts';

export { dominates } from './prover-order.ts';

/** The forced-win prover: an AND/OR proof search; design in EVALUATION.md "The forced-win prover" and ADR 0020. */

export interface ProverBudget {
  states: number;
  /** Matrix cells drawn per position. */
  cells: number;
  depth: number;
}
export const PROVER_BUDGET: ProverBudget = { states: 200, cells: 100, depth: 12 };
// Forced draws per class cell, retries included; a class beyond the cap stays open and its share leaves the mass.
const PROVER_DRAW_BUDGET = 6;
const PROVER_INNER_DRAW_BUDGET = 3;
const ROOT_CANDIDATES = 3;
const INNER_CANDIDATES = 2;

export interface ProveRequest {
  side: 'p1' | 'p2';
  /** Root candidates best first (choice ids from the ranking); empty means odds order. */
  rootOrder: string[];
  tera?: TeraAllowance;
  sleepClause?: boolean;
  ruleset?: StaticRuleset;
  budget?: Partial<ProverBudget>;
  spent?: { states: number; cells: number };
}

interface Memo extends Proven { remaining: number }
export interface ProofPlan { own: ChoiceOption; reply: ChoiceOption }
interface ReplyProof { proven: Proven; cells: CellProof[]; plan?: ProofPlan; choice?: string }
/** The defaults are the production path. */
export interface ProverExtras { floor?: number; plan?: boolean }
interface ProverOptions { tera?: TeraAllowance; sleepClause?: boolean; ruleset?: StaticRuleset }

const NONE: Proven = { mass: 0, turns: 0, caveat: 'none' };
const CAVEAT_RANK: Record<ForcedWinCaveat, number> = { none: 0, 'barring-crit': 1, 'sampled-rolls': 2 };
const worse = (a: ForcedWinCaveat, b: ForcedWinCaveat): ForcedWinCaveat => (CAVEAT_RANK[b] > CAVEAT_RANK[a] ? b : a);

function critable(battle: Battle, choice: string): boolean {
  const id = firstMoveId(choice);
  if (!id) return false;
  const move = battle.dex.moves.get(id);
  return move.exists && move.basePower > 0;
}

const sampled = (root: Battle, cell: Cell): boolean => cell.plain && (root.gameType !== 'singles' || cell.spread);

export class ForcedWinProver {
  /** Swapped for a fresh map during a lazy pass: a lazy mass must never answer the full pass. */
  private memo = new Map<string, Memo>();
  private lazy = false;
  private readonly cellCache = new Map<string, EndgameChildren>();
  private readonly inProgress = new Set<string>();
  private readonly strikes = new WeakMap<SimPosition, ChoiceOption | null>();
  private readonly cache: MatchupCache;
  private readonly side: Side;
  private readonly opts: ProverOptions;
  private budget: ProverBudget;
  private readonly floor: number;
  private readonly planned: boolean;
  readonly plans = new Map<string, ProofPlan>();
  /** A states or cells cap cut a branch; a depth cut is the turns asked and does not count. */
  capped = false;
  states: number;
  cells: number;

  constructor(side: Side, opts: ProverOptions, budget: ProverBudget, spent: { states: number; cells: number }, extras: ProverExtras = {}) {
    this.side = side;
    this.opts = opts;
    this.cache = createMatchupCache(opts.ruleset);
    this.budget = budget;
    this.states = spent.states;
    this.cells = spent.cells;
    this.floor = extras.floor ?? MIN_FORCED_MASS;
    this.planned = extras.plan ?? false;
  }

  prove(position: SimPosition, ply: number): Proven {
    const battle = positionBattle(position);
    if (battle.ended) return wonBy(battle, this.side) ? { mass: 1, turns: 0, caveat: 'none' } : NONE;
    const key = endgameKey(battle);
    const hit = this.memo.get(key);
    if (hit && (hit.mass >= 1 || hit.remaining >= this.budget.depth - ply)) return hit;
    if (this.inProgress.has(key) || ply >= this.budget.depth) return NONE;
    if (this.states >= this.budget.states) {
      this.capped = true;
      return NONE;
    }
    this.states += 1;
    this.inProgress.add(key);
    const { proven, plan } = this.expand(position, ply, null);
    this.inProgress.delete(key);
    this.memo.set(key, { ...proven, remaining: this.budget.depth - ply });
    if (plan && proven.mass > 0) this.plans.set(key, plan);
    return proven;
  }

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

  private strikeFor(position: SimPosition, own: ChoiceOption[]): ChoiceOption | null {
    return cachedStrike(this.strikes, position, this.side, own, this.opts.tera);
  }

  private candidatesOf(position: SimPosition, own: ChoiceOption[], order: (options: ChoiceOption[]) => ChoiceOption[], limit: number): ChoiceOption[] {
    const strike = this.strikeFor(position, own);
    const today = order(strike ? own.filter(option => option.choice !== strike.choice) : own).slice(0, limit);
    return strike ? [strike, ...today] : today;
  }

  rootCandidates(root: SimPosition, rootOrder: string[]): string[] {
    const own = searchOptions(root, this.side, this.opts);
    const order = (options: ChoiceOption[]) => (rootOrder.length > 0 ? orderByRanking(options, rootOrder) : orderByOdds(positionBattle(root), this.side, options));
    return this.candidatesOf(root, own, order, ROOT_CANDIDATES).map(candidate => candidate.choice);
  }

  // Replies are every legal choice of the simulator, never the tree's doubles combo list: that list is a search budget,
  // not a refutation. A single slot keeps the engine's list, without field moves that fail into a standing condition.
  expand(position: SimPosition, ply: number, rootOrder: string[] | null): ReplyProof {
    const battle = positionBattle(position);
    const own = searchOptions(position, this.side, this.opts);
    const replies = this.replyChoices(position);
    if (own.length === 0 || replies.length === 0) return { proven: NONE, cells: [] };
    const order = (options: ChoiceOption[]) => (rootOrder && rootOrder.length > 0 ? orderByRanking(options, rootOrder) : orderByOdds(battle, this.side, options));
    const candidates = this.candidatesOf(position, own, order, rootOrder ? ROOT_CANDIDATES : INNER_CANDIDATES);
    if (rootOrder) return this.rootLoop(position, ply, candidates, replies);
    let best: ReplyProof = { proven: NONE, cells: [] };
    for (const candidate of candidates) {
      const attempt = this.replies(position, candidate.choice, replies, ply);
      if (attempt.proven.mass > best.proven.mass) best = this.planned ? { ...attempt, plan: this.planOf(candidate, attempt) } : attempt;
      if (best.proven.mass >= 1) break;
    }
    return best;
  }

  /** The reply of an AND node's proof with the minimum mass (the first in the node's order on a tie). */
  private planOf(own: ChoiceOption, attempt: ReplyProof): ProofPlan | undefined {
    const worst = attempt.cells.reduce<CellProof | null>((low, proof) => (!low || proof.proven.mass < low.proven.mass ? proof : low), null);
    return worst ? { own, reply: worst.cell.reply } : undefined;
  }

  candidateProof(position: SimPosition, own: ChoiceOption): ReplyProof {
    const proof = this.pass(position, own.choice, this.replyChoices(position), 0, false);
    return this.planned ? { ...proof, plan: this.planOf(own, proof) } : proof;
  }

  planAt(position: SimPosition, ply: number): { proven: Proven; plan: ProofPlan | null } {
    const proven = this.prove(position, ply);
    return { proven, plan: this.plans.get(endgameKey(positionBattle(position))) ?? null };
  }

  private replyChoices(position: SimPosition): ChoiceOption[] {
    const legal = legalChoices(position, other(this.side), { tera: this.opts.tera });
    return isCombined(legal) ? legal : searchOptions(position, other(this.side), this.opts);
  }

  // Lazy pass first, full proof only for a candidate that clears MIN_FORCED_MASS (ADR 0020).
  private rootLoop(position: SimPosition, ply: number, candidates: ChoiceOption[], replies: ChoiceOption[]): ReplyProof {
    let best: ReplyProof = { proven: NONE, cells: [] };
    let passed = false;
    for (const candidate of candidates) {
      const { lazy, attempt } = this.passes(position, candidate, replies, ply);
      if (lazy.proven.mass < this.floor) continue;
      passed = true;
      const better = attempt.proven.mass > lazy.proven.mass ? attempt : lazy;
      if (better.proven.mass > best.proven.mass) best = { ...better, choice: candidate.choice };
      if (best.proven.mass >= 1) return best;
    }
    if (passed) return best;
    for (const candidate of candidates) {
      const attempt = this.replies(position, candidate.choice, replies, ply);
      if (attempt.proven.mass > best.proven.mass) best = { ...attempt, choice: candidate.choice };
      if (best.proven.mass >= 1) break;
    }
    return best;
  }

  // The sure strike runs on cells of its own, given back unless it ends the root: the candidates meet the full budget.
  private passes(position: SimPosition, candidate: ChoiceOption, replies: ChoiceOption[], ply: number): { lazy: ReplyProof; attempt: ReplyProof } {
    const strike = this.strikes.get(position)?.choice === candidate.choice;
    const [before, budget] = [this.cells, this.budget];
    if (strike) this.budget = { ...budget, cells: before + budget.cells };
    try {
      const lazy = this.pass(position, candidate.choice, replies, ply, true);
      const attempt = lazy.proven.mass >= this.floor && lazy.proven.mass < 1 ? this.pass(position, candidate.choice, replies, ply, false) : lazy;
      if (strike && Math.max(lazy.proven.mass, attempt.proven.mass) < 1) this.cells = before;
      return { lazy, attempt };
    } finally {
      this.budget = budget;
    }
  }

  private pass(position: SimPosition, ownChoice: string, replies: ChoiceOption[], ply: number, lazy: boolean): ReplyProof {
    if (!lazy) return this.replies(position, ownChoice, replies, ply);
    const fullMemo = this.memo;
    this.memo = new Map();
    this.lazy = true;
    try {
      return this.replies(position, ownChoice, replies, ply);
    } finally {
      this.lazy = false;
      this.memo = fullMemo;
    }
  }

  candidateMass(position: SimPosition, ownChoice: string, lazy: boolean): Proven {
    return this.pass(position, ownChoice, this.replyChoices(position), 0, lazy).proven;
  }

  private replies(position: SimPosition, ownChoice: string, replies: ChoiceOption[], ply: number): ReplyProof {
    const battle = positionBattle(position);
    if (this.cells + replies.length > this.budget.cells) {
      this.capped = true;
      return { proven: NONE, cells: [] };
    }
    const cells: Cell[] = replies.map(reply => {
      const [p1Choice, p2Choice] = this.pair(ownChoice, reply.choice);
      return { reply, p1Choice, p2Choice, ...this.cellsFor(position, p1Choice, p2Choice, ply) };
    });
    cells.sort((a, b) => this.ownStatic(a) - this.ownStatic(b));
    const proofs: CellProof[] = [];
    let mass = 1;
    let turns = 0;
    let caveat: ForcedWinCaveat = 'none';
    let delay: string | undefined;
    for (const cell of cells) {
      const proof = this.cell(battle, cell, ply);
      proofs.push(proof);
      mass = Math.min(mass, proof.proven.mass);
      if (mass < this.floor || mass <= 0) return { proven: NONE, cells: proofs };
      turns = Math.max(turns, proof.proven.turns);
      caveat = worse(caveat, proof.proven.caveat);
      delay ??= proof.proven.delay;
    }
    return { proven: { mass, turns, caveat, ...(delay ? { delay } : {}) }, cells: proofs };
  }

  private ownStatic(cell: Cell): number {
    const sign = this.side === 'p1' ? 1 : -1;
    return sign * cell.children.reduce((sum, child) => sum + child.share * leafValue(positionBattle(child.position), this.cache), 0);
  }

  private cell(root: Battle, cell: Cell, ply: number): CellProof {
    // A repeated stall that leaves the board as it was is a delay (`delay-rule.ts`): priced by the other children.
    const read = readDelay(root, this.side, cell);
    // A plain cell whose draws disagree on a knock-out has no class to prove per.
    if (cell.unpriced && cell.plain && !read) return { cell, proofs: [], proven: NONE };
    const view: Cell = read?.split ? { ...cell, children: read.children } : cell;
    const sources = read?.split ? view.children.map(() => -1) : helpedSources(cell, this.side);
    // A turned child that ended costs no cell and no state, so the lazy pass reads it.
    const proofs: Proven[] = view.children.map((child, index) => (!read?.delays[index] && sources[index] < 0 && !(this.lazy && child.turned && !child.ended) ? this.prove(child.position, ply + 1) : NONE));
    sources.forEach((source, index) => { if (source >= 0) proofs[index] = proofs[source]; });
    let mass = 0;
    let turns = 0;
    let delayShare = 0;
    let delay: string | undefined;
    let caveat: ForcedWinCaveat = sampled(root, cell) ? 'sampled-rolls' : this.survivedHit(root, view, proofs) ? 'barring-crit' : 'none';
    const credit = (share: number, proof: Proven) => {
      mass += share * proof.mass;
      if (proof.mass > 0) {
        turns = Math.max(turns, proof.turns);
        caveat = worse(caveat, proof.caveat);
        delay ??= proof.delay;
      }
    };
    proofs.forEach((proof, index) => (read?.delays[index] ? (delayShare += view.children[index].share) : credit(view.children[index].share, proof)));
    for (const gap of view.missing) {
      const index = view.children.findIndex(child => child.key !== undefined && dominates(child.key, gap.key, view.events, this.side));
      if (index >= 0) credit(gap.share, proofs[index]);
    }
    if (read) {
      mass = delayMass(mass, delayShare);
      if (mass > 0) delay = read.move;
      // The delay children read as the cell itself (the parent with a weaker stall): the bar's open share is 1 - mass.
      read.delays.forEach((isDelay, index) => { if (isDelay) proofs[index] = { mass, turns, caveat }; });
    }
    return { cell: view, proofs, proven: { mass, turns: turns + 1, caveat, ...(delay ? { delay } : {}) } };
  }

  /** A defender hit by a critable move and still standing in a PROVEN child: the class plan never priced the crit. */
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

/** Proves a forced win for the side from a serialized battle or a root position the caller already holds. */
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
  const { proven, cells, choice } = prover.expand(root, 0, candidates);
  const fields = openFields(battle, request.side, cells, createMatchupCache(request.ruleset));
  const outside = choice !== undefined && proven.mass > 0
    && !searchOptions(root, request.side, { tera: request.tera, sleepClause: request.sleepClause }).some(option => option.choice === choice);
  const choiceNames = outside && choice ? strikeNames(root, request.side, choice, request.tera) : undefined;
  const delayName = proven.delay ? battle.dex.moves.get(proven.delay).name : undefined;
  return { ...proven, ...fields, ...(outside ? { choice } : {}), ...(delayName ? { delayName } : {}), ...(choiceNames ? { choiceNames } : {}), states: prover.states, cells: prover.cells };
}
