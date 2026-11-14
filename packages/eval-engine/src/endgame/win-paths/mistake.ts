import type { Battle } from '@pkmn/sim';
import { playTurnWith, type PinnedTurn } from '../../dice/likeliest.ts';
import { createRootPosition, type ChoiceOption, type SimPosition } from '../../forward-model.ts';
import { forkBattle } from '../../forward/position.ts';
import { searchOptions } from '../../search/options.ts';
import { WinMeter } from './budget.ts';
import { FirstChoice } from './first-choice.ts';
import { firstChoiceChooser, positionOf } from './luck.ts';
import { awaitsReplacement, exactChance, inDrawOrder, lineOfPath, playOf, wonBy, type PathStep } from './luck-path.ts';
import type { WinPathsRequest, WinStep } from './types.ts';

/**
 * Round 89 (#130, step 3, a mistake by the opponent; ruling W3a): the smallest slip by the opponent after which the side that lost wins
 * within N turns. Both sides play the engine's first choice with every die at its likeliest result (`playTurnWith` with nothing
 * pinned, the choices of first-choice.ts). At each turn of that line the opponent's lower-ranked choices are the candidates; they are
 * tried mildest first (the smallest loss against its first choice, then the earlier turn, then the better rank): the slip is played at
 * its turn, both sides go back to their first choices, every die stays at its likeliest result, and the line counts when the game ends
 * in the side's win within N turns. The first candidate that counts is the answer: its line (the dice are forced, so ▶ Play ends in the
 * win under any seed) and the chance of the dice it needs (`exactChance`, as the luck step prices a path).
 *
 * The loss of a slip is the ranking's own: at the root the opponent's ranking of the request (`foeRanking`, the values the card shows;
 * a request without it reads the one-turn matrix, as every later position does). One slip per line: the path never mixes two, and a
 * line whose first choices already win (nothing was missed) answers `none`. A replacement after a faint is never a slip. It stops at
 * the first count (`found`), when every candidate was tried (`none`) or when the meter reaches its cap (`stopped`). The rules come from
 * the simulator and the battle's Dex, as everywhere in win-paths; no move, item or species name enters this file.
 */

/** A candidate slip: the turn it would be played on, its rank in the opponent's ranking (the first choice is rank 1) and its loss. */
export interface Slip { turn: number; rank: number; loss: number }

/** The mildest first: the smallest loss, then the earlier turn, then the better rank. */
export const byMildest = (a: Slip, b: Slip): number => (a.loss !== b.loss ? a.loss - b.loss : a.turn !== b.turn ? a.turn - b.turn : a.rank - b.rank);

type Side = 'p1' | 'p2';

interface BaseStep {
  start: Battle;
  atRoot: boolean;
  turnsDone: number;
  p1: ChoiceOption;
  p2: ChoiceOption;
  /** The path before this step. */
  before: readonly PathStep[];
}

interface Candidate extends Slip { base: BaseStep; option: ChoiceOption }

const other = (side: Side): Side => (side === 'p1' ? 'p2' : 'p1');

function stepOf(base: Pick<BaseStep, 'start' | 'turnsDone' | 'p1' | 'p2'>, turn: PinnedTurn): PathStep {
  return { start: base.start, p1: base.p1, p2: base.p2, turn: { ...turn, dice: inDrawOrder(turn) }, turnsDone: base.turnsDone + (awaitsReplacement(base.start) ? 0 : 1) };
}

class MistakeSearch {
  private readonly request: WinPathsRequest;
  private readonly meter: WinMeter;
  private readonly side: Side;
  private readonly foe: Side;
  private readonly turnsAllowed: number;
  private readonly root: SimPosition;
  private readonly first: FirstChoice;
  private readonly chooser: ReturnType<typeof firstChoiceChooser>;

  constructor(serialized: string, request: WinPathsRequest, meter: WinMeter) {
    this.request = request;
    this.meter = meter;
    this.side = request.side;
    this.foe = other(request.side);
    this.turnsAllowed = request.turns ?? 3;
    this.root = createRootPosition(serialized, request.ruleset);
    this.first = new FirstChoice(meter, request);
    this.chooser = firstChoiceChooser(this.root, request, meter, this.first);
  }

  run(): WinStep {
    const done = (step: Omit<WinStep, 'kind' | 'spent'>): WinStep => ({ kind: 'mistake', ...step, spent: this.meter.spent });
    const start = forkBattle(this.root, '1,2,3,4');
    const steps = start.ended ? [] : this.firstChoiceLine(start);
    const last = steps.at(-1);
    if (!last || wonBy(last.turn.battle, this.side)) return done({ status: 'none' });
    const candidates = this.candidatesOf(steps).sort(byMildest);
    for (const candidate of candidates) {
      if (this.meter.exhausted) return done({ status: 'stopped' });
      const tried = this.try(candidate);
      if (tried === 'stopped') return done({ status: 'stopped' });
      if (!tried) continue;
      const line = lineOfPath(this.side, tried.path, this.request.ruleset ?? 'standard');
      const deviation = { turn: (this.request.turn ?? 1) + candidate.base.turnsDone, label: candidate.option.label, rank: candidate.rank };
      return done({ status: 'found', chance: tried.chance, deviation, ...(line ? { line } : {}) });
    }
    return done({ status: 'none' });
  }

