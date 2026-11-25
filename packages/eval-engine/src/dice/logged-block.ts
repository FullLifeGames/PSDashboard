import type { Battle, PRNGSeed } from '@pkmn/sim';
import { sideIndex, toId } from '@fulllifegames/replay-core';
import { buildForcedSwitchChoice, forceSwitches, hasForceSwitch } from '../branch/corrections.ts';
import type { SimBattle } from '../branch/types.ts';
import { faintedSlots, logGoesOn, shownBodyIds, type ProtocolBench } from '../branch/team-order.ts';
import { serializeBattleStable } from '../forward-model.ts';
import { forkBattle } from '../forward/position.ts';
import { submittableChoice } from '../forward/request-moves.ts';
import { applyChoice } from '../forward/switches.ts';
import {
  ALIGNMENT_SEEDS, compareAlignment, extractProtocolEvents, isPerfectAlignment, scoreAlignment, type AlignmentScore, type ProtocolEvents,
} from '../hax-alignment.ts';
import { loggedDice } from './logged-results.ts';
import { playForcedTurn, type ForcedTurnInput } from './play.ts';
import { quietProcs } from './phantom-procs.ts';
import { genShape } from './recognize.ts';
import { loggedOptions } from './turn.ts';
import { dieKey, type DiceReport, type DieName, type DieReport, type ForcedDie } from './types.ts';

/** A logged turn: a block plays under one frozen seed's hidden dice with the log's dice forced on top (ADR 0022). */

export interface BlockCommands { p1: string; p2: string }

export function forcedTurnDice(battle: Battle, lines: readonly string[], choices: BlockCommands): ForcedDie[] {
  return loggedDice(lines, loggedOptions(battle, choices));
}

/** Writes the commands to a copy as the stream writes them to the live one; a refused choice throws. */
export function chooseOnCopy(battle: Battle, commands: readonly { side: 'p1' | 'p2'; command: string }[]): void {
  for (const { side, command } of commands) {
    if (battle.choose(side, command)) continue;
    throw new Error(battle.sides[side === 'p1' ? 0 : 1].choice.error || 'The simulator rejected this choice.');
  }
}

export interface BlockPart {
  live: Battle;
  dice: readonly ForcedDie[];
  commands: readonly { side: 'p1' | 'p2'; command: string }[];
  write: () => void;
  observe?: ForcedTurnInput['observe'];
  onDraw?: ForcedTurnInput['onDraw'];
}

/** The natural turn runs on a copy first, so a choice the copy refuses throws before the live battle is touched. */
export function playBlockPart({ live, dice, commands, write, observe, onDraw }: BlockPart): DiceReport {
  return playForcedTurn({ live, forced: dice, observe, onDraw, play: battle => (battle === live ? write() : chooseOnCopy(battle, commands)) });
}

/** False: the natural turn threw before the live battle got anything; a throw after the live write counts as played. */
export function writeBlockPart(part: BlockPart): boolean {
  const logLength = part.live.log.length;
  try {
    playBlockPart(part);
  } catch {
    if (part.live.log.length === logLength) return false;
  }
  return true;
}

/** The log's dice of a block, or null where the reader fails on an odd state (the block then takes the seed search). */
export function forcedTurnDiceOrNull(battle: Battle, lines: readonly string[], choices: BlockCommands): ForcedDie[] | null {
  try {
    return forcedTurnDice(battle, lines, choices);
  } catch {
    return null;
  }
}


export function protocolBenchOf(replayLog: string, lines: readonly string[], turn: number): (side: 'p1' | 'p2') => ProtocolBench {
  const cache: Partial<Record<'p1' | 'p2', ProtocolBench>> = {};
  return side => (cache[side] ??= { shown: shownBodyIds(replayLog, side), fainted: faintedSlots(lines, side), goesOn: logGoesOn(replayLog, turn) });
}

function submittable(battle: Battle, side: 'p1' | 'p2', choice: string): string {
  const [first] = choice.split(' > ');
  return submittableChoice(battle.sides[sideIndex(side)], first);
}

