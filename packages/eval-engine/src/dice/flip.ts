import type { Battle } from '@pkmn/sim';
import { ForcedDicePRNG, RecordingPRNG } from './prng.ts';
import { dieKey, type Answer, type DieKind, type DieName, type Draw, type ForcedDie, type NaturalRecord } from './types.ts';
import { watchBattle } from './watch.ts';

/**
 * Round 89 (A6-1, ruling 24, #145): one turn, and each of its chance dice turned the other way. The endgame prover reads a turn
 * through a few draws and takes the median; a die the draws all pass the same way (a second Protect that holds one time in
 * three, a confusion's self-hit, an accuracy) then counts as certain. This module records the turn on a fork, with the dice
 * panel's recorder, and plays it again with one die answered the other way and every other named die held to the recorded
 * answer (the panel's forcing PRNG). The caller reads the board each fork ends on; nothing here reads a species or a move.
 *
 * The recorder calls the stream first on every draw, so the recorded turn is the plain turn of the same seed: same log, same
 * state, same stream at the end. A fork never touches the battle it came from: the caller hands out copies.
 */

/** A turn: `fork` gives a fresh copy at the turn's start with the stream at the turn's place (it runs once per play), `play` runs the turn on it. */
export interface FlipTurn {
  fork(): Battle;
  play(battle: Battle): void;
  /**
   * Round 89 (A6-2): the speed ties the turn is held to, by pair (the forcing PRNG's tie die: `{ first }` puts one slot ahead of the other
   * wherever both stand in a shuffle). The recording and every flip play that order; the endgame children's tie path plays each order apart.
   */
  ties?: readonly ForcedDie[];
}

/**
 * The recorder of a turn that is held to a speed tie: the forcing PRNG with an empty record (every die answers the stream's own number),
 * writing down what the recording PRNG writes down. The stream is called first on every draw, so the numbers are the natural turn's.
 */
class HeldRecordingPRNG extends ForcedDicePRNG {
  readonly names = new Map<string, DieName>();
  readonly shapes = new Map<string, Draw>();
  readonly answers = new Map<string, Answer[]>();

  protected override decide(name: DieName, draw: Draw, natural: number): number {
    const key = dieKey(name);
    this.names.set(key, name);
    if (!this.shapes.has(key)) this.shapes.set(key, { ...draw });
    const answer: Answer = { from: draw.from, to: draw.to, value: natural };
    const list = this.answers.get(key);
    if (list) list.push(answer);
    else this.answers.set(key, [answer]);
    return super.decide(name, draw, natural);
  }
}

/**
 * The dice the module does not turn: the roll facts (the damage roll, the crit and the hit count are sampled and disclosed as
 * such, ADR 0020) and the speed tie (the endgame children price it on their own path).
 */
export const ROLL_FACT_KINDS: ReadonlySet<DieKind> = new Set<DieKind>(['damage-roll', 'crit', 'hit-count', 'speed-tie']);

/** A chance die of the recorded turn. */
export interface FlipDie {
  key: string;
  name: DieName;
  /** The chance the draw comes true: the numerator over the denominator of the simulator's `randomChance`, or the entry's chance of a `random(100)` the script compares. Strictly between 0 and 1. */
  chance: number;
  /** Whether the recorded draw came true. */
  drew: boolean;
  /** The chance of the answer the recording drew. */
  held: number;
  /** The chance of the other answer, the share of the turn that plays it. */
  other: number;
}

export interface RecordedTurn {
  /** The battle at the end of the recorded turn (the stream at its own end, as a plain turn leaves it). */
  battle: Battle;
  /** `battle.log.length` before the turn: the lines from here are the turn's. */
  logStart: number;
  /** Every chance die the turn drew, in order of first draw, without the roll facts. */
  dice: FlipDie[];
  record: NaturalRecord;
  /** The slots of every shuffle of the natural turn that held two or more move actions (a speed tie), in order; empty for a turn held to its ties. */
  ties: string[][];
}

export interface FlippedTurn {
  battle: Battle;
  logStart: number;
  /** The turn drew the die and answered it the other way. False when the simulator never drew it on this branch, or the draw has no way to give the answer. */
  took: boolean;
}

/** The chance die behind a recorded name, or null when the draw is no chance or the chance is sure (0 or 1). */
function chanceDie(key: string, name: DieName, shape: Draw | undefined, first: Answer | undefined): FlipDie | null {
  if (!shape || !first) return null;
  let chance: number;
  let drew: boolean;
  if (shape.call === 'chance') {
    chance = (shape.numerator ?? 0) / (shape.from ?? 1);
    drew = first.value < (shape.numerator ?? 0);
  } else if (shape.call === 'random' && shape.chance !== undefined) {
    // a `random(from)` the script compares with the entry's chance (a secondary's percent): the value comes true below chance * from
    chance = shape.chance;
    drew = first.value < Math.round(chance * (shape.from ?? 1) * 1e4) / 1e4;
  } else return null;
  if (!(chance > 0 && chance < 1)) return null;
  return { key, name, chance, drew, held: drew ? chance : 1 - chance, other: drew ? 1 - chance : chance };
}

/** The turn on a fork under the recorder: the same turn a plain draw plays, with every named chance die written down. */
export function recordTurn(turn: FlipTurn): RecordedTurn {
  const battle = turn.fork();
  const logStart = battle.log.length;
  const inner = battle.prng;
  const watch = watchBattle(battle);
  const held = turn.ties && turn.ties.length > 0;
  const recording = held ? new HeldRecordingPRNG({ inner, watch, forced: turn.ties!, record: new Map() }) : new RecordingPRNG(inner, watch);
  battle.prng = recording;
  try {
    turn.play(battle);
  } finally {
    watch.uninstall();
    battle.prng = inner;
  }
  const dice: FlipDie[] = [];
  const record = recording instanceof HeldRecordingPRNG ? recording.answers : recording.record;
  const { names, shapes } = recording;
  for (const [key, name] of names) {
    const die = ROLL_FACT_KINDS.has(name.kind) ? null : chanceDie(key, name, shapes.get(key), record.get(key)?.[0]);
    if (die) dice.push(die);
  }
  return { battle, logStart, dice, record, ties: recording instanceof HeldRecordingPRNG ? [] : recording.ties };
}

/**
 * The recorded turn again on a fresh fork with one die answered the other way: the forced answer is the draw's own value turned
 * round (the draw's `true` is what the simulator reads, whichever way its handler goes: a status check's polarity needs no
 * reading), and every other named die answers what the recorded turn drew for it. The turn's later dice that the flip moves
 * (a die that the other branch never draws, one it draws anew) follow the stream.
 */
export function flipTurn(turn: FlipTurn, recorded: RecordedTurn, die: FlipDie): FlippedTurn {
  const battle = turn.fork();
  const logStart = battle.log.length;
  const inner = battle.prng;
  const watch = watchBattle(battle);
  const forcing = new ForcedDicePRNG({
    inner, watch, record: recorded.record,
    forced: [{ name: die.name, result: { happens: !die.drew } }, ...(turn.ties ?? [])],
    // raw answers: "happens" is the draw's own true, for a status check too (its polarity is a question for the handler, not for us)
    actsOnTrue: new Map([[die.key, true]]),
  });
  battle.prng = forcing;
  try {
    turn.play(battle);
  } finally {
    watch.uninstall();
    battle.prng = inner;
  }
  const note = forcing.notes.get(dieKey(die.name));
  return { battle, logStart, took: !!note && note.draws > 0 && !note.noChance && !note.unfit };
}
