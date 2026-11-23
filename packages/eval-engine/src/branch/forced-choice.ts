import type { SimBattle } from './types.ts';
import { revivingSlots } from '../forward/request-reviving.ts';
import { forcedAnswersOf, type ForcedAnswer } from './forced-request.ts';
import { forceSwitches } from './forced-slots.ts';
import { findFaintedSlot, findFirstAvailableSwitchSlot, findSpeciesSlot } from './protocol-choices.ts';
import { retireUnshownBench, type ProtocolBench } from './team-order.ts';

/**
 * The answer to a forced request, read from the list `collectForcedSwitchSpecies` made (`forcedAnswersOf` gives each entry's slot, request
 * and revive flag); a plain array reads in log order with no revives.
 */

type Cursor = { current: number };

/** Per cursor, the entries beyond it that a request took out of order; the cursor stands on the first entry no request took. */
const takenBeyond = new WeakMap<Cursor, Set<number>>();

/** Marks entry `at` taken: the cursor moves past it when it stands on it, and past every taken entry that follows. */
function takeEntry(cursor: Cursor, at: number) {
  const beyond = takenBeyond.get(cursor) ?? new Set<number>();
  takenBeyond.set(cursor, beyond);
  beyond.add(at);
  while (beyond.delete(cursor.current)) cursor.current++;
}

interface Request {
  battle: SimBattle;
  sideIdx: number;
  list: string[];
  answers: readonly ForcedAnswer[] | undefined;
  cursor: Cursor;
  /** The party slots (1-based) the choice sends already. */
  taken: Set<number>;
  choices: (string | null)[];
}

/**
 * A request that marks a slot `reviving` (the simulator's own request, never a move name) takes the fainted body the log's revive line
 * names, else the first fainted body, which is what the simulator's `default` revives. A replacement request meets a revive line only where
 * the rebuild drifted: the line is not for it, and it drops the line.
 */
function answerRevives({ battle, sideIdx, list, answers, cursor, taken, choices }: Request, needs: boolean[], reviving: boolean[]) {
  for (const [slot, need] of needs.entries()) {
    if (!need || !reviving[slot]) continue;
    const named = answers?.[cursor.current]?.revive ? list[cursor.current] : undefined;
    if (named !== undefined) takeEntry(cursor, cursor.current);
    const target = findFaintedSlot(battle, sideIdx, named, taken);
    if (target === null) continue;
    taken.add(target);
    choices[slot] = `switch ${target}`;
  }
  if (reviving.some(Boolean)) return;
  while (answers?.[cursor.current]?.revive) takeEntry(cursor, cursor.current);
}

/**
 * The entries a request can take: those of the log's next request (a list the collector made; a revive line is no replacement), or the next
 * `count` entries of a plain list.
 */
function entriesOfNextRequest({ list, answers, cursor }: Request, count: number): number[] {
  const head = cursor.current;
  const window: number[] = [];
  if (!answers) {
    for (let at = head; window.length < count && at < list.length; at++) window.push(at);
    return window;
  }
  for (let at = head; at < list.length; at++) {
    if (answers[at].request === answers[head].request && !answers[at].revive && !takenBeyond.get(cursor)?.has(at)) window.push(at);
  }
  return window;
}

/**
 * Each open slot takes the entry whose switch line names it, the unclaimed entries fill the rest in log order; returns the entry per open
 * slot (undefined where the log leaves it empty) and takes them.
 */
function claimEntries(request: Request, open: number[]): (number | undefined)[] {
  const { answers, cursor } = request;
  const window = entriesOfNextRequest(request, open.length);
  const claimed = new Set<number>();
  const bySlot = new Map<number, number>();
  for (const slot of open) {
    const at = answers ? window.find(entry => !claimed.has(entry) && answers[entry].slot === slot) : undefined;
    if (at === undefined) continue;
    claimed.add(at);
    bySlot.set(slot, at);
  }
  const spare = window.filter(entry => !claimed.has(entry));
  const used = open.map(slot => bySlot.get(slot) ?? spare.shift());
  if (!answers) cursor.current += open.length;
  else for (const at of used) if (at !== undefined) takeEntry(cursor, at);
  return used;
}

/**
 * Slots the log names take their bodies first, so a slot without a name never takes a body another slot names; an empty slot takes `pass`
 * where the protocol's bench is out of bodies, else the first body no other answer took.
 */
function fillOpenSlots({ battle, sideIdx, taken, choices }: Request, open: number[], species: (string | undefined)[], empty: boolean) {
  const found = species.map((name, at) => {
    const target = name ? findSpeciesSlot(battle, sideIdx, name, taken) : null;
    if (target !== null) { taken.add(target); choices[open[at]] = `switch ${target}`; }
    return target;
  });
  for (const [at, slot] of open.entries()) {
    if (found[at] !== null) continue;
    if (!species[at] && empty) { choices[slot] = 'pass'; continue; }
    const target = findFirstAvailableSwitchSlot(battle, sideIdx, taken);
    taken.add(target);
    choices[slot] = `switch ${target}`;
  }
}

/**
 * The choice for a forced request: the answers fill the slots the log names, not the slots in log order. `bench` is what the protocol says
 * about the side (ProtocolBench): with it, a forced slot the log leaves empty after its body fainted takes `pass` once the bench bodies the
 * protocol never shows are out of the game; without it the slot takes the first living body.
 */
export function buildForcedSwitchChoice(
  battle: SimBattle,
  sideIdx: number,
  forcedSpecies: string[],
  cursor: Cursor,
  bench?: ProtocolBench,
): string | null {
  const needs = forceSwitches(battle, sideIdx);
  if (!needs.some(Boolean)) return null;

  const reviving = revivingSlots(battle.sides[sideIdx]);
  const request: Request = {
    battle, sideIdx, list: forcedSpecies, answers: forcedAnswersOf(forcedSpecies), cursor, taken: new Set<number>(), choices: needs.map(() => null),
  };
  answerRevives(request, needs, reviving);

  const open = needs.flatMap((need, slot) => (need && !reviving[slot] ? [slot] : []));
  if (open.length > 0) {
    const species = claimEntries(request, open).map(at => (at === undefined ? undefined : forcedSpecies[at]));
    const answered = species.filter(Boolean).length;
    const empty = !!bench && answered < open.length && retireUnshownBench(battle, sideIdx, bench, answered, open);
    if (battle.ended) return null;
    fillOpenSlots(request, open, species, empty);
  }

  return request.choices.map(choice => choice ?? 'pass').join(', ');
}
