import type { SimBattle } from './types.ts';
import { revivingSlots } from '../forward/request-reviving.ts';
import { forcedAnswersOf, type ForcedAnswer } from './forced-request.ts';
import { forceSwitches } from './forced-slots.ts';
import { findFaintedSlot, findFirstAvailableSwitchSlot, findSpeciesSlot } from './protocol-choices.ts';
import { retireUnshownBench, type ProtocolBench } from './team-order.ts';

/**
 * Round 89 (#131, #144): the answer to a forced request, read from the list `collectForcedSwitchSpecies` made. Its entries carry the slot
 * their switch line names, the request of the log they answer and whether they are a revive line (`forcedAnswersOf`). A plain array
 * (no record) reads in log order with no revives, as the answers were read before.
 */

type Cursor = { current: number };

/**
 * The entries of a list that a request took out of order (a later entry of the logged request it answers), by cursor: the cursor stands
 * on the first entry no request took, and this set holds the ones beyond it.
 */
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
 * names, else the first fainted body, which is what the simulator's `default` revives. A replacement request meets a revive line of the
 * log only where the rebuild drifted: the line is not for it, and it drops the line.
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
 * The entries a request can take: the entries of the log's next request, which the log wrote in slot order (a list the collector made;
 * a revive line is no replacement), or the next `count` entries of a plain list.
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
 * By slot: the entry whose switch line names the open slot; the entries no open slot claims fill the other open slots in log order.
 * Returns the entry each open slot takes (undefined where the log leaves it empty) and takes them.
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
 * The open slots take the bodies named by the log first, so a slot without a name never takes a body another slot names; a slot the log
 * leaves empty takes `pass` where the protocol's bench is out of bodies, else the first body no other answer of the choice took.
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
 * `bench`: what the protocol says about the side (ProtocolBench). With it, a forced slot the log leaves empty after its body
 * fainted takes `pass` once the bench bodies the protocol never shows are out of the game (round 73, T250); without it the
 * slot takes the first living body, as before.
 *
 * Round 89 (#131, #144): the answers fill the slots the log names, not the slots in log order; a slot the log leaves empty takes the
 * first body no other answer of the choice took; a revive request takes the fainted body the log's revive line names.
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
