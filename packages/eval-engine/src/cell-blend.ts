import type { Battle, Pokemon, PRNGSeed } from '@pkmn/sim';
import { boundaryEvent, RANDOM_CALL_MOVES, type BoundaryEvent } from './ko-odds.ts';
import { pairKoOdds } from './pair/odds.ts';
import { accuracyRollReached } from './search/event-reach.ts';
import { shieldsSide } from './search/hints.ts';
import type { KoOddsInfo } from './types.ts';
import { sideIndex } from '@fulllifegames/replay-core';

/**
 * Root-cell boundary-event planning and outcome-class arithmetic (round 6
 * expectation grounding). A cell whose pair contains priceable binary
 * events (an accuracy roll, a KO-range roll) is priced as analytically
 * weighted class means instead of a raw seed average; every guard in here
 * fails closed back to today's behavior. Value channel only — narrative
 * cumulation lives in streaks.ts.
 */

/** One priced boundary event of a root cell. */
export interface CellEvent {
  side: 'p1' | 'p2';
  moveId: string;
  /** Protocol ident of the event's defender, e.g. "p2a: Medicham" (nickname). */
  defenderIdent: string;
  event: BoundaryEvent;
}

export type CellEventPlan =
  | { kind: 'none' }                    // no stochastic boundary — today's path is already right
  | { kind: 'fail' }                    // a guard tripped — keep today's path
  | { kind: 'events'; events: CellEvent[] };

type EventOutcome = 'miss' | 'hit-kill' | 'hit-nokill' | 'none';

/**
 * Fixed probe seeds for boundary cells whose analytic classes went
 * unsampled by the base draws. Never randomized.
 */
export const PROBE_SEEDS: readonly PRNGSeed[] = [
  '21,22,23,24', '25,26,27,28', '29,30,31,32', '33,34,35,36', '37,38,39,40',
  '41,42,43,44', '45,46,47,48', '49,50,51,52', '53,54,55,56', '57,58,59,60',
  '61,62,63,64',
];

/** Total draw budget per boundary cell (base samples + probe draws). */
export const BOUNDARY_DRAW_BUDGET = 16;

const HAZARD_IDS = ['stealthrock', 'spikes', 'toxicspikes', 'stickyweb'];

type DexMove = ReturnType<Battle['dex']['moves']['get']>;

/**
 * Round 70: a move that stops hits changes what "hit" means (the outcome classes assume the foe's move lands or
 * misses), so a cell with one stays seed-priced. The rule comes from the Dex: a stalling move (the Protect family,
 * Endure, Mat Block, Max Guard) or a side protector (Wide Guard, Quick Guard, Crafty Shield, Mat Block; `shieldsSide`
 * of the hints). It replaces a list of thirteen names that held Wide Guard, Quick Guard, Crafty Shield and Max Guard by
 * name and missed Mat Block. test/cell-protect-guard.spec.ts plays every status move that sets a volatile or a side
 * condition on its user's side against probe hits, in both rule sets.
 */
const stopsHits = (dex: Battle['dex'], move: DexMove): boolean => !!move.stallingMove || shieldsSide(dex, move);

/** The move id a singles choice names, or null for switches/team orders. */
function moveIdOf(choice: string): string | null {
  const head = choice.split(' > ')[0].trim();
  const tokens = head.split(/\s+/);
  return tokens[0] === 'move' && tokens[1] ? tokens[1] : null;
}

/** The choice clicks Tera with its move: its odds read the body the click makes (round 67, T84). */
const clicksTera = (choice: string) => choice.split(' > ')[0].trim().split(/\s+/).includes('terastallize');

/** Action-prevention layers the occurrence model cannot fold. */
function attackerPrevented(attacker: Pokemon): boolean {
  if (attacker.status === 'par' || attacker.status === 'frz' || attacker.status === 'slp') return true;
  return Boolean(attacker.volatiles['confusion'] || attacker.volatiles['attract']);
}

/** Survival layers that break "damage roll ≥ HP ⇒ KO". */
function defenderShielded(defender: Pokemon): boolean {
  if (defender.volatiles['substitute']) return true;
  if (defender.item === 'focussash' && defender.hp === defender.maxhp) return true;
  if (defender.ability === 'sturdy' && defender.hp === defender.maxhp) return true;
  return defender.ability === 'disguise' || defender.ability === 'iceface';
}

