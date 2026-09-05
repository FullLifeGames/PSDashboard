import type { Battle } from '@pkmn/sim';
import { sideIndex } from '@fulllifegames/replay-core';
import { planCellEvents, type CellEvent } from '../cell-blend.ts';
import { createMatchupCache, type MatchupCache } from '../eval-function.ts';
import { createRootPosition, positionBattle, type ChoiceOption, type SimPosition } from '../forward-model.ts';
import { boundaryEvent } from '../ko-odds.ts';
import { leafValue } from '../search/leaf.ts';
import { searchOptions } from '../search/options.ts';
import { MIN_FORCED_MASS, type ForcedWinCaveat, type ForcedWinOpen, type ForcedWinProof, type TeraAllowance } from '../types.ts';
import { endgameChildren, type EndgameChildren } from './children.ts';
import { endgameKey } from './key.ts';

/**
 * The forced-win prover (round 35): an AND/OR proof search from the root.
 * An own move (OR) proves when EVERY reply (AND) still proves, down to a
 * battle the side has won. Chance is priced per cell as the endgame
 * solver's outcome classes; a proof holds per class, and the result is
 * the proven MASS (the analytic share of the classes proven along every
 * reply), a lower bound on the win probability under the class model.
 * Crits sit outside the model (caveat 'barring-crit'); plain-path cells
 * (doubles, guards) prove over the sampled rolls only. A cells cap (matrix
 * cells drawn, the cost that scales with the reply count) and a states cap
 * keep it cheap and deterministic; no wall clock.
 *
 * Finding the line is cheap, refuting every reply is not: before the tree
 * search a GREEDY PROBE follows each root candidate against the reply that
 * is worst for the side, one line, no branching, a few cells per turn. Only
 * a candidate whose line ends in a win within probeDepth turns gets the
 * full budget; a position without such a line costs the probe and nothing
 * more (the sweep's decided turns far from the end).
 */
export interface ProverBudget {
  states: number;
  /** Matrix cells drawn per position, probe included. */
  cells: number;
  depth: number;
  /** Cells the greedy probe may draw per side attempt before a full proof starts. */
  probeCells: number;
  /** Turns the greedy probe follows a line before giving up on it. */
  probeDepth: number;
}
export const PROVER_BUDGET: ProverBudget = { states: 200, cells: 100, depth: 12, probeCells: 16, probeDepth: 5 };
/**
 * Draws per class cell at the root: the base draws plus a few probes, so
 * the open class the sentence and the bar name is found. A class the draws
 * never show stays OPEN (its share leaves the mass), so inner cells take
 * the base draws only: the cost of a proof lives in its inner cells.
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
  budget?: Partial<ProverBudget>;
  /** States and cells already spent by an earlier attempt on this position. */
  spent?: { states: number; cells: number };
}

type Side = 'p1' | 'p2';
interface Proven { mass: number; turns: number; caveat: ForcedWinCaveat }
interface Memo extends Proven { remaining: number }
interface Cell extends EndgameChildren { reply: ChoiceOption; p1Choice: string; p2Choice: string }
interface CellProof { cell: Cell; proofs: Proven[]; proven: Proven }
interface ReplyProof { proven: Proven; cells: CellProof[] }
interface ProverOptions { tera?: TeraAllowance; sleepClause?: boolean }

const NONE: Proven = { mass: 0, turns: 0, caveat: 'none' };
const CAVEAT_RANK: Record<ForcedWinCaveat, number> = { none: 0, 'barring-crit': 1, 'sampled-rolls': 2 };
const worse = (a: ForcedWinCaveat, b: ForcedWinCaveat): ForcedWinCaveat => (CAVEAT_RANK[b] > CAVEAT_RANK[a] ? b : a);
const other = (side: Side): Side => (side === 'p1' ? 'p2' : 'p1');

/** The move id of a choice's first move part, or null for switches and passes. */
function firstMoveId(choice: string): string | null {
  for (const part of choice.split(',')) {
    const tokens = part.trim().split(' ');
    if (tokens[0] === 'move' && tokens[1]) return tokens[1];
  }
  return null;
}

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
 */