// A forced slot whose body fainted (a pivot's request has a living body in the slot).
function opensKnockout(battle: Battle): boolean {
  return [0, 1].some(index =>
    forceSwitches(battle as SimBattle, index).some((needed, slot) => needed && !!battle.sides[index].active[slot]?.fainted));
}

export interface BlockOnCopy {
  copy: Battle;
  dice: readonly ForcedDie[];
  choices: BlockCommands;
  forced: { p1: string[]; p2: string[] };
  bench?: (side: 'p1' | 'p2') => ProtocolBench | undefined;
  observe?: ForcedTurnInput['observe'];
  onDraw?: ForcedTurnInput['onDraw'];
  /** Runs one part; the caller wraps it (the arrival mutes its recorder's own stream while a forced part plays). */
  around?: (run: () => void) => void;
  /** Stop where a knockout opens a replacement request; a pivot's request is answered as the log answers it. */
  stopAtRequest?: boolean;
}

/** Each part gets the whole dice list (an earlier part's die is no draw in a later one); a refused choice throws. */
export function playBlockOnCopy({ copy, dice, choices, forced, bench, observe, onDraw, around, stopAtRequest }: BlockOnCopy): DieReport[] {
  const reports: DieReport[] = [];
  const part = (answers: { side: 'p1' | 'p2'; choice: string }[]): void => {
    const commands = answers.map(({ side, choice }) => ({ side, command: submittable(copy, side, choice) }));
    const run = (): void => {
      const report = playBlockPart({
        live: copy, dice, commands, observe, onDraw,
        write: () => { for (const { side, choice } of answers) applyChoice(copy, side, choice); },
      });
      reports.push(...report.forced);
    };
    if (around) around(run);
    else run();
  };
  part([{ side: 'p1', choice: choices.p1 }, { side: 'p2', choice: choices.p2 }]);
  const cursors = { p1: { current: 0 }, p2: { current: 0 } };
  for (let guard = 0; guard < 6 && !copy.ended; guard++) {
    if (stopAtRequest && opensKnockout(copy)) break;
    const answers = (['p1', 'p2'] as const).flatMap((side, index) => {
      const choice = hasForceSwitch(copy, index) ? buildForcedSwitchChoice(copy, index, forced[side], cursors[side], bench?.(side)) : null;
      return choice ? [{ side, choice }] : [];
    });
    if (answers.length === 0) break;
    part(answers);
  }
  return reports;
}

export interface BlockQuery {
  battle: Battle;
  expected: ProtocolEvents;
  seed: PRNGSeed;
  choices: BlockCommands;
  /** The block's lines: a proc die the forced turn draws and no line names is forced not to happen (`quietProcs`). */
  lines?: readonly string[];
  forced?: { p1: string[]; p2: string[] };
  bench?: (side: 'p1' | 'p2') => ProtocolBench | undefined;
}

/** `dice` null: the forced turn ends a game the log goes on past (the seed search takes it). */
export interface FaintStepResult { dice: ForcedDie[] | null; plays: number; quiet: number; seed: PRNGSeed }

type Rolls = Map<string, { name: DieName; value: number }>;

interface Trial { events: ProtocolEvents; rolls: Rolls; procs: Map<string, DieName>; reports: DieReport[]; log: readonly string[] }

function trialOf(checkpoint: string, query: BlockQuery, dice: readonly ForcedDie[], seed: PRNGSeed = query.seed): Trial | null {
  try {
    const copy = forkBattle({ serialized: checkpoint }, seed);
    const start = copy.log.length;
    const rolls: Rolls = new Map();
    const procs = new Map<string, DieName>();
    const reports = playBlockOnCopy({
      copy, dice, choices: query.choices, forced: query.forced ?? { p1: [], p2: [] }, bench: query.bench, onDraw: (name, value) => {
        if (name.kind === 'damage-roll' && !rolls.has(dieKey(name))) rolls.set(dieKey(name), { name, value });
        if (name.kind === 'ability-proc' || name.kind === 'item-proc') procs.set(dieKey(name), name);
      },
    });
    const log = copy.log.slice(start);
    return { events: extractProtocolEvents([...log]), rolls, procs, reports, log };
  } catch {
    return null;
  }
}

