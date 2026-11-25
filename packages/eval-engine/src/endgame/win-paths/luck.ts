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

// Best-first search over the dice: a node's priority bounds its path's chance (rolls and ties count as certain);
// chances only shrink, so the first win popped once no bound in the queue beats it is the likeliest.

interface Entry {
  /** Upper bound of the path's chance (exact for a `final` entry). */
  bound: number;
  seq: number;
  final: boolean;
  path: readonly PathStep[];
  next?: { start: Battle; turnsDone: number; pinned: readonly LikeliestDie[]; before: number; key?: string };
}

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

/** The root's option of a side: the ranking's choice when it is legal, else undefined (the matrix's). */
export function rootChoice(root: SimPosition, request: WinPathsRequest, side: 'p1' | 'p2'): ChoiceOption | undefined {
  const choice = request.first?.[side];
  if (!choice) return undefined;
  const found = searchOptions(root, side, { tera: request.tera, sleepClause: request.sleepClause }).find(option => option.choice === choice);
  return found ?? { choice, label: choice };
}

const productBefore = (dice: readonly LikeliestDie[], to: number): number => dice.slice(0, to).reduce((product, entry) => product * (entry.chance ?? 1), 1);

export interface Chooser {
  at(position: SimPosition, node: { turnsDone: number; atRoot: boolean; start: Battle }): { p1: ChoiceOption; p2: ChoiceOption } | null;
}

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
  /** The best bound a turn boundary was reached with, by turns taken and position; a worse arrival is dropped. */
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

  private choicesAt(entry: Entry): { p1: ChoiceOption; p2: ChoiceOption } | null {
    const node = entry.next!;
    const atRoot = entry.path.length === 0;
    return this.chooser.at(atRoot ? this.root : positionOf(node.start), { turnsDone: node.turnsDone, atRoot, start: node.start });
  }

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

  /** The same step with one more die turned: only dice after the last pinned one, so each set of pins arises once. */
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

  private othersOf(start: Battle, play: (battle: Battle) => void, turn: PinnedTurn, dice: LikeliestDie[], index: number): LikeliestDie[] {
    const entry = dice[index];
    if (entry.die.name.kind !== 'damage-roll') return otherResults(entry, turn.draws.get(dieKey(entry.die.name)));
    const boundary = rollBoundary(start, play, dice.map(item => item.die), index);
    this.meter.turns += boundary ? boundary.plays : 2;
    const other = boundary ? otherRollGroup(entry, boundary) : null;
    return other ? [other] : [];
  }
}

export function luckPath(serialized: string, request: WinPathsRequest, meter = new WinMeter(request.budget)): WinStep {
  return new LuckSearch(serialized, request, meter).run();
}

export function luckUnder(serialized: string, request: WinPathsRequest, meter: WinMeter, chooser: (root: SimPosition) => Chooser): WinStep {
  return new LuckSearch(serialized, request, meter, chooser).run();
}