  /** Both sides on their first choice, every die at its likeliest result, until the game ends or the turns asked are taken. */
  private firstChoiceLine(from: Battle): (PathStep & { base: BaseStep })[] {
    const steps: (PathStep & { base: BaseStep })[] = [];
    let start = from;
    let turnsDone = 0;
    while (!start.ended && turnsDone < this.turnsAllowed) {
      const atRoot = steps.length === 0;
      const choices = this.chooser.at(atRoot ? this.root : positionOf(start), { turnsDone, atRoot, start });
      if (!choices) break;
      const base: BaseStep = { start, atRoot, turnsDone, ...choices, before: [...steps] };
      this.meter.turns += 1;
      let turn: PinnedTurn;
      try {
        turn = playTurnWith(start, playOf(choices.p1, choices.p2), []);
      } catch {
        break;
      }
      const step = { ...stepOf(base, turn), base };
      steps.push(step);
      start = step.turn.battle;
      turnsDone = step.turnsDone;
      if (this.meter.exhausted) break;
    }
    return steps;
  }

  /** The opponent's lower-ranked choices at each turn step of the line, with their loss against its first choice. */
  private candidatesOf(steps: readonly (PathStep & { base: BaseStep })[]): Candidate[] {
    const found: Candidate[] = [];
    for (const { base } of steps) {
      if (awaitsReplacement(base.start)) continue;
      const taken = base[this.foe].choice;
      for (const entry of this.rankingAt(base)) {
        if (entry.option.choice !== taken) found.push({ turn: base.turnsDone + 1, rank: entry.rank, loss: entry.loss, base, option: entry.option });
      }
    }
    return found;
  }

  /** The opponent's ranking at a step: the request's at the root, the one-turn matrix's elsewhere. */
  private rankingAt(base: BaseStep): { option: ChoiceOption; rank: number; loss: number }[] {
    const taken = base[this.foe].choice;
    const given = base.atRoot ? this.request.foeRanking : undefined;
    if (given && given.length > 0) {
      const legal = searchOptions(this.root, this.foe, { tera: this.request.tera, sleepClause: this.request.sleepClause });
      const best = (given.find(row => row.choice === taken) ?? given[0]).ev;
      return given.flatMap((row, index) => {
        const option = legal.find(item => item.choice === row.choice);
        return option ? [{ option, rank: index + 1, loss: Math.max(0, best - row.ev) }] : [];
      });
    }
    const ranked = this.first.at(positionOf(base.start))?.ranked[this.foe] ?? [];
    const best = (ranked.find(row => row.option.choice === taken) ?? ranked[0])?.value ?? 0;
    return ranked.map((row, index) => ({ option: row.option, rank: index + 1, loss: Math.max(0, best - row.value) }));
  }

  /** Plays the slip, then both sides on their first choices; the path and its chance when the side wins, null when it does not. */
  private try(candidate: Candidate): { path: PathStep[]; chance: number } | null | 'stopped' {
    const { base, option } = candidate;
    const picked = this.foe === 'p1' ? { p1: option, p2: base.p2 } : { p1: base.p1, p2: option };
    const slip = { start: base.start, turnsDone: base.turnsDone, ...picked };
    this.meter.turns += 1;
    let turn: PinnedTurn;
    try {
      turn = playTurnWith(base.start, playOf(picked.p1, picked.p2), []);
    } catch {
      return null;
    }
    const path: PathStep[] = [...base.before, stepOf(slip, turn)];
    for (;;) {
      const last = path[path.length - 1];
      const after = last.turn.battle;
      if (after.ended) break;
      if (last.turnsDone >= this.turnsAllowed) return null;
      if (this.meter.exhausted) return 'stopped';
      const choices = this.chooser.at(positionOf(after), { turnsDone: last.turnsDone, atRoot: false, start: after });
      if (!choices) return null;
      this.meter.turns += 1;
      try {
        path.push(stepOf({ start: after, turnsDone: last.turnsDone, ...choices }, playTurnWith(after, playOf(choices.p1, choices.p2), [])));
      } catch {
        return null;
      }
    }
    if (!wonBy(path[path.length - 1].turn.battle, this.side)) return null;
    return { path, chance: exactChance(path, plays => { this.meter.turns += plays; }) };
  }
}

/** The smallest slip by the opponent after which the side that lost wins within the turns asked; see the module's header. */
export function mistakeStep(serialized: string, request: WinPathsRequest, meter = new WinMeter(request.budget)): WinStep {
  return new MistakeSearch(serialized, request, meter).run();
}