/**
 * The defender a side's move will actually hit given the opponent's
 * choice; null when the model cannot know it (a hazard-tolled entry, a
 * pivot pair's mid-turn change, no living active).
 */
function eventDefender(battle: Battle, oppIndex: 0 | 1, oppChoice: string): Pokemon | null {
  const switchMatch = /^switch\s+(\d+)/.exec(oppChoice.trim());
  if (switchMatch) {
    const oppSide = battle.sides[oppIndex];
    // Entry hazards make the incoming mon's HP at hit time unknowable here.
    if (Object.keys(oppSide.sideConditions ?? {}).some(id => HAZARD_IDS.includes(id))) return null;
    const incoming = oppSide.pokemon[Number(switchMatch[1]) - 1];
    if (!incoming || incoming.fainted) return null;
    return incoming;
  }
  if (oppChoice.includes(' > ')) return null; // pivot pair: the defender changes mid-turn
  const active = battle.sides[oppIndex].active[0];
  if (!active || active.fainted) return null;
  return active;
}

type SideEventPlan = { kind: 'fail' } | { kind: 'skip' } | { kind: 'event'; event: CellEvent };

/**
 * A move the odds model could not price: an unpriceable DAMAGING roll move
 * leaves randomness the fold cannot see — fail the cell. A can't-miss
 * damaging move without an event has no priceable roll (occurrence
 * deviations are caught at classify time).
 */
function unpricedMovePlan(move: DexMove): SideEventPlan {
  const damaging = move.exists && move.category !== 'Status';
  const rollFlagged = RANDOM_CALL_MOVES.has(move.id) ||
    (typeof move.accuracy === 'number' && move.accuracy < 100);
  if (damaging && rollFlagged) return { kind: 'fail' };
  return { kind: 'skip' };
}

/** One side's boundary event for the cell: fail when a guard trips, skip when the side has no priceable roll. */
function planSideEvent(battle: Battle, side: 'p1' | 'p2', choice: string, oppChoice: string): SideEventPlan {
  const moveId = moveIdOf(choice)!;
  const own = sideIndex(side);
  const oppIndex = own === 0 ? 1 : 0;
  const attacker = battle.sides[own].active[0];
  if (!attacker || attacker.fainted) return { kind: 'fail' };
  if (attackerPrevented(attacker)) return { kind: 'fail' };

  // The defender this move will actually hit.
  const defender = eventDefender(battle, oppIndex, oppChoice);
  if (!defender) return { kind: 'fail' };
  if (defenderShielded(defender)) return { kind: 'fail' };

  const event = boundaryEvent(battle, attacker, defender, moveId, { attacker: clicksTera(choice), defender: clicksTera(oppChoice) });
  const move = battle.dex.moves.get(moveId);
  if (event === null) return unpricedMovePlan(move);
  // Round 69 (T146 c3): a status move stopped before its accuracy roll has no miss class.
  if (move.category === 'Status') {
    const [p1Choice, p2Choice] = side === 'p1' ? [choice, oppChoice] : [oppChoice, choice];
    if (!accuracyRollReached(battle, side, move.id, p1Choice, p2Choice)) return { kind: 'skip' };
  }
  if (event.accuracy < 1 || (event.killFraction > 0 && event.killFraction < 1)) {
    return { kind: 'event', event: { side, moveId: move.id, defenderIdent: `${defender.side.id}a: ${defender.name}`, event } };
  }
  // Fully deterministic event (certain hit, certain outcome): no event.
  return { kind: 'skip' };
}

/**
 * Plan the boundary events of one root cell, or refuse: 'none' when the
 * pair is deterministic as far as priceable rolls go, 'fail' when any
 * guard trips (the caller keeps the plain seed average).
 */
