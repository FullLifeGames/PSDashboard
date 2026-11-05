import type { Battle, PRNG } from '@pkmn/sim';
import { LoggedRollPRNG } from '../branch/logged-rolls.ts';
import { copyOf } from '../sim-ask/copy.ts';
import { learnHitCount, learnOption, type LearnInput, type LearnOptionInput } from './learn.ts';
import { ForcedDicePRNG, RecordingPRNG } from './prng.ts';
import { rollsAtTurnStart } from './recognize.ts';
import { reportOf } from './report.ts';
import { actionOrder } from './report-turn.ts';
import { readsStartRoll } from './start-roll.ts';
import { probeCheck } from './status-probe.ts';
import { dieKey, type DiceReport, type DieName, type Draw, type ForcedDie, type NaturalRecord } from './types.ts';
import { watchBattle } from './watch.ts';

/**
 * Round 82 (forced dice), decisions D5, D7 and D8: one forced turn. The caller's `play` writes both sides' choices to a
 * battle and lets the turn run; the module plays it twice.
 *
 * 1. The natural turn on a copy of the battle, with a stream at the live PRNG's place (`LoggedRollPRNG.fork()` on a
 *    branch's first turn, the plain clone otherwise), under watch: every die it draws is written down under its name.
 * 2. The real turn on the live battle, under watch, with `ForcedDicePRNG` over the live PRNG: a forced die answers as forced,
 *    every other recognized die answers what the natural turn drew for it, and the rest follows the stream.
 *
 * Afterwards the live PRNG is the battle's own again and its seed is the natural turn's end seed: a forced die that changes
 * the number of draws (a forced hit after a natural miss adds a crit and a roll) moves no later die of the branch.
 *
 * A turn with nothing forced is today's turn: `play` runs on the live battle and nothing else happens.
 */

export interface ForcedTurnInput {
  live: Battle;
  forced: readonly ForcedDie[];
  /** Writes the choices of both sides to the battle it gets and plays the turn out; runs twice, on a copy and on the live battle. */
  play: (battle: Battle) => void;
  /**
   * Round 86 (the log's dice, T306): told every draw of the real turn with the answer the turn took (a forced die's answer, not the
   * stream's value). The arrival records the draws of the turn the log's dice force, so an action the user leaves as logged rolls the same.
   */
  observe?: (from: number | undefined, to: number | undefined, value: number) => void;
  /**
   * Round 86 (T306): told every recognized die of the real turn with the raw value the turn took. The faint step reads the damage rolls
   * the forced turn really draws (the log's dice can add a hit the natural turn lacks) and the step each one took.
   */
  onDraw?: (name: DieName, value: number) => void;
}

/** The real turn's PRNG that reports each answer it gives, and each die it names. */
class ObservedForcedPRNG extends ForcedDicePRNG {
  private readonly hooks: Pick<ForcedTurnInput, 'observe' | 'onDraw'>;

  constructor(input: ConstructorParameters<typeof ForcedDicePRNG>[0], hooks: Pick<ForcedTurnInput, 'observe' | 'onDraw'>) {
    super(input);
    this.hooks = hooks;
  }

  override random(from?: number, to?: number): number {
    const value = super.random(from, to);
    this.hooks.observe?.(from, to, value);
    return value;
  }

  protected override decide(name: DieName, draw: Draw, natural: number): number {
    const value = super.decide(name, draw, natural);
    this.hooks.onDraw?.(name, value);
    return value;
  }
}

/** A stream at the PRNG's place, attached to the battle it will play on. */
function forkPrng(prng: PRNG, battle: Battle): PRNG {
  const fork = prng instanceof LoggedRollPRNG ? prng.fork() : prng.clone();
  if (fork instanceof LoggedRollPRNG) fork.attach(battle);
  return fork;
}

/** The die of Gens 2 and 3 that lets a Quick Claw holder act first, kept on the battle (the simulator reads it in the action speed). */
type StartRoll = { quickClawRoll?: boolean };

/** What the natural turn on a copy showed: the dice it drew (names, chances, answers), the speed ties, who acted, where the stream ended. */
export interface NaturalTurn {
  record: NaturalRecord;
  endSeed: string;
  startRoll: boolean | undefined;
  names: ReadonlyMap<string, DieName>;
  chances: ReadonlyMap<string, number>;
  /** The slots of the move actions of every shuffle that held two or more of them. */
  ties: readonly (readonly string[])[];
  /** The slots of the bodies that acted, in order. */
  acted: readonly string[];
}