function dominates(drawnKey: string, missingKey: string, events: CellEvent[], side: Side): boolean {
  const [drawnOrder, drawnRest] = drawnKey.split(':');
  const [missingOrder, missingRest] = missingKey.split(':');
  if (drawnOrder !== missingOrder || drawnRest === undefined || missingRest === undefined) return false;
  const drawn = drawnRest.split('|');
  const missing = missingRest.split('|');
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

/** The opponent's living HP after a cell, the probe's measure of a stalling reply. */
const opponentHp = (battle: Battle, side: Side): number =>
  battle.sides[sideIndex(other(side))].pokemon.reduce((sum, mon) => sum + mon.hp, 0);

/** Won by the side: battle.winner is the player's name ('' on a tie). */
const wonBy = (battle: Battle, side: Side): boolean => battle.ended && battle.winner === battle.sides[sideIndex(side)].name;

/** Root: the ranking's order, unnamed options after it. */
function orderByRanking(options: ChoiceOption[], rootOrder: string[]): ChoiceOption[] {
  const rank = new Map(rootOrder.map((choice, index) => [choice, index]));
  return [...options].sort((a, b) => (rank.get(a.choice) ?? rootOrder.length) - (rank.get(b.choice) ?? rootOrder.length));
}

/** Inner nodes: kill odds first (certain kills top), then damaging moves by base power, status, switches. */
function orderByOdds(battle: Battle, side: Side, options: ChoiceOption[]): ChoiceOption[] {
  const attacker = battle.sides[sideIndex(side)].active[0];
  const defender = battle.sides[sideIndex(other(side))].active[0];
  const score = (option: ChoiceOption): number => {
    const id = firstMoveId(option.choice);
    if (!id) return 0;
    const move = battle.dex.moves.get(id);
    const event = attacker && defender && !attacker.fainted && !defender.fainted ? boundaryEvent(battle, attacker, defender, id) : null;
    if (event) return 3 + event.pKill;
    return move.exists && move.basePower > 0 ? 2 + move.basePower / 1000 : 1;
  };
  return options.map(option => ({ option, score: score(option) })).sort((a, b) => b.score - a.score).map(entry => entry.option);
}

/** The own side's open class of a cell, read from the child's group key against the cell's event plan. */
function openOf(root: Battle, cell: Cell, key: string | undefined, side: Side): ForcedWinOpen | undefined {
  const plan = planCellEvents(root, cell.p1Choice, cell.p2Choice);
  if (plan.kind !== 'events' || !key) return undefined;
  const outcomes = key.split(':')[1]?.split('|') ?? [];
  return plan.events.map((event: CellEvent, index: number) => ({ event, outcome: outcomes[index] }))
    .filter(({ event }) => event.side === side)
    .map(({ event, outcome }): ForcedWinOpen | undefined => {
      const label = root.dex.moves.get(event.moveId).name;
      if (outcome === 'miss') return { side, moveId: event.moveId, label, odds: event.event.accuracy, kind: 'hit' };
      if (outcome === 'hit-nokill') return { side, moveId: event.moveId, label, odds: event.event.killFraction, kind: 'kill' };
      return undefined;
    })
    .find(open => open !== undefined);
}

class ForcedWinProver {
  private readonly memo = new Map<string, Memo>();
  /** Cells drawn once per (position, pair): the probe's cells serve the proof. */
  private readonly cellCache = new Map<string, EndgameChildren>();
  private readonly inProgress = new Set<string>();
  private readonly cache: MatchupCache = createMatchupCache();
  private readonly side: Side;
  private readonly opts: ProverOptions;
  private readonly budget: ProverBudget;
  states: number;
  cells: number;

  constructor(side: Side, opts: ProverOptions, budget: ProverBudget, spent: { states: number; cells: number }) {
    this.side = side;
    this.opts = opts;
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

  /** The children of one cell, drawn once per proof run and counted once; root cells take the probe draws, inner cells the base draws. */
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
   * The greedy probe: one line per root candidate (the ranking's order),
   * the own move by kill odds after the root, at every turn the reply
   * that leaves the opponent the most HP (the heal or the switch that
   * stalls a line; the static under-reads healing), the heaviest child of
   * that cell. Returns the candidates whose line ends in a win within
   * probeDepth turns, best first; an empty list means no full proof is
   * attempted.
   */
  probe(root: SimPosition, rootOrder: string[]): string[] {
    const battle = positionBattle(root);
    const own = searchOptions(root, this.side, this.opts);
    const ordered = rootOrder.length > 0 ? orderByRanking(own, rootOrder) : orderByOdds(battle, this.side, own);
    const start = this.cells;
    const winners: string[] = [];
    for (const candidate of ordered.slice(0, ROOT_CANDIDATES)) {
      if (this.followsToWin(root, candidate.choice, start) > 0) winners.push(candidate.choice);
    }
    return winners;
  }

  /** One greedy line from `position` opening with `choice`: the turns to the side's win inside the probe budget, 0 when it fails. */
  private followsToWin(position: SimPosition, choice: string, start: number): number {
    let at = position;
    let move = choice;
    for (let turn = 1; turn <= this.budget.probeDepth; turn++) {
      const replies = searchOptions(at, other(this.side), this.opts);
      if (replies.length === 0 || this.cells - start + replies.length > this.budget.probeCells) return 0;
      const cells = replies.map(reply => {
        const [p1Choice, p2Choice] = this.pair(move, reply.choice);
        return { reply, p1Choice, p2Choice, ...this.cellsFor(at, p1Choice, p2Choice, turn - 1) };
      });
      const lines = cells.map(cell => {
        const child = cell.children.reduce((heaviest, candidate) => (candidate.share > heaviest.share ? candidate : heaviest), cell.children[0]);
        return { cell, child, hp: opponentHp(positionBattle(child.position), this.side), value: this.ownStatic(cell) };
      });
      lines.sort((a, b) => b.hp - a.hp || a.value - b.value);
      const { cell: worst, child } = lines[0];
      if (worst.unpriced && worst.plain) return 0;
      const next = positionBattle(child.position);
      if (next.ended) return wonBy(next, this.side) ? turn : 0;
      const own = searchOptions(child.position, this.side, this.opts);
      if (own.length === 0) return 0;
      move = orderByOdds(next, this.side, own)[0].choice;
      at = child.position;
    }
    return 0;
  }

  /** The OR node: candidates in order until one proves with mass 1 or the list ends. */
  expand(position: SimPosition, ply: number, rootOrder: string[] | null): ReplyProof {
    const battle = positionBattle(position);
    const own = searchOptions(position, this.side, this.opts);
    const replies = searchOptions(position, other(this.side), this.opts);
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
    const proofs = cell.children.map(child => this.prove(child.position, ply + 1));
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

/** The binding reply (the cell with the least mass) and its open children, valued for the bar and the sentence. */
function openFields(root: Battle, side: Side, cells: CellProof[], cache: MatchupCache): Pick<ForcedWinProof, 'open' | 'openValue'> {
  if (cells.length === 0) return { openValue: null };
  const binding = cells.reduce((worst, proof) => (proof.proven.mass < worst.proven.mass ? proof : worst), cells[0]);
  let weight = 0;
  let sum = 0;
  let heaviest: { weight: number; key?: string } = { weight: 0 };
  binding.cell.children.forEach((child, index) => {
    const openShare = child.share * (1 - (binding.proofs[index]?.mass ?? 0));
    if (openShare <= 0) return;
    weight += openShare;
    sum += openShare * leafValue(positionBattle(child.position), cache);
    if (openShare > heaviest.weight) heaviest = { weight: openShare, key: child.key };
  });
  if (weight === 0) return { openValue: null };
  const open = openOf(root, binding.cell, heaviest.key, side);
  return { ...(open ? { open } : {}), openValue: sum / weight };
}

/** Proves from a serialized battle or a root position the caller already holds (no second deserialization). */
export function proveForcedWin(rootOrSerialized: string | SimPosition, request: ProveRequest): ForcedWinProof {
  const root = typeof rootOrSerialized === 'string' ? createRootPosition(rootOrSerialized) : rootOrSerialized;
  const battle = positionBattle(root);
  const budget = { ...PROVER_BUDGET, ...request.budget };
  const spent = request.spent ?? { states: 0, cells: 0 };
  const prover = new ForcedWinProver(request.side, { tera: request.tera, sleepClause: request.sleepClause }, budget, spent);
  if (battle.ended || prover.states >= budget.states) return { ...NONE, openValue: null, states: prover.states, cells: prover.cells };
  const winners = prover.probe(root, request.rootOrder);
  if (winners.length === 0) return { ...NONE, openValue: null, states: prover.states, cells: prover.cells };
  prover.states += 1;
  const { proven, cells } = prover.expand(root, 0, winners);
  const fields = openFields(battle, request.side, cells, createMatchupCache());
  return { ...proven, ...fields, states: prover.states, cells: prover.cells };
}
