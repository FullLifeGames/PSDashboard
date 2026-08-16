import type { Battle, Pokemon, PRNGSeed } from '@pkmn/sim';
import { boundaryEvent, RANDOM_CALL_MOVES, type BoundaryEvent } from './ko-odds';
import type { KoOddsInfo } from './types';

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

export type EventOutcome = 'miss' | 'hit-kill' | 'hit-nokill' | 'none';

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

/** Protection moves change what "hit" means — those cells stay seed-priced. */
const PROTECT_MOVE_IDS = new Set([
  'protect', 'detect', 'endure', 'spikyshield', 'banefulbunker', 'silktrap',
  'burningbulwark', 'kingsshield', 'obstruct', 'maxguard', 'wideguard',
  'quickguard', 'craftyshield',
]);

const HAZARD_IDS = ['stealthrock', 'spikes', 'toxicspikes', 'stickyweb'];

/** The move id a singles choice names, or null for switches/team orders. */
function moveIdOf(choice: string): string | null {
  const head = choice.split(' > ')[0].trim();
  const tokens = head.split(/\s+/);
  return tokens[0] === 'move' && tokens[1] ? tokens[1] : null;
}

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
 * Plan the boundary events of one root cell, or refuse: 'none' when the
 * pair is deterministic as far as priceable rolls go, 'fail' when any
 * guard trips (the caller keeps the plain seed average).
 */
export function planCellEvents(battle: Battle, p1Choice: string, p2Choice: string): CellEventPlan {
  if (p1Choice.includes(',') || p2Choice.includes(',')) return { kind: 'fail' };
  const moveIds = { p1: moveIdOf(p1Choice), p2: moveIdOf(p2Choice) };
  for (const side of ['p1', 'p2'] as const) {
    const id = moveIds[side];
    if (id && PROTECT_MOVE_IDS.has(battle.dex.moves.get(id).id)) return { kind: 'fail' };
  }

  const events: CellEvent[] = [];
  for (const side of ['p1', 'p2'] as const) {
    const moveId = moveIds[side];
    if (!moveId) continue; // a switching side has no event
    const sideIndex = side === 'p1' ? 0 : 1;
    const oppIndex = sideIndex === 0 ? 1 : 0;
    const attacker = battle.sides[sideIndex].active[0];
    if (!attacker || attacker.fainted) return { kind: 'fail' };
    if (attackerPrevented(attacker)) return { kind: 'fail' };

    // The defender this move will actually hit.
    const oppChoice = side === 'p1' ? p2Choice : p1Choice;
    let defender: Pokemon;
    const switchMatch = /^switch\s+(\d+)/.exec(oppChoice.trim());
    if (switchMatch) {
      const oppSide = battle.sides[oppIndex];
      // Entry hazards make the incoming mon's HP at hit time unknowable here.
      if (Object.keys(oppSide.sideConditions ?? {}).some(id => HAZARD_IDS.includes(id))) return { kind: 'fail' };
      const incoming = oppSide.pokemon[Number(switchMatch[1]) - 1];
      if (!incoming || incoming.fainted) return { kind: 'fail' };
      defender = incoming;
    } else if (oppChoice.includes(' > ')) {
      return { kind: 'fail' }; // pivot pair: the defender changes mid-turn
    } else {
      const active = battle.sides[oppIndex].active[0];
      if (!active || active.fainted) return { kind: 'fail' };
      defender = active;
    }
    if (defenderShielded(defender)) return { kind: 'fail' };

    const event = boundaryEvent(battle, attacker, defender, moveId);
    const move = battle.dex.moves.get(moveId);
    if (event === null) {
      // An unpriceable DAMAGING roll move leaves randomness the fold cannot
      // see — fail the cell. A can't-miss damaging move without an event has
      // no priceable roll (occurrence deviations are caught at classify time).
      const damaging = move.exists && move.category !== 'Status';
      const rollFlagged = RANDOM_CALL_MOVES.has(move.id) ||
        (typeof move.accuracy === 'number' && move.accuracy < 100);
      if (damaging && rollFlagged) return { kind: 'fail' };
      continue;
    }
    if (event.accuracy < 1 || (event.killFraction > 0 && event.killFraction < 1)) {
      events.push({ side, moveId: move.id, defenderIdent: `${defender.side.id}a: ${defender.name}`, event });
    }
    // Fully deterministic event (certain hit, certain outcome): no event.
  }

  if (events.length === 0) return { kind: 'none' };
  return { kind: 'events', events }; // p1 before p2 by loop order
}

/**
 * Read a seed child's outcome class from its advance log, or null when the
 * lines deviate from the kill-truncation occurrence model (flinch, full
 * paralysis, ambiguous faints — anything the fold did not predict).
 * Key = event sides' outcomes in p1→p2 order joined with '|'.
 */
export function classifyChild(log: string[], events: CellEvent[]): string | null {
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
  // Any |cant| on an event side is an unmodeled skip.
  for (const ev of events) {
    const cantPrefix = `|cant|${ev.side}a:`;
    if (log.some(line => line.startsWith(cantPrefix))) return null;
  }

  const outcomes = new Map<'p1' | 'p2', EventOutcome>();
  for (const ev of events) {
    const index = moveIndex.get(ev.side);
    if (index === undefined) continue;
    const missPrefix = `|-miss|${ev.side}a:`;
    if (log.some((line, at) => at > index && line.startsWith(missPrefix))) {
      outcomes.set(ev.side, 'miss');
      continue;
    }
    // hit-kill: the event's defender faints after this move and before the
    // other event side's move (a later faint belongs to something else).
    const other = events.find(entry => entry.side !== ev.side);
    const otherIndex = other ? moveIndex.get(other.side) : undefined;
    const faintLine = `|faint|${ev.defenderIdent}`;
    let killed = false;
    for (let at = index + 1; at < log.length; at++) {
      if (otherIndex !== undefined && otherIndex > index && at >= otherIndex) break;
      if (log[at] === faintLine) {
        killed = true;
        break;
      }
    }
    outcomes.set(ev.side, killed ? 'hit-kill' : 'hit-nokill');
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
 * real information: a kill exists and is not guaranteed.
 */
export function koOddsForOptions(battle: Battle, side: 'p1' | 'p2', choices: string[]): (KoOddsInfo | null)[] {
  const sideIndex = side === 'p1' ? 0 : 1;
  const attacker = battle.sides[sideIndex].active[0];
  const defender = battle.sides[sideIndex === 0 ? 1 : 0].active[0];
  return choices.map(choice => {
    if (choice.includes(',')) return null;
    const moveId = moveIdOf(choice);
    if (!moveId) return null;
    if (!attacker || attacker.fainted || !defender || defender.fainted) return null;
    if (attackerPrevented(attacker) || defenderShielded(defender)) return null;
    const event = boundaryEvent(battle, attacker, defender, moveId);
    if (!event || event.killFraction <= 0 || event.pKill >= 1) return null;
    return { accuracy: event.accuracy, killFraction: event.killFraction };
  });
}