/** The natural turn: `play` runs on a copy of the battle with a stream at the live PRNG's place, under watch. The live battle is read and never written. */
export function naturalTurn(live: Battle, play: (battle: Battle) => void): NaturalTurn {
  const copy = copyOf(live);
  (copy as unknown as { debugMode: boolean }).debugMode = false;
  const stream = forkPrng(live.prng, copy);
  const watch = watchBattle(copy);
  const recording = new RecordingPRNG(stream, watch);
  copy.prng = recording;
  try {
    play(copy);
  } finally {
    watch.uninstall();
  }
  return {
    record: recording.record, endSeed: String(stream.getSeed()), startRoll: (copy as unknown as StartRoll).quickClawRoll,
    names: recording.names, chances: recording.chances, ties: recording.ties, acted: actionOrder(copy.log),
  };
}

/**
 * The raw answers of the dice that learn theirs on copies (decision D6): a hit count whose draws the module cannot name by
 * the draw alone (Loaded Dice adds a second draw, Population Bomb draws `random(7)`), and a status word (Effect Spore compares
 * one number with thresholds). `null` marks a result no draws reach.
 */
function learnedScripts(input: Omit<LearnInput, 'fork' | 'die'>): Map<string, readonly number[] | null> {
  const scripts = new Map<string, readonly number[] | null>();
  for (const die of input.forced) {
    if (die.name.kind === 'hit-count' && 'hits' in die.result) {
      scripts.set(dieKey(die.name), learnHitCount({ ...input, fork: forkPrng, die: die as LearnInput['die'] }));
    }
    if (die.name.kind === 'ability-proc' && 'option' in die.result) {
      scripts.set(dieKey(die.name), learnOption({ ...input, fork: forkPrng, die: die as LearnOptionInput['die'] }));
    }
  }
  return scripts;
}

/**
 * Gens 2 and 3 draw the die that lets a holder act first at the start of the turn, outside any action, and keep it on the
 * battle: the real turn reads the forced answer from there (one roll for every holder on the field: any forced yes wins). The
 * natural turn on the copy keeps the value the battle drew. A body whose action speed does not read the roll has no die. Returns
 * the keys of the dice written this way.
 */
function writeStartRoll(live: Battle, forced: readonly ForcedDie[]): Set<string> {
  const written = new Set<string>();
  if (!rollsAtTurnStart(live.gen)) return written;
  let roll: boolean | undefined;
  for (const die of forced) {
    if (die.name.kind !== 'move-first' || !('happens' in die.result) || !readsStartRoll(live, die.name.slot)) continue;
    written.add(dieKey(die.name));
    roll = (roll ?? false) || die.result.happens;
  }
  if (roll !== undefined) (live as unknown as StartRoll).quickClawRoll = roll;
  return written;
}

/** Which way each forced status check goes: whether the body acts when the draw comes true, read from the condition's own handler. */
function checkPolarities(live: Battle, forced: readonly ForcedDie[]): Map<string, boolean> {
  const polarities = new Map<string, boolean>();
  for (const die of forced) {
    if (die.name.kind !== 'status-check' || !die.name.effectId) continue;
    const probe = probeCheck(live, die.name.slot, die.name.effectId, die.name.moveId);
    if (probe) polarities.set(dieKey(die.name), probe.actsOnTrue);
  }
  return polarities;
}

export function playForcedTurn({ live, forced, play, observe, onDraw }: ForcedTurnInput): DiceReport {
  if (forced.length === 0 && !observe && !onDraw) {
    play(live);
    return { forced: [], naturalEndSeed: String(live.prng.getSeed()) };
  }
  const natural = naturalTurn(live, play);
  const inner = live.prng;
  const written = writeStartRoll(live, forced);
  const watch = watchBattle(live);
  const start = live.log.length;
  const scripts = learnedScripts({ live, forced, record: natural.record, play });
  const actsOnTrue = checkPolarities(live, forced);
  const input = { inner, watch, forced, record: natural.record, scripts, actsOnTrue };
  const prng = observe || onDraw ? new ObservedForcedPRNG(input, { observe, onDraw }) : new ForcedDicePRNG(input);
  live.prng = prng;
  try {
    play(live);
  } finally {
    watch.uninstall();
    live.prng = inner;
  }
  inner.setSeed(natural.endSeed as Parameters<PRNG['setSeed']>[0]);
  // the roll of the next turn was drawn at the end of the real turn from a stream the forced die may have moved: the natural one stands
  if (natural.startRoll !== undefined) (live as unknown as StartRoll).quickClawRoll = natural.startRoll;
  return {
    forced: forced.map(die => reportOf({
      die, note: prng.notes.get(dieKey(die.name)), battle: live, start, saw: watch.moves, startRoll: written.has(dieKey(die.name)),
    })),
    naturalEndSeed: natural.endSeed,
  };
}
