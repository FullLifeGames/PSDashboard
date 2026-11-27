import type { Battle, Pokemon } from '@pkmn/sim';
import { boundaryEvent, randomCallMoves, type BoundaryEvent } from './ko-odds.ts';
import { pairKoOdds } from './pair/odds.ts';
import { accuracyRollReached } from './search/event-reach.ts';
import { eventDefender, moveIdOf } from './cell-defender.ts';
import { stopsHits } from './dex-facts/protect.ts';
import { dieTokens, eventSecondaries, hitClasses, hitKey, type EventSecondary, type SecondaryDie } from './search/secondary-classes.ts';
import type { KoOddsInfo } from './types.ts';
import { sideIndex, type RulesDex } from '@fulllifegames/replay-core';

export interface CellEvent {
  side: 'p1' | 'p2';
  moveId: string;
  /** Protocol ident of the event's defender, e.g. "p2a: Medicham" (nickname). */
  defenderIdent: string;
  event: BoundaryEvent;
  /** Secondary entries against this defender, read with it in the slot (search/secondary-classes.ts). */
  secondary?: EventSecondary[];
}

export type CellEventPlan =
  | { kind: 'none' }
  | { kind: 'fail' }
  | { kind: 'events'; events: CellEvent[] };

// `miss`, `hit-kill`, `none`, or `hit-nokill` with the secondary effects that came true (`hit-nokill+brn`).
type EventOutcome = string;

export const BOUNDARY_DRAW_BUDGET = 16;

type DexMove = ReturnType<Battle['dex']['moves']['get']>;

const clicksTera = (choice: string) => choice.split(' > ')[0].trim().split(/\s+/).includes('terastallize');

function attackerPrevented(attacker: Pokemon): boolean {
  if (attacker.status === 'par' || attacker.status === 'frz' || attacker.status === 'slp') return true;
  return Boolean(attacker.volatiles['confusion'] || attacker.volatiles['attract']);
}

function defenderShielded(defender: Pokemon): boolean {
  if (defender.volatiles['substitute']) return true;
  if (defender.item === 'focussash' && defender.hp === defender.maxhp) return true;
  if (defender.ability === 'sturdy' && defender.hp === defender.maxhp) return true;
  return defender.ability === 'disguise' || defender.ability === 'iceface';
}

type SideEventPlan = { kind: 'fail' } | { kind: 'skip' } | { kind: 'event'; event: CellEvent };

function unpricedMovePlan(dex: RulesDex, move: DexMove): SideEventPlan {
  const damaging = move.exists && move.category !== 'Status';
  const rollFlagged = randomCallMoves(dex).has(move.id) ||
    (typeof move.accuracy === 'number' && move.accuracy < 100);
  if (damaging && rollFlagged) return { kind: 'fail' };
  return { kind: 'skip' };
}