function identsBySlot(battle: Battle, log: readonly string[]): Map<string, Set<string>> {
  const bySlot = new Map<string, Set<string>>();
  const add = (slot: string, side: string, name: string): void => {
    const set = bySlot.get(slot) ?? new Set<string>();
    set.add(`${side}:${toId(name)}`);
    bySlot.set(slot, set);
  };
  for (const side of battle.sides.slice(0, 2)) for (const body of side.active) if (body) add(body.getSlot(), side.id, body.name);
  for (const line of log) {
    const match = line.match(/^\|(?:switch|drag|replace)\|(p[12])([a-d]): ?([^|]*)\|/);
    if (match) add(`${match[1]}${match[2]}`, match[1], match[3]);
  }
  return bySlot;
}

// All steps where the roll has 16 or fewer, 16 spread over the range where it has more (Gens 1 and 2 draw 39 values).
function stepGrid(steps: number): number[] {
  if (steps <= 16) return Array.from({ length: steps }, (_, step) => step);
  return Array.from({ length: 16 }, (_, index) => Math.round((index * (steps - 1)) / 15));
}

interface Hit { name: DieName; order: number[] }

// up: the log knocked the body out and the trial left it standing (its hits must hit harder). down: the trial knocked
// it out and the log did not, or a logged die could not land on it (its hits must hit softer).
interface Targets { up: ReadonlySet<string>; down: ReadonlySet<string> }

function hitsOn(trial: Trial, targets: Targets, bySlot: ReadonlyMap<string, ReadonlySet<string>>, gen: number): Hit[] {
  const roll = genShape(gen).roll;
  const grid = stepGrid(roll.steps);
  const hits: Hit[] = [];
  for (const { name, value } of trial.rolls.values()) {
    const idents = name.targetSlot ? bySlot.get(name.targetSlot) : undefined;
    if (!idents) continue;
    const up = [...idents].some(ident => targets.up.has(ident));
    if (!up && ![...idents].some(ident => targets.down.has(ident))) continue;
    const step = Array.from({ length: roll.steps }, (_, index) => index).find(index => roll.raw(index) === value);
    if (step === undefined) continue;
    hits.push({ name, order: [step, ...(up ? grid.filter(other => other > step) : grid.filter(other => other < step).reverse())] });
  }
  return hits;
}

function targetsOf(trial: Trial, expected: ProtocolEvents, bySlot: ReadonlyMap<string, ReadonlySet<string>>): Targets {
  const up = new Set<string>();
  const down = new Set<string>();
  for (const ident of expected.faints) if (!trial.events.faints.has(ident)) up.add(ident);
  for (const ident of trial.events.faints) if (!expected.faints.has(ident)) down.add(ident);
  for (const report of trial.reports) {
    if (report.took !== 'blocked') continue;
    for (const ident of bySlot.get(report.die.name.targetSlot ?? report.die.name.slot) ?? []) if (!up.has(ident)) down.add(ident);
  }
  return { up, down };
}

interface Settled { dice: readonly ForcedDie[]; trial: Trial | null; plays: number; quiet: number }

// A proc that stays away can let a body act that the proc stopped, whose hit draws its own procs: at most three passes.
function settle(checkpoint: string, query: BlockQuery, seed: PRNGSeed, forced: readonly ForcedDie[]): Settled {
  let dice = forced;
  let trial = trialOf(checkpoint, query, dice, seed);
  let plays = 1;
  let quiet = 0;
  for (let pass = 0; pass < 3 && trial && query.lines; pass++) {
    const added = quietProcs(trial.procs, dice, query.lines);
    if (added.length === 0) break;
    dice = [...dice, ...added];
    quiet += added.length;
    trial = trialOf(checkpoint, query, dice, seed);
    plays++;
  }
  return { dice, trial, plays, quiet };
}

interface Best { dice: readonly ForcedDie[]; seed: PRNGSeed; trial: Trial; score: AlignmentScore; quiet: number }

