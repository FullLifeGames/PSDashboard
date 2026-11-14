import type { Battle } from '@pkmn/sim';
import { otherResults, otherRollGroup, playTurnWith, rollBoundary, type LikeliestDie, type PinnedTurn } from '../../dice/likeliest.ts';
import { dieKey } from '../../dice/types.ts';
import { createRootPosition, type ChoiceOption, type SimPosition } from '../../forward-model.ts';
import { forkBattle, toPosition } from '../../forward/position.ts';
import { searchOptions } from '../../search/options.ts';
import { copyOf } from '../../sim-ask/copy.ts';
import type { WinPathsRequest, WinStep } from './types.ts';
import { LUCK_FLOOR, WinMeter } from './budget.ts';
import { FirstChoice, positionKey } from './first-choice.ts';
import { awaitsReplacement, exactChance, inDrawOrder, lineOfPath, playOf, wonBy, type PathStep } from './luck-path.ts';

/**
 * Round 89 (#130, step 2, luck): the likeliest sequence of dice under which the side that lost wins within N turns, both sides playing
 * the engine's first choice (first-choice.ts). A best-first search over the dice: a node is a step to play (a turn, or the replacement
 * a faint asks for) from a battle, with the dice pinned for it; a step is played with every die at its likeliest result except the
 * pinned ones (`playTurnWith`). A node's priority is an upper bound of its path's chance: the product of the chances of its dice,
 * a damage roll and a speed tie counted as certain until the path wins (their exact share reads the simulator on copies: `exactChance`).
 * Its successors are the next step from the outcome, and the same step with one more die turned the other way: a chance die, a status
 * check, a hit count or a pick to another result of its draw (`otherResults`, the chance the simulator's own), a damage roll to the
 * other side of its knock-out boundary (`rollBoundary`), a speed tie to the other order. Only dice after the last pinned one are
 * turned, so a set of pins is generated once. Chances only shrink, so the first win popped, after its exact chance is read and
 * the queue's best bound cannot beat it, is the likeliest winning sequence the enumeration reaches.
 *
 * It stops at that win (`found`), at an empty queue (`none`: every path above the floor was played) or when the meter reaches its cap
 * (`stopped`). Dice a draw cannot name (a duration, a random target) follow the seed; the line lists them in `unforced`.
 * Caveat: a damage roll sits at the middle step of its group and counts its share only where it decides who falls, so a roll that
 * leaves a body one hit from a later knock-out is carried at that HP, not priced.
 */

interface Entry {
  /** Upper bound of the path's chance (exact for a `final` entry). */
  bound: number;
  seq: number;
  final: boolean;
  /** The path so far, and the step to play next (absent on a final entry). */
  path: readonly PathStep[];
  next?: { start: Battle; turnsDone: number; pinned: readonly LikeliestDie[]; before: number; key?: string };
}

/** A binary max-heap by bound, then insertion order. */
class Queue {
  private readonly items: Entry[] = [];
  private order = 0;

  get size(): number { return this.items.length; }

  push(entry: Omit<Entry, 'seq'>): void {
    this.items.push({ ...entry, seq: this.order++ });
    let at = this.items.length - 1;
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (this.better(parent, at)) break;
      [this.items[parent], this.items[at]] = [this.items[at], this.items[parent]];
      at = parent;
    }
  }

  pop(): Entry | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (last && this.items.length > 0) {
      this.items[0] = last;
      let at = 0;
      for (;;) {
        const [left, right] = [2 * at + 1, 2 * at + 2];
        let best = at;
        if (left < this.items.length && this.better(left, best)) best = left;
        if (right < this.items.length && this.better(right, best)) best = right;
        if (best === at) break;
        [this.items[best], this.items[at]] = [this.items[at], this.items[best]];
        at = best;
      }
    }
    return top;
  }

  peekBound(): number { return this.items.length > 0 ? this.items[0].bound : 0; }

  private better(a: number, b: number): boolean {
    const [x, y] = [this.items[a], this.items[b]];
    return x.bound !== y.bound ? x.bound > y.bound : x.seq < y.seq;
  }
}

const positions = new WeakMap<Battle, SimPosition>();