export function planCellEvents(battle: Battle, p1Choice: string, p2Choice: string): CellEventPlan {
  if (p1Choice.includes(',') || p2Choice.includes(',')) return { kind: 'fail' };
  const moveIds = { p1: moveIdOf(p1Choice), p2: moveIdOf(p2Choice) };
  for (const side of ['p1', 'p2'] as const) {
    const id = moveIds[side];
    if (id && stopsHits(battle.dex, battle.dex.moves.get(id))) return { kind: 'fail' };
  }

  const events: CellEvent[] = [];
  for (const side of ['p1', 'p2'] as const) {
    if (!moveIds[side]) continue; // a switching side has no event
    const [choice, oppChoice] = side === 'p1' ? [p1Choice, p2Choice] : [p2Choice, p1Choice];
    const plan = planSideEvent(battle, side, choice, oppChoice);
    if (plan.kind === 'fail') return { kind: 'fail' };
    if (plan.kind === 'event') events.push(plan.event);
  }

  if (events.length === 0) return { kind: 'none' };
  return { kind: 'events', events }; // p1 before p2 by loop order
}

/** Each event side's single move line index; null when a side's move line is duplicated (ambiguous). */
function eventMoveIndices(log: string[], events: CellEvent[]): Map<'p1' | 'p2', number> | null {
  const moveIndex = new Map<'p1' | 'p2', number>();
  for (const ev of events) {
    const prefix = `|move|${ev.side}a:`;
    let found: number | null = null;
    for (let index = 0; index < log.length; index++) {
      if (log[index].startsWith(prefix)) {
        if (found !== null) return null; // duplicate move lines: ambiguous
        found = index;
      }
    }
    if (found !== null) moveIndex.set(ev.side, found);
  }
  return moveIndex;
}

/**
 * Round 69 (T146 c1): the turn's move phase ends where the residual starts, a
 * blank protocol line that no `|t:|` follows (a pivot's resume of the turn
 * loop opens with the same blank line and a `|t:|`). Poison, Leech Seed and
 * Future Sight faints come after it and belong to no move.
 */
function movePhaseEnd(log: string[], from: number): number {
  for (let at = from; at < log.length; at++) {
    if (log[at] === '|' && !log[at + 1]?.startsWith('|t:|')) return at;
  }
  return log.length;
}

/**
 * hit-kill: the event's defender faints after this move, before the other
 * event side's move and before the residual (a later faint belongs to
 * something else).
 */
function killedBefore(log: string[], index: number, otherIndex: number | undefined, faintLine: string): boolean {
  const end = movePhaseEnd(log, index + 1);
  for (let at = index + 1; at < end; at++) {
    if (otherIndex !== undefined && otherIndex > index && at >= otherIndex) break;
    if (log[at] === faintLine) return true;
  }
  return false;
}

/** The side's outcome from its move line: a miss line after it, else the defender's faint decides. */
function sideOutcome(
  log: string[],
  events: CellEvent[],
  moveIndex: Map<'p1' | 'p2', number>,
  ev: CellEvent,
  index: number,
): EventOutcome {
  const missPrefix = `|-miss|${ev.side}a:`;
  if (log.some((line, at) => at > index && line.startsWith(missPrefix))) return 'miss';
  const other = events.find(entry => entry.side !== ev.side);
  const otherIndex = other ? moveIndex.get(other.side) : undefined;
  return killedBefore(log, index, otherIndex, `|faint|${ev.defenderIdent}`) ? 'hit-kill' : 'hit-nokill';
}

/**
 * Read a seed child's outcome class from its advance log, or null when the
 * lines deviate from the kill-truncation occurrence model (flinch, full
 * paralysis, ambiguous faints — anything the fold did not predict).
 * Key = event sides' outcomes in p1→p2 order joined with '|'.
 */
export function classifyChild(log: string[], events: CellEvent[]): string | null {
  const moveIndex = eventMoveIndices(log, events);
  if (!moveIndex) return null;
  // Any |cant| on an event side is an unmodeled skip.
  for (const ev of events) {
    const cantPrefix = `|cant|${ev.side}a:`;
    if (log.some(line => line.startsWith(cantPrefix))) return null;
  }

  const outcomes = new Map<'p1' | 'p2', EventOutcome>();
  for (const ev of events) {
    const index = moveIndex.get(ev.side);
    if (index === undefined) continue;
    outcomes.set(ev.side, sideOutcome(log, events, moveIndex, ev, index));
  }
  // Event sides without a move line are valid only as kill-truncation.
  for (const ev of events) {
    if (outcomes.has(ev.side)) continue;
    const other = events.find(entry => entry.side !== ev.side);
    if (!other || outcomes.get(other.side) !== 'hit-kill') return null;
    outcomes.set(ev.side, 'none');
  }
  return events.map(ev => outcomes.get(ev.side)!).join('|');
}

