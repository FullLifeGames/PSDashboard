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

/**
 * Round 86 (the log's dice, T306): a logged turn through the dice module. The reconstruction used to replay a block's choices under the
 * best of sixteen seeds; now it plays them under the hidden dice of one frozen seed (index 0 of `ALIGNMENT_SEEDS`) with the dice the
 * log shows forced on top (ADR 0008, decision 4a). Three callers share this file: the reconstruction (`branch/runtime.ts`), the arrival
 * and the adopt (`branch/arrival-dice.ts`, which records the draws of the same turn), and the branch's first turn (`dice/turn.ts`
 * joins the same list to the user's dice).
 *
 * A block plays in parts: the choices of both sides, then every answer to a forced replacement that follows. Each part runs through
 * `playForcedTurn` with the whole turn's list, the way a `PendingTurn` carries a branch's list over a pause for a switch: a die an
 * earlier part drew is no draw in a later one, and every part ends the stream on the natural turn's seed at its place (decision D8), so
 * the parts chain into the whole turn.
 */

/** The choices of both sides, as the stream writes them (`>p1 move 1`). */
export interface BlockCommands { p1: string; p2: string }

/**
 * The dice the log shows for a block: its lines and the commands the log's players sent, read against the battle that stands at the
 * move request of that turn (it names the clicked moves, the checks and the stalling conditions the log cannot).
 */
export function forcedTurnDice(battle: Battle, lines: readonly string[], choices: BlockCommands): ForcedDie[] {
  return loggedDice(lines, loggedOptions(battle, choices));
}

/** The commands on a copy of the battle, as the stream writes them to the live one; a refused choice ends the play. */
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
  /** Writes the commands to the live battle (the stream's `writeSim`). */
  write: () => void;
  observe?: ForcedTurnInput['observe'];
  onDraw?: ForcedTurnInput['onDraw'];
}

/** One part of a block: the natural turn on a copy (a choice the copy refuses throws before the live battle is touched), then the real one. */
export function playBlockPart({ live, dice, commands, write, observe, onDraw }: BlockPart): DiceReport {
  return playForcedTurn({ live, forced: dice, observe, onDraw, play: battle => (battle === live ? write() : chooseOnCopy(battle, commands)) });
}

/**
 * A part of a block written to the live battle through the dice module. False means the module could not play it: the natural turn threw
 * (a choice the simulator refuses) before the live battle got anything, so the caller may write the part plain or search a seed. A throw
 * after the live write counts as played.
 */
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


/** What the log says about a side's bench for one block, read when a forced replacement first needs it. */
export function protocolBenchOf(replayLog: string, lines: readonly string[], turn: number): (side: 'p1' | 'p2') => ProtocolBench {
  const cache: Partial<Record<'p1' | 'p2', ProtocolBench>> = {};
  return side => (cache[side] ??= { shown: shownBodyIds(replayLog, side), fainted: faintedSlots(lines, side), goesOn: logGoesOn(replayLog, turn) });
}

/** The choice as `applyChoice` submits it, so the natural turn's copy takes the same command the live copy does. */
function submittable(battle: Battle, side: 'p1' | 'p2', choice: string): string {
  const [first] = choice.split(' > ');
  return submittableChoice(battle.sides[sideIndex(side)], first);
}

/** A forced slot whose body fainted: the request of a knockout (a pivot's or an ejected body's request has a living body in the slot). */
function opensKnockout(battle: Battle): boolean {
  return [0, 1].some(index =>
    forceSwitches(battle as SimBattle, index).some((needed, slot) => needed && !!battle.sides[index].active[slot]?.fainted));
}

export interface BlockOnCopy {
  copy: Battle;
  dice: readonly ForcedDie[];
  choices: BlockCommands;
  /** The species the log sends in for each forced replacement, per side. */
  forced: { p1: string[]; p2: string[] };
  bench?: (side: 'p1' | 'p2') => ProtocolBench | undefined;
  observe?: ForcedTurnInput['observe'];
  onDraw?: ForcedTurnInput['onDraw'];
  /** Runs one part; the caller wraps it (the arrival mutes its recorder's own stream while a forced part plays). */
  around?: (run: () => void) => void;
  /** Round 86 (T304): stop where a knockout opens a replacement request, the position the sweep's replacement round prices. A pivot's request is answered as the log answers it. */
  stopAtRequest?: boolean;
}

/**
 * Round 86 (the log's dice, T306): the whole block on a copy of the position, part by part as the rebuild plays it live (the choices of both
 * sides, then every answer to a forced replacement the log gives), each part through the dice module with the block's whole list. Throws where
 * the copy refuses a choice. The reports of every part, in order.
 */
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

/** What the faint step needs of a block: the position at its move request, the log's events, the hidden dice's seed, and the answers the rebuild gives. */
export interface BlockQuery {
  battle: Battle;
  expected: ProtocolEvents;
  seed: PRNGSeed;
  choices: BlockCommands;
  /** The lines of the block in the log: a proc die the forced turn draws and no line names is forced not to happen (`quietProcs`). */
  lines?: readonly string[];
  /** The species the log sends in for each forced replacement, per side. */
  forced?: { p1: string[]; p2: string[] };
  bench?: (side: 'p1' | 'p2') => ProtocolBench | undefined;
}

/**
 * `dice` null: the forced turn ends a game the log goes on past, and the seed search takes the block. `quiet`: the proc dice added to the list.
 * `seed`: the hidden dice the list plays under; the query's seed unless the hybrid search (ruling C2) found another that fits the log better.
 */