function pricedEvent(battle: Battle, side: 'p1' | 'p2', moveId: string, defender: Pokemon, event: BoundaryEvent): SideEventPlan {
  const secondary = eventSecondaries(battle, `${side}a`, moveId, defender);
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

function planSideEvent(battle: Battle, side: 'p1' | 'p2', choice: string, oppChoice: string): SideEventPlan {
  const moveId = moveIdOf(choice)!;
  const own = sideIndex(side);
  const oppIndex = own === 0 ? 1 : 0;
  const attacker = battle.sides[own].active[0];
  if (!attacker || attacker.fainted) return { kind: 'fail' };
  if (attackerPrevented(attacker)) return { kind: 'fail' };

  const found = eventDefender(battle, oppIndex, oppChoice, [attacker, moveId]);
  if (!found || defenderShielded(found.body)) return { kind: 'fail' };

  const event = boundaryEvent(battle, attacker, found.body, moveId, { attacker: clicksTera(choice), defender: !found.incoming && clicksTera(oppChoice) });
  const move = battle.dex.moves.get(moveId);
  if (event === null) return unpricedMovePlan(battle.dex, move);
  if (move.category === 'Status') {
    const [p1Choice, p2Choice] = side === 'p1' ? [choice, oppChoice] : [oppChoice, choice];
    if (!accuracyRollReached(battle, side, move.id, p1Choice, p2Choice)) return { kind: 'skip' };
  }
  return pricedEvent(battle, side, move.id, found.body, event);
}

export function planCellEvents(battle: Battle, p1Choice: string, p2Choice: string): CellEventPlan {
  if (p1Choice.includes(',') || p2Choice.includes(',')) return { kind: 'fail' };
  const moveIds = { p1: moveIdOf(p1Choice), p2: moveIdOf(p2Choice) };
  for (const side of ['p1', 'p2'] as const) {
    const id = moveIds[side];
    // A move that stops hits changes what "hit" means: the outcome classes assume it lands or misses.
    if (id && stopsHits(battle.dex, battle.dex.moves.get(id))) return { kind: 'fail' };
  }

  const events: CellEvent[] = [];
  for (const side of ['p1', 'p2'] as const) {
    if (!moveIds[side]) continue;
    const [choice, oppChoice] = side === 'p1' ? [p1Choice, p2Choice] : [p2Choice, p1Choice];
    const plan = planSideEvent(battle, side, choice, oppChoice);
    if (plan.kind === 'fail') return { kind: 'fail' };
    if (plan.kind === 'event') events.push(plan.event);
  }

  if (events.length === 0) return { kind: 'none' };
  return { kind: 'events', events };
}

function eventMoveIndices(log: string[], events: CellEvent[]): Map<'p1' | 'p2', number> | null {
  const moveIndex = new Map<'p1' | 'p2', number>();
  for (const ev of events) {
    const prefix = `|move|${ev.side}a:`;
    let found: number | null = null;
    for (let index = 0; index < log.length; index++) {
      if (log[index].startsWith(prefix)) {
        if (found !== null) return null;
        found = index;
      }
    }
    if (found !== null) moveIndex.set(ev.side, found);
  }
  return moveIndex;
}

// The residual starts at a blank protocol line that no |t:| follows (a pivot's resume opens with a blank and a |t:|).
function movePhaseEnd(log: string[], from: number): number {
  for (let at = from; at < log.length; at++) {
    if (log[at] === '|' && !log[at + 1]?.startsWith('|t:|')) return at;
  }
  return log.length;
}

function killedBefore(log: string[], index: number, otherIndex: number | undefined, faintLine: string): boolean {
  const end = movePhaseEnd(log, index + 1);
  for (let at = index + 1; at < end; at++) {
    if (otherIndex !== undefined && otherIndex > index && at >= otherIndex) break;
    if (log[at] === faintLine) return true;
  }
  return false;
}

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

// A |cant| the other event side's secondary die explains (a flinch that came true) cuts the move; any other is a skip.
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

/** A seed child's outcome class from its log; null when the lines break the kill-truncation model (full paralysis). */
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
  for (const ev of events) {
    if (outcomes.has(ev.side)) continue;
    const other = events.find(entry => entry.side !== ev.side);
    const otherOutcome = other ? outcomes.get(other.side) : undefined;
    if (!other || !(otherOutcome === 'hit-kill' || (cut.has(ev.side) && otherOutcome?.startsWith('hit-nokill+')))) return null;
    outcomes.set(ev.side, 'none');
  }
  return events.map(ev => outcomes.get(ev.side)!).join('|');
}

/** The first mover across the sampled children (a lone mover votes first: kill truncation); null on disagreement. */
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

/** Class weights: miss 1−a, hit-kill a·k, hit-nokill a·(1−k); the first mover's kill truncates the second to 'none'. */
export function foldClassWeights(events: CellEvent[], first: 'p1' | 'p2'): Map<string, number> {
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
      add(key(o1, 'none'), w1);
      continue;
    }
    for (const [o2, w2] of outcomesOf(secondEvent)) add(key(o1, o2), w1 * w2);
  }
  return weights;
}

export function drawnClassWeight(events: CellEvent[], classKey: string, first: 'p1' | 'p2'): number | null {
  const weight = foldClassWeights(events, first).get(classKey);
  return weight === undefined ? null : weight;
}

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