/**
 * The observed first mover among event sides across the sampled children.
 * A lone mover votes first (a missing second move under kill truncation
 * means the first mover killed); disagreement or zero votes → null.
 */
export function observeOrder(logs: string[][], events: CellEvent[]): 'p1' | 'p2' | null {
  const sides = events.map(ev => ev.side);
  let vote: 'p1' | 'p2' | null = null;
  for (const log of logs) {
    let first: 'p1' | 'p2' | null = null;
    let firstIndex = Infinity;
    for (const side of sides) {
      const prefix = `|move|${side}a:`;
      const index = log.findIndex(line => line.startsWith(prefix));
      if (index !== -1 && index < firstIndex) {
        firstIndex = index;
        first = side;
      }
    }
    if (first === null) continue;
    if (vote === null) vote = first;
    else if (vote !== first) return null;
  }
  return vote;
}

/**
 * Fold the cell's events, in observed actor order, into analytic class
 * weights: miss (1−a), hit-kill (a·k), hit-nokill (a·(1−k)); the first
 * mover's kill truncates the second event to 'none'. Keys are serialized
 * in p1→p2 side order regardless of acting order; weights sum to 1.
 */
export function foldClassWeights(events: CellEvent[], first: 'p1' | 'p2'): Map<string, number> {
  const outcomesOf = (event: CellEvent): [EventOutcome, number][] => {
    const { accuracy: a, killFraction: k } = event.event;
    const list: [EventOutcome, number][] = [];
    if (a < 1) list.push(['miss', 1 - a]);
    if (k > 0) list.push(['hit-kill', a * k]);
    if (k < 1) list.push(['hit-nokill', a * (1 - k)]);
    return list;
  };
  const weights = new Map<string, number>();
  const add = (key: string, weight: number) => {
    if (weight > 1e-9) weights.set(key, (weights.get(key) ?? 0) + weight);
  };
  if (events.length === 1) {
    for (const [outcome, weight] of outcomesOf(events[0])) add(outcome, weight);
    return weights;
  }
  const firstEvent = events.find(ev => ev.side === first)!;
  const secondEvent = events.find(ev => ev.side !== first)!;
  const key = (firstOutcome: EventOutcome, secondOutcome: EventOutcome) =>
    first === 'p1' ? `${firstOutcome}|${secondOutcome}` : `${secondOutcome}|${firstOutcome}`;
  for (const [o1, w1] of outcomesOf(firstEvent)) {
    if (o1 === 'hit-kill') {
      add(key(o1, 'none'), w1); // the second actor is the first's defender here
      continue;
    }
    for (const [o2, w2] of outcomesOf(secondEvent)) add(key(o1, o2), w1 * w2);
  }
  return weights;
}

/**
 * Per-option kill odds vs the opposing PRE-TURN active (the stay-column
 * headline) for the ranked-row payload. Emitted only when the odds carry
 * real information: a kill exists and is not guaranteed. Round 56: doubles
 * options go through pair/odds.ts (one headline slot, labeled).
 */
export function koOddsForOptions(battle: Battle, side: 'p1' | 'p2', choices: string[]): (KoOddsInfo | null)[] {
  if (battle.gameType === 'doubles') return pairKoOdds(battle, side, choices);
  const own = sideIndex(side);
  const attacker = battle.sides[own].active[0];
  const defender = battle.sides[own === 0 ? 1 : 0].active[0];
  return choices.map(choice => {
    if (choice.includes(',')) return null;
    const moveId = moveIdOf(choice);
    if (!moveId) return null;
    if (!attacker || attacker.fainted || !defender || defender.fainted) return null;
    if (attackerPrevented(attacker) || defenderShielded(defender)) return null;
    const event = boundaryEvent(battle, attacker, defender, moveId, { attacker: clicksTera(choice) });
    if (!event || event.killFraction <= 0 || event.pKill >= 1) return null;
    return { accuracy: event.accuracy, killFraction: event.killFraction, attacker: { slot: 0, species: attacker.species.name } };
  });
}