export interface FaintStepResult { dice: ForcedDie[] | null; plays: number; quiet: number; seed: PRNGSeed }

/** The damage rolls the forced turn drew, by die key: the name and the raw value of the first draw. */
type Rolls = Map<string, { name: DieName; value: number }>;

interface Trial { events: ProtocolEvents; rolls: Rolls; procs: Map<string, DieName>; reports: DieReport[]; log: readonly string[] }

/** One play of the whole block with a list of dice on a fork of the position; null where the copy cannot play it. */
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

/** The idents (`p1:name`, the form of the alignment's faint events) of the bodies that stood in each slot at the block's start or came in during it. */
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

/** The steps a hit may take: all of them where the roll has 16 or fewer, 16 spread over the range where it has more (Gens 1 and 2 draw 39 values). */
function stepGrid(steps: number): number[] {
  if (steps <= 16) return Array.from({ length: steps }, (_, step) => step);
  return Array.from({ length: 16 }, (_, index) => Math.round((index * (steps - 1)) / 15));
}

interface Hit { name: DieName; order: number[] }

/**
 * The bodies a mismatch of the trial points at. `up`: the log knocked the body out and the trial left it standing, so its hits must hit
 * harder. `down`: the trial knocked it out and the log did not, or a die the log shows could not land on it (the body fell first), so its
 * hits must hit softer.
 */
interface Targets { up: ReadonlySet<string>; down: ReadonlySet<string> }

/**
 * The damage-roll dice of the forced turn that hit a body of the mismatch, each with its steps in the order the faint step tries them: the
 * step the turn took first (the trial already played it), then the steps in the direction the log's faint asks for, nearest first. The
 * search moves every hit one place along its order at a time, clamped at the end of the roll, so a body that two hits decide gets the
 * highest roll of one hit and the middle roll of the other.
 */
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

/** One seed's turn: the list of dice with the phantom procs added, the trial that list plays, and what it cost. */
interface Settled { dice: readonly ForcedDie[]; trial: Trial | null; plays: number; quiet: number }

/**
 * Round 86 (T306, the phantom procs): a proc die the forced turn drew and the log does not show is forced not to happen, and the turn is
 * played again (a proc that stays away can let a body act that the proc stopped, and that body's hit draws its own procs: at most three
 * passes). A proc die belongs to the hidden dice of a seed, so every seed of the hybrid search settles its own.
 */
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

/** What the faint step keeps while it searches: the list of dice, the seed it plays under, its trial and the trial's score against the log. */
interface Best { dice: readonly ForcedDie[]; seed: PRNGSeed; trial: Trial; score: AlignmentScore; quiet: number }

/**
 * Round 86 (the log's dice, T306, gate answer 2b with the rulings Q2 and Q3): the faint step. The log's dice leave the damage roll to the
 * hidden dice of the seed, and a roll can knock out a body the log's roll left standing, or the other way round. This plays the block on
 * copies, with the same parts the rebuild plays: when the forced turn is the log's turn (a perfect score) the list stays. When a faint
 * differs, or a die the log shows could not land (a burn on a body the simulator's roll knocked out first), it forces the damage roll of
 * the hits on those bodies, from the natural step in the direction the log's faint asks for, and keeps the first set of steps under which the turn is the log's turn
 * (faints and every die). Round 86 (ruling C1): without such a set, the first one that gives the log's faints and no ended mismatch with no more soft
 * mismatches than the natural turn has stands; one that misses a logged faint never does. None: the forced result stays, a named residual. A forced turn that ends a game the log goes on past is no
 * residual: `dice` null sends the block to the seed search, like a turn the copy cannot play.
 *
 * Round 86 (ruling C2, the hybrid): a turn that is still imperfect after the steps plays under seeds 1 to 15 of `ALIGNMENT_SEEDS` for the
 * dice no `DieKind` names (a sleep duration, the lock of Outrage and its random target, the move Metronome calls), with the forced list
 * kept, and keeps the best by (ended, faint, soft); a tie keeps the earlier seed, so seed 0 stays unless another is strictly better. The
 * result carries the seed the rebuild and the arrival play under.
 *
 * One function for the rebuild and the arrival, so both find the same steps and the same seed. At most one play of the forced turn, up to
 * three more for the phantom procs, fifteen of the steps, and for each of the fifteen seeds one play and up to three more for its procs.
 */
export function faintStep(query: BlockQuery, forced: readonly ForcedDie[]): FaintStepResult {
  let checkpoint: string;
  try {
    checkpoint = serializeBattleStable(query.battle);
  } catch {
    return { dice: [...forced], plays: 0, quiet: 0, seed: query.seed };
  }
  const first = settle(checkpoint, query, query.seed, forced);
  // a block the copy cannot play stays as it is: the live write refuses it the same way and the caller's fallback takes over
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

/**
 * The faint step's roll steps on the seed of the query: the forced damage roll of the hits on the bodies of the mismatch, each set tried in turn.
 * Round 86 (ruling C1): a set also stands when it is no perfect turn but gives the log's faints, no ended mismatch and no more soft
 * mismatches than the natural turn has (a soft mismatch no die mends, a body that acts in another order, must not cost the faint). The first
 * such set (`accepted`) stays unless a later one is perfect (`perfect`, which ends the search); a set that misses a logged faint is never taken.
 */
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
  // Round 86 (B12): the last step is the extreme of every order. When even it misses a logged faint, no step between gives the faints, and the steps stop at this one play.
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

/** Round 86 (ruling C2): seeds 1 to 15 for the dice no `DieKind` names, each with its own phantom procs; the strictly better score replaces, the first perfect one ends the search. */
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