/** The faint step (ADR 0022); a tie between seeds keeps the earlier one. */
export function faintStep(query: BlockQuery, forced: readonly ForcedDie[]): FaintStepResult {
  let checkpoint: string;
  try {
    checkpoint = serializeBattleStable(query.battle);
  } catch {
    return { dice: [...forced], plays: 0, quiet: 0, seed: query.seed };
  }
  const first = settle(checkpoint, query, query.seed, forced);
  // A block the copy cannot play stays as it is: the live write refuses it too, and the caller's fallback takes over.
  if (!first.trial) return { dice: [...first.dice], plays: first.plays, quiet: first.quiet, seed: query.seed };
  let best: Best = { dice: first.dice, seed: query.seed, trial: first.trial, score: scoreAlignment(query.expected, first.trial.events), quiet: first.quiet };
  const result = (dice: readonly ForcedDie[] | null, plays: number, from: Best): FaintStepResult => ({ dice: dice && [...dice], plays, quiet: from.quiet, seed: from.seed });
  if (isPerfectAlignment(best.score)) return result(best.dice, first.plays, best);
  const steps = stepSets(checkpoint, query, best);
  let plays = first.plays + steps.plays;
  if (steps.perfect) return result(steps.perfect.dice, plays, steps.perfect);
  if (steps.accepted && compareAlignment(steps.accepted.score, best.score) < 0) best = steps.accepted;
  const searched = seedSearch(checkpoint, query, best);
  plays += searched.plays;
  best = searched.best;
  const endsEarly = best.trial.events.ended && !query.expected.ended;
  return result(endsEarly ? null : best.dice, plays, best);
}

// A set also stands with the log's faints, no ended mismatch and no more soft mismatches than the natural turn.
function stepSets(checkpoint: string, query: BlockQuery, natural: Best): { perfect: Best | null; accepted: Best | null; plays: number } {
  const bySlot = identsBySlot(query.battle, natural.trial.log);
  const hits = hitsOn(natural.trial, targetsOf(natural.trial, query.expected, bySlot), bySlot, query.battle.gen);
  const longest = Math.max(0, ...hits.map(hit => hit.order.length));
  const keys = new Set(hits.map(hit => dieKey(hit.name)));
  let accepted: Best | null = null;
  let plays = 0;
  const setAt = (index: number): ForcedDie[] => [
    ...natural.dice.filter(die => !keys.has(dieKey(die.name))),
    ...hits.map((hit): ForcedDie => ({ name: hit.name, result: { step: hit.order[Math.min(index, hit.order.length - 1)] } })),
  ];
  // The last step is the extreme of every order: when even it misses a logged faint, no step between gives it.
  let last: { index: number; trial: Trial } | null = null;
  if (longest > 2) {
    const trial = trialOf(checkpoint, query, setAt(longest - 1));
    plays++;
    if (trial) {
      if (scoreAlignment(query.expected, trial.events).faintMismatches > 0) return { perfect: null, accepted: null, plays };
      last = { index: longest - 1, trial };
    }
  }
  for (let index = 1; index < longest; index++) {
    const next = setAt(index);
    let trial: Trial | null;
    if (last && index === last.index) trial = last.trial;
    else {
      plays++;
      trial = trialOf(checkpoint, query, next);
    }
    if (!trial) continue;
    const score = scoreAlignment(query.expected, trial.events);
    const found: Best = { dice: next, seed: query.seed, trial, score, quiet: natural.quiet };
    if (isPerfectAlignment(score)) return { perfect: found, accepted, plays };
    const fits = !score.endedMismatch && score.faintMismatches === 0 && score.softMismatches <= natural.score.softMismatches;
    if (fits && !accepted) accepted = found;
  }
  return { perfect: null, accepted, plays };
}

function seedSearch(checkpoint: string, query: BlockQuery, from: Best): { best: Best; plays: number } {
  let best = from;
  let plays = 0;
  for (const seed of ALIGNMENT_SEEDS) {
    if (seed === query.seed) continue;
    const settled = settle(checkpoint, query, seed, from.dice);
    plays += settled.plays;
    if (!settled.trial) continue;
    const score = scoreAlignment(query.expected, settled.trial.events);
    if (compareAlignment(score, best.score) >= 0) continue;
    best = { dice: settled.dice, seed, trial: settled.trial, score, quiet: from.quiet + settled.quiet };
    if (isPerfectAlignment(score)) break;
  }
  return { best, plays };
}
