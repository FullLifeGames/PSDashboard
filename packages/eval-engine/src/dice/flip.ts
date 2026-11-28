import type { Battle } from '@pkmn/sim';
import { ForcedDicePRNG, RecordingPRNG } from './prng.ts';
import { dieKey, type Answer, type DieKind, type DieName, type Draw, type ForcedDie, type NaturalRecord } from './types.ts';
import { watchBattle } from './watch.ts';


/** `fork` gives a fresh copy at the turn's start with the stream at its place (once per play); `play` runs it. */
export interface FlipTurn {
  fork(): Battle;
  play(battle: Battle): void;
  /** The speed ties the turn is held to, by pair (`{ first }` puts one slot ahead); every play keeps that order. */
  ties?: readonly ForcedDie[];
  /** Chance dice held to an answer; `happens` is what the draw itself reads, a status check's included. */
  held?: readonly ForcedDie[];
}

const rawKeys = (dice: readonly ForcedDie[] | undefined): [string, true][] => (dice ?? []).map(die => [dieKey(die.name), true]);

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

/** The dice the module does not turn: the roll facts (sampled and disclosed as such, ADR 0020) and the speed tie. */
export const ROLL_FACT_KINDS: ReadonlySet<DieKind> = new Set<DieKind>(['damage-roll', 'crit', 'hit-count', 'speed-tie']);

export interface FlipDie {
  key: string;
  name: DieName;
  /** The chance the draw comes true: numerator over denominator, or the entry's chance of a random(100); in (0, 1). */
  chance: number;
  drew: boolean;
  held: number;
  other: number;
}

export interface RecordedTurn {
  battle: Battle;
  /** `battle.log.length` before the turn. */
  logStart: number;
  /** Chance dice drawn once, in order of first draw, without the roll facts. */
  dice: FlipDie[];
  /** Chance dice drawn more than once under one name: the flip forces every draw, so no single chance prices them. */
  repeated: FlipDie[];
  record: NaturalRecord;
  /** The slots of each shuffle that held two or more move actions (a speed tie); empty for a turn held to its ties. */
  ties: string[][];
}

export interface FlippedTurn {
  battle: Battle;
  logStart: number;
  /** False when the simulator never drew the die on this branch, or the draw cannot give the answer. */
  took: boolean;
  /** The other dice this branch drew; a die it never reached (a knocked-out paralysis) is no part of its chance. */
  drawn: ReadonlySet<string>;
}

function chanceDie(key: string, name: DieName, shape: Draw | undefined, first: Answer | undefined): FlipDie | null {
  if (!shape || !first) return null;
  let chance: number;
  let drew: boolean;
  if (shape.call === 'chance') {
    chance = (shape.numerator ?? 0) / (shape.from ?? 1);
    drew = first.value < (shape.numerator ?? 0);
  } else if (shape.call === 'random' && shape.chance !== undefined) {
    chance = shape.chance;
    drew = first.value < Math.round(chance * (shape.from ?? 1) * 1e4) / 1e4;
  } else return null;
  if (!(chance > 0 && chance < 1)) return null;
  return { key, name, chance, drew, held: drew ? chance : 1 - chance, other: drew ? 1 - chance : chance };
}

export function recordTurn(turn: FlipTurn): RecordedTurn {
  const battle = turn.fork();
  const logStart = battle.log.length;
  const inner = battle.prng;
  const watch = watchBattle(battle);
  const forced = [...(turn.ties ?? []), ...(turn.held ?? [])];
  const recording = forced.length > 0
    ? new HeldRecordingPRNG({ inner, watch, forced, record: new Map(), actsOnTrue: new Map(rawKeys(turn.held)) })
    : new RecordingPRNG(inner, watch);
  battle.prng = recording;
  try {
    turn.play(battle);
  } finally {
    watch.uninstall();
    battle.prng = inner;
  }
  const dice: FlipDie[] = [];
  const repeated: FlipDie[] = [];
  const record = recording instanceof HeldRecordingPRNG ? recording.answers : recording.record;
  const { names, shapes } = recording;
  for (const [key, name] of names) {
    const die = ROLL_FACT_KINDS.has(name.kind) ? null : chanceDie(key, name, shapes.get(key), record.get(key)?.[0]);
    if (die) (record.get(key)!.length > 1 ? repeated : dice).push(die);
  }
  return { battle, logStart, dice, repeated, record, ties: recording instanceof HeldRecordingPRNG ? [] : recording.ties };
}

// The forced answer is the draw's own value turned round: `true` is what the simulator reads, whichever way it goes.
export function flipTurn(turn: FlipTurn, recorded: RecordedTurn, die: FlipDie): FlippedTurn {
  const battle = turn.fork();
  const logStart = battle.log.length;
  const inner = battle.prng;
  const watch = watchBattle(battle);
  const forcing = new ForcedDicePRNG({
    inner, watch, record: recorded.record,
    forced: [{ name: die.name, result: { happens: !die.drew } }, ...(turn.ties ?? []), ...(turn.held ?? [])],
    actsOnTrue: new Map([[die.key, true], ...rawKeys(turn.held)]),
  });
  battle.prng = forcing;
  try {
    turn.play(battle);
  } finally {
    watch.uninstall();
    battle.prng = inner;
  }
  const note = forcing.notes.get(dieKey(die.name));
  return { battle, logStart, took: !!note && note.draws > 0 && !note.noChance && !note.unfit, drawn: forcing.drawnKeys() };
}