/** The position of a battle the search holds (read once: a battle is never written). */
export function positionOf(battle: Battle): SimPosition {
  let position = positions.get(battle);
  if (!position) {
    const copy = copyOf(battle);
    copy.prng = battle.prng.clone();
    position = toPosition(copy);
    positions.set(battle, position);
  }
  return position;
}

/** The root's options of a side by the request: the ranking's choice when it names one that is legal, else undefined (the matrix's). */
export function rootChoice(root: SimPosition, request: WinPathsRequest, side: 'p1' | 'p2'): ChoiceOption | undefined {
  const choice = request.first?.[side];
  if (!choice) return undefined;
  const found = searchOptions(root, side, { tera: request.tera, sleepClause: request.sleepClause }).find(option => option.choice === choice);
  return found ?? { choice, label: choice };
}

/** The product of the chances of a step's dice before position `to` (dice with no chance count one). */
const productBefore = (dice: readonly LikeliestDie[], to: number): number => dice.slice(0, to).reduce((product, entry) => product * (entry.chance ?? 1), 1);

/** What picks both sides' choices at a step of the search: the engine's first choice (luck), or the choices of a proof (a stronger play). */
export interface Chooser {
  at(position: SimPosition, node: { turnsDone: number; atRoot: boolean; start: Battle }): { p1: ChoiceOption; p2: ChoiceOption } | null;
}

/** The engine's first choice: the request's ranking at the root, the one-turn matrix everywhere else (see first-choice.ts). */
export function firstChoiceChooser(root: SimPosition, request: WinPathsRequest, meter: WinMeter, first = new FirstChoice(meter, request)): Chooser {
  return {
    at: (position, node) => {
      const given = node.atRoot ? { p1: rootChoice(root, request, 'p1'), p2: rootChoice(root, request, 'p2') } : { p1: undefined, p2: undefined };
      const picked = given.p1 && given.p2 ? null : first.at(position);
      const p1 = given.p1 ?? picked?.p1;
      const p2 = given.p2 ?? picked?.p2;
      return p1 && p2 ? { p1, p2 } : null;
    },
  };
}

class LuckSearch {
  private readonly request: WinPathsRequest;
  private readonly meter: WinMeter;
  private readonly floor: number;
  private readonly turnsAllowed: number;
  private readonly root: SimPosition;
  private readonly chooser: Chooser;
  private readonly queue = new Queue();
  /** The best bound a turn boundary was reached with, by turns taken and position: a later arrival with less is dropped. */
  private readonly arrived = new Map<string, number>();

  constructor(serialized: string, request: WinPathsRequest, meter: WinMeter, chooser?: (root: SimPosition) => Chooser) {
    this.request = request;
    this.meter = meter;
    this.floor = request.floor ?? LUCK_FLOOR;
    this.turnsAllowed = request.turns ?? 3;
    this.root = createRootPosition(serialized, request.ruleset);
    this.chooser = chooser ? chooser(this.root) : firstChoiceChooser(this.root, request, meter);
    const start = forkBattle(this.root, '1,2,3,4');
    if (!start.ended) this.queue.push({ bound: 1, final: false, path: [], next: { start, turnsDone: 0, pinned: [], before: 1 } });
  }

  run(): WinStep {
    const done = (step: Omit<WinStep, 'kind' | 'spent'>): WinStep => ({ kind: 'luck', ...step, spent: this.meter.spent });
    while (this.queue.size > 0) {
      const entry = this.queue.pop()!;
      if (entry.final) {
        const line = lineOfPath(this.request.side, entry.path, this.request.ruleset ?? 'standard');
        return done({ status: 'found', chance: entry.bound, ...(line ? { line } : {}) });
      }
      if (this.meter.exhausted) return done({ status: 'stopped' });
      const node = entry.next!;
      if (node.key !== undefined && (this.arrived.get(node.key) ?? 0) > entry.bound) continue;
      const choices = this.choicesAt(entry);
      if (choices) this.expand(entry, choices);
    }
    return done({ status: 'none' });
  }

  /** Both sides' choices for the node's step. */
  private choicesAt(entry: Entry): { p1: ChoiceOption; p2: ChoiceOption } | null {
    const node = entry.next!;
    const atRoot = entry.path.length === 0;
    return this.chooser.at(atRoot ? this.root : positionOf(node.start), { turnsDone: node.turnsDone, atRoot, start: node.start });
  }

