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

// Candidates are tried mildest first; the first slip after which the side wins within N turns answers; one per line.

/** A candidate slip: its turn, its rank in the opponent's ranking (the first choice is rank 1) and its loss. */
export interface Slip { turn: number; rank: number; loss: number }

export const byMildest = (a: Slip, b: Slip): number => (a.loss !== b.loss ? a.loss - b.loss : a.turn !== b.turn ? a.turn - b.turn : a.rank - b.rank);

type Side = 'p1' | 'p2';

interface BaseStep {
  start: Battle;
  atRoot: boolean;
  turnsDone: number;
  p1: ChoiceOption;
  p2: ChoiceOption;
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

export function mistakeStep(serialized: string, request: WinPathsRequest, meter = new WinMeter(request.budget)): WinStep {
  return new MistakeSearch(serialized, request, meter).run();
}
