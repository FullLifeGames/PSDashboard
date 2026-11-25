import type { RulesDex } from '@fulllifegames/replay-core';

// A line the slot's choice made: a move, a switch, or a `|cant|` naming its move (`[of]`: a blocker's line instead).
const isOwnAction = (line: string) =>
  /^\|(move|switch)\|/.test(line) || (line.startsWith('|cant|') && !!line.split('|')[4] && !line.includes('[of]'));

// An own `|-activate|` of an ability with an `onEmergencyExit` handler (Emergency Exit, Wimp Out).
function abilityAskedToLeave(line: string, dex: RulesDex): boolean {
  const [, tag, , effect] = line.split('|');
  if (tag !== '-activate' || !effect?.startsWith('ability: ')) return false;
  const ability = dex.abilities.get(effect.slice('ability: '.length));
  return 'onEmergencyExit' in ability && typeof ability.onEmergencyExit === 'function';
}

// Old logs (gen 6 and 8) write a pivot's switch without `[from]`; a replaced body's switch follows a request break.
export function answersForcedRequest(events: string[], index: number, ident: string, dex: RulesDex): boolean {
  if (events[index].includes('[from]')) return true;
  const own = [...events.keys()].filter(at => at < index && events[at].split('|')[2]?.startsWith(ident));
  if (own.some(at => isOwnAction(events[at]))) return true;
  const last = own[own.length - 1];
  if (last === undefined || !events.slice(last + 1, index).includes('|')) return false;
  return /^\|(-enditem|faint)\|/.test(events[last]) || abilityAskedToLeave(events[last], dex);
}

/** What the log says about a forced list's entry beyond its name; keyed by the array's identity, so a copy loses it. */
export interface ForcedAnswer {
  /** The active slot (0 for `a`) the line switches into; null for a revive. */
  slot: number | null;
  /** The line is the `-heal` of a revive: the name is the fainted body the log brings back. */
  revive: boolean;
  /** The request this line answers: entries of one request after the upkeep share it, every other entry has its own. */
  request: number;
}

const answersOf = new WeakMap<readonly string[], readonly ForcedAnswer[]>();

export const forcedAnswersOf = (list: readonly string[]): readonly ForcedAnswer[] | undefined => answersOf.get(list);

// `inOrder` sorts a run by slot (the log writes replacements in action order, so `p2b` can precede `p2a`).
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

/** The species the block's switches bring in on forced requests: before upkeep the answers, after it every switch. */
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
