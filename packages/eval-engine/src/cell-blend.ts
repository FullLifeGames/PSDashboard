import type { Battle, Pokemon, PRNGSeed } from '@pkmn/sim';
import { boundaryEvent, randomCallMoves, type BoundaryEvent } from './ko-odds.ts';
import { pairKoOdds } from './pair/odds.ts';
import { accuracyRollReached } from './search/event-reach.ts';
import { stopsHits } from './dex-facts/protect.ts';
import { dieTokens, eventSecondaries, hitClasses, hitKey, type EventSecondary, type SecondaryDie } from './search/secondary-classes.ts';
import type { KoOddsInfo } from './types.ts';
import { hazardConditions, sideIndex, type RulesDex } from '@fulllifegames/replay-core';

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
  /**
   * Round 86 (T305): the secondary entries of the move against this defender, each a die under 1 (search/secondary-classes.ts).
   * A hit that does not kill splits by the entries that came true. Absent when the defender is not on the field yet (a switch).
   */
  secondary?: EventSecondary[];
}

export type CellEventPlan =
  | { kind: 'none' }                    // no stochastic boundary — today's path is already right
  | { kind: 'fail' }                    // a guard tripped — keep today's path
  | { kind: 'events'; events: CellEvent[] };

/** `miss`, `hit-kill`, `none`, or `hit-nokill` with the secondary effects that came true (`hit-nokill+brn`). */
type EventOutcome = string;

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

type DexMove = ReturnType<Battle['dex']['moves']['get']>;

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
    if (Object.keys(oppSide.sideConditions ?? {}).some(id => hazardConditions(battle.dex).has(id))) return null;
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
function unpricedMovePlan(dex: RulesDex, move: DexMove): SideEventPlan {
  const damaging = move.exists && move.category !== 'Status';
  const rollFlagged = randomCallMoves(dex).has(move.id) ||
    (typeof move.accuracy === 'number' && move.accuracy < 100);
  if (damaging && rollFlagged) return { kind: 'fail' };
  return { kind: 'skip' };
}

/**
 * The event of a move that reached its accuracy roll: kept when it can miss, can kill without being sure to, or (round 86, T305)
 * can draw a secondary die, which has outcome classes of its own also for a move that cannot miss or kill. A certain hit with a
 * certain outcome and no die is no event.
 */
function pricedEvent(battle: Battle, side: 'p1' | 'p2', moveId: string, defender: Pokemon, oppChoice: string, event: BoundaryEvent): SideEventPlan {
  const secondary = /^switch\s+\d+/.test(oppChoice.trim()) ? undefined : eventSecondaries(battle, `${side}a`, moveId, defender);
  if (secondary === null) return { kind: 'fail' };
  const priced = !!secondary?.length && event.killFraction < 1;
  if (event.accuracy < 1 || (event.killFraction > 0 && event.killFraction < 1) || priced) {
    return {
      kind: 'event',
      event: { side, moveId, defenderIdent: `${defender.side.id}a: ${defender.name}`, event, ...(secondary?.length ? { secondary } : {}) },
    };
  }
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
  if (event === null) return unpricedMovePlan(battle.dex, move);
  // Round 69 (T146 c3): a status move stopped before its accuracy roll has no miss class.
  if (move.category === 'Status') {
    const [p1Choice, p2Choice] = side === 'p1' ? [choice, oppChoice] : [oppChoice, choice];
    if (!accuracyRollReached(battle, side, move.id, p1Choice, p2Choice)) return { kind: 'skip' };
  }
  return pricedEvent(battle, side, move.id, defender, oppChoice, event);
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
    // Round 70: a move that stops hits changes what "hit" means (the outcome classes assume the foe's move lands or misses), so
    // a cell with one stays seed-priced; the Protect family comes from the Dex (test/cell-protect-guard.spec.ts).
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
 * Round 86 (T305): the |cant| lines of the event sides. A cant that the other event side's secondary die explains (a flinch that
 * came true, reason = the effect id) cuts the side's move and leaves its outcome `none`; any other |cant| on an event side is an
 * unmodeled skip (null). Returns the cut sides with their reasons.
 */
function cutSides(log: string[], events: CellEvent[]): Map<'p1' | 'p2', string> | null {
  const cut = new Map<'p1' | 'p2', string>();
  for (const ev of events) {
    const cants = log.filter(line => line.startsWith(`|cant|${ev.side}a:`));
    if (cants.length === 0) continue;
    const reason = cants[0].split('|')[3];
    const other = events.find(entry => entry.side !== ev.side);
    if (cants.length > 1 || !other?.secondary?.some(entry => entry.truncates && entry.effectId === reason)) return null;
    cut.set(ev.side, reason);
  }
  return cut;
}

/**
 * Read a seed child's outcome class from its advance log, or null when the
 * lines deviate from the kill-truncation occurrence model (full
 * paralysis, ambiguous faints — anything the fold did not predict).
 * Key = event sides' outcomes in p1→p2 order joined with '|'.
 *
 * Round 86 (T305): a hit that does not kill carries the secondary effects that came true. `dice` (the fork's `DiceSink`) says
 * which; without it only the effects the log shows by a cut move (a flinch) are known. A |cant| of that effect on the other event
 * side is the flinch class, not a deviation.
 */
export function classifyChild(log: string[], events: CellEvent[], dice?: readonly SecondaryDie[]): string | null {
  const moveIndex = eventMoveIndices(log, events);
  if (!moveIndex) return null;
  const cut = cutSides(log, events);
  if (!cut) return null;

  const outcomes = new Map<'p1' | 'p2', EventOutcome>();
  for (const ev of events) {
    const index = moveIndex.get(ev.side);
    if (index === undefined) continue;
    const outcome = sideOutcome(log, events, moveIndex, ev, index);
    if (outcome !== 'hit-nokill') {
      outcomes.set(ev.side, outcome);
      continue;
    }
    const cuts = [...cut].filter(([side]) => side !== ev.side).map(([, reason]) => reason);
    const tokens = new Set([...(dice ? dieTokens(dice, ev.side, ev.moveId, ev.secondary) : []), ...cuts]);
    outcomes.set(ev.side, hitKey([...tokens].sort()));
  }
  // Event sides without a move line are valid only as kill-truncation or as the side a secondary die cut.
  for (const ev of events) {
    if (outcomes.has(ev.side)) continue;
    const other = events.find(entry => entry.side !== ev.side);
    const otherOutcome = other ? outcomes.get(other.side) : undefined;
    if (!other || !(otherOutcome === 'hit-kill' || (cut.has(ev.side) && otherOutcome?.startsWith('hit-nokill+')))) return null;
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
  // [outcome key, weight, whether the outcome cuts the second mover]
  const outcomesOf = (event: CellEvent): [EventOutcome, number, boolean][] => {
    const { accuracy: a, killFraction: k } = event.event;
    const list: [EventOutcome, number, boolean][] = [];
    if (a < 1) list.push(['miss', 1 - a, false]);
    if (k > 0) list.push(['hit-kill', a * k, false]);
    if (k < 1) for (const cls of hitClasses(event.secondary)) list.push([hitKey(cls.tokens), a * (1 - k) * cls.weight, cls.cuts]);
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
  for (const [o1, w1, cuts] of outcomesOf(firstEvent)) {
    if (o1 === 'hit-kill' || cuts) {
      add(key(o1, 'none'), w1); // the second actor is the first's defender here: a kill or a flinch takes its move
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
