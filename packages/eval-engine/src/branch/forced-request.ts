import type { RulesDex } from '@fulllifegames/replay-core';
import type { SimBattle } from './types.ts';

/**
 * A line the slot's choice made: a move, a switch, or a `|cant|` that names
 * its move (a `|cant|` with `[of]` is a blocker's line about the foe's move).
 */
const isOwnAction = (line: string) =>
  /^\|(move|switch)\|/.test(line) || (line.startsWith('|cant|') && !!line.split('|')[4] && !line.includes('[of]'));

/**
 * An own `|-activate|` of an ability that makes its holder leave mid-turn: the
 * Dex gives it an Emergency Exit handler (Emergency Exit and Wimp Out).
 */
function abilityAskedToLeave(line: string, dex: RulesDex): boolean {
  const [, tag, , effect] = line.split('|');
  if (tag !== '-activate' || !effect?.startsWith('ability: ')) return false;
  const ability = dex.abilities.get(effect.slice('ability: '.length));
  return 'onEmergencyExit' in ability && typeof ability.onEmergencyExit === 'function';
}

/**
 * Whether the slot's switch at `index` answers a forced request instead of
 * being the side's choice (round 64, T121). Current logs write `[from]` for
 * a move's selfSwitch; older logs (gen 6 and 8, 2022) write a pivot's switch
 * without `[from]`, after the slot's own move (653785 t5: Tornadus's U-turn,
 * then Excadrill). A body that left before it acted, ejected by its item
 * (751407 t1: Deoxys's Eject Pack, then Dragonite), sent out by its ability
 * (round 67, T133: Emergency Exit, Wimp Out) or fainted (gens 1 to 4 replace
 * before upkeep), had its replacement asked for, so the simulator writes the
 * request break (`|`) between that last own line and the switch. A Pursuit
 * that pops the Air Balloon of a body on its way out writes the chosen switch
 * right after the item line (round 64 review).
 */
export function answersForcedRequest(events: string[], index: number, ident: string, dex: RulesDex): boolean {
  if (events[index].includes('[from]')) return true;
  const own = [...events.keys()].filter(at => at < index && events[at].split('|')[2]?.startsWith(ident));
  if (own.some(at => isOwnAction(events[at]))) return true;
  const last = own[own.length - 1];
  if (last === undefined || !events.slice(last + 1, index).includes('|')) return false;
  return /^\|(-enditem|faint)\|/.test(events[last]) || abilityAskedToLeave(events[last], dex);
}

/**
 * Round 89 (#131, #144): what the log says about each entry of a forced list beyond its name: the slot its switch line names (null for
 * a revive, whose body sits on the bench) and whether it answers a Revival Blessing request. The list stays a `string[]` (its readers
 * take names), and this record travels beside it by the array's identity, so a reader that copies the array gets the old reading.
 */
export interface ForcedAnswer {
  /** The active slot (0 for `a`) the line switches into; null for a revive. */
  slot: number | null;
  /** The line is the `-heal` of a revive: the name is the fainted body the log brings back. */
  revive: boolean;
  /** The request the log answers with this line: the entries of one request after the upkeep share it; every other entry has its own. */
  request: number;
}

const answersOf = new WeakMap<readonly string[], readonly ForcedAnswer[]>();

/** The record of a list that `collectForcedSwitchSpecies` made, parallel to it; undefined for any other array. */
export const forcedAnswersOf = (list: readonly string[]): readonly ForcedAnswer[] | undefined => answersOf.get(list);

/**
 * The slots of a side whose request asks for a fainted body (Revival Blessing): the request marks the user's party entry `reviving`
 * (`@pkmn/sim` pokemon.js, getSwitchRequestData). Whether a request revives comes from the request, never from a move name.
 */
export function revivingSlots(battle: SimBattle, sideIdx: number): boolean[] {
  const side = battle.sides[sideIdx];
  const party = (side.activeRequest as { side?: { pokemon?: { reviving?: boolean }[] } } | null)?.side?.pokemon;
  return side.active.map((_, slot) => !!party?.[slot]?.reviving);
}

/**
 * The entries of one block as requests: a run of switches into different slots is one request, and a revive line is one of its own. A
 * run ends where a slot repeats. `inOrder` puts a run in slot order: the log writes the replacements of one request in the order the
 * actions run (the faster body first), so `p2b` can come before `p2a`. The runs are numbered from `from`.
 */
function asRequests<T extends { answer: ForcedAnswer }>(entries: T[], from: number, inOrder: boolean): { out: T[]; next: number } {
  const out: T[] = [];
  let run: T[] = [];
  let request = from;
  const flush = () => {
    if (run.length === 0) return;
    for (const entry of run) entry.answer.request = request;
    out.push(...(inOrder ? run.sort((first, second) => (first.answer.slot ?? 0) - (second.answer.slot ?? 0)) : run));
    request++;
    run = [];
  };
  for (const entry of entries) {
    if (entry.answer.revive || run.some(other => other.answer.slot === entry.answer.slot)) flush();
    run.push(entry);
    if (entry.answer.revive) flush();
  }
  flush();
  return { out, next: request };
}

/**
 * The species the block's switches bring in on forced requests, in order: before upkeep the answers above, after upkeep every switch.
 * A Revival Blessing's `-heal` line (a body without a slot letter, healed by a move) is an entry of its own: the name of the fainted body.
 * After upkeep the switches of one request come in slot order (#144); `forcedAnswersOf(list)` gives each entry's slot and request.
 */
export function collectForcedSwitchSpecies(
  preUpkeep: string[],
  postUpkeep: string[],
  side: 'p1' | 'p2',
  dex: RulesDex,
): string[] {
  const matcher = new RegExp(`^\\|switch\\|(${side})([a-d]):`);
  const revived = new RegExp(`^\\|-heal\\|${side}: ([^|]+)\\|.*\\[from\\] move: `);
  const entryOf = (line: string, slot: RegExpMatchArray) => ({ name: line.split('|')[3].split(',')[0].trim(), answer: { slot: slot[2].charCodeAt(0) - 97, revive: false, request: 0 } });
  const before: { name: string; answer: ForcedAnswer }[] = [];

  for (const [index, line] of preUpkeep.entries()) {
    const slot = line.match(matcher);
    if (slot && answersForcedRequest(preUpkeep, index, `${slot[1]}${slot[2]}:`, dex)) {
      before.push(entryOf(line, slot));
      continue;
    }
    const body = line.match(revived)?.[1];
    if (body) before.push({ name: body.trim(), answer: { slot: null, revive: true, request: 0 } });
  }

  const after: typeof before = [];
  for (const line of postUpkeep) {
    const slot = line.match(matcher);
    if (slot) after.push(entryOf(line, slot));
  }
  const first = asRequests(before, 0, false);
  const entries = [...first.out, ...asRequests(after, first.next, true).out];

  const list = entries.map(entry => entry.name);
  answersOf.set(list, entries.map(entry => entry.answer));
  return list;
}