  /** Plays the node's step and queues its successors: the outcome's next step, and each die after the last pinned one turned the other way. */
  private expand(entry: Entry, choices: { p1: ChoiceOption; p2: ChoiceOption }): void {
    const node = entry.next!;
    const play = playOf(choices.p1, choices.p2);
    let turn: PinnedTurn;
    try {
      this.meter.turns += 1;
      turn = playTurnWith(node.start, play, node.pinned);
    } catch {
      return;
    }
    const dice = inDrawOrder(turn);
    const turnsDone = node.turnsDone + (awaitsReplacement(node.start) ? 0 : 1);
    const path = [...entry.path, { start: node.start, p1: choices.p1, p2: choices.p2, turn: { ...turn, dice }, turnsDone }];
    this.queueOutcome(path, node.before * productBefore(dice, dice.length), turnsDone);
    this.queueTurned(entry, play, turn, dice);
  }

  /** The outcome of a step: a win becomes a final entry at its exact chance, a boundary within the turns asked the next step. */
  private queueOutcome(path: readonly PathStep[], bound: number, turnsDone: number): void {
    const after = path[path.length - 1].turn.battle;
    if (after.ended) {
      if (!wonBy(after, this.request.side)) return;
      const exact = exactChance(path, plays => { this.meter.turns += plays; });
      if (exact >= this.floor) this.queue.push({ bound: exact, final: true, path });
      return;
    }
    if (turnsDone >= this.turnsAllowed || bound < this.floor) return;
    const key = `${turnsDone}|${positionKey(positionOf(after))}`;
    if ((this.arrived.get(key) ?? 0) >= bound) return;
    this.arrived.set(key, bound);
    this.queue.push({ bound, final: false, path, next: { start: after, turnsDone, pinned: [], before: bound, key } });
  }

  /** The same step with one more die turned: only dice after the last pinned one (a set of pins is generated once). */
  private queueTurned(entry: Entry, play: (battle: Battle) => void, turn: PinnedTurn, dice: LikeliestDie[]): void {
    const node = entry.next!;
    const pinnedKeys = new Set(node.pinned.map(item => dieKey(item.die.name)));
    const lastPinned = dice.reduce((last, item, index) => (pinnedKeys.has(dieKey(item.die.name)) ? index : last), -1);
    for (let index = lastPinned + 1; index < dice.length && !this.meter.exhausted; index++) {
      for (const other of this.othersOf(node.start, play, turn, dice, index)) {
        const bound = node.before * productBefore(dice, index) * (other.chance ?? 1);
        if (bound < this.floor) continue;
        this.queue.push({ bound, final: false, path: entry.path, next: { ...node, key: undefined, pinned: [...node.pinned, other] } });
      }
    }
  }

  /** The other results of the die at `index` of the played turn, each with its chance (a roll's through the knock-out boundary). */
  private othersOf(start: Battle, play: (battle: Battle) => void, turn: PinnedTurn, dice: LikeliestDie[], index: number): LikeliestDie[] {
    const entry = dice[index];
    if (entry.die.name.kind !== 'damage-roll') return otherResults(entry, turn.draws.get(dieKey(entry.die.name)));
    const boundary = rollBoundary(start, play, dice.map(item => item.die), index);
    this.meter.turns += boundary ? boundary.plays : 2;
    const other = boundary ? otherRollGroup(entry, boundary) : null;
    return other ? [other] : [];
  }
}

/** The likeliest sequence of dice that wins the game for `request.side` within the turns asked; see the module's header. */
export function luckPath(serialized: string, request: WinPathsRequest, meter = new WinMeter(request.budget)): WinStep {
  return new LuckSearch(serialized, request, meter).run();
}

/**
 * The same search with the choices of the caller's chooser (a stronger play's proof): the likeliest dice under which those choices win,
 * as a `luck` step; the caller keeps what it needs of it (the line, the chance of the dice).
 */
export function luckUnder(serialized: string, request: WinPathsRequest, meter: WinMeter, chooser: (root: SimPosition) => Chooser): WinStep {
  return new LuckSearch(serialized, request, meter, chooser).run();
}
