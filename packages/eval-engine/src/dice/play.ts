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

/** One forced turn: the natural turn on a copy, then the real turn on the live battle with the forced dice. */

export interface ForcedTurnInput {
  live: Battle;
  forced: readonly ForcedDie[];
  /** Writes both sides' choices and plays the turn out; it runs twice, on a copy and on the live battle. */
  play: (battle: Battle) => void;
  /** Every draw of the real turn with the answer the turn took (a forced die's answer, not the stream's value). */
  observe?: (from: number | undefined, to: number | undefined, value: number) => void;
  onDraw?: (name: DieName, value: number, draw: Draw) => void;
}

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
    this.hooks.onDraw?.(name, value, draw);
    return value;
  }
}

function forkPrng(prng: PRNG, battle: Battle): PRNG {
  const fork = prng instanceof LoggedRollPRNG ? prng.fork() : prng.clone();
  if (fork instanceof LoggedRollPRNG) fork.attach(battle);
  return fork;
}

// Gens 2 and 3: the Quick Claw roll kept on the battle, which the simulator reads in the action speed.
type StartRoll = { quickClawRoll?: boolean };

export interface NaturalTurn {
  record: NaturalRecord;
  endSeed: string;
  startRoll: boolean | undefined;
  names: ReadonlyMap<string, DieName>;
  chances: ReadonlyMap<string, number>;
  ties: readonly (readonly string[])[];
  acted: readonly string[];
}

/** The natural turn: `play` on a copy with a stream at the live PRNG's place; the live battle is only read. */
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

// Gens 2 and 3 draw the die at the turn's start, outside any action; one roll serves every holder: any forced yes wins.
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

function checkPolarities(live: Battle, forced: readonly ForcedDie[]): Map<string, boolean> {
  const polarities = new Map<string, boolean>();
  for (const die of forced) {
    if (die.name.kind !== 'status-check' || !die.name.effectId) continue;
    const probe = probeCheck(live, die.name.slot, die.name.effectId, die.name.moveId);
    if (probe) polarities.set(dieKey(die.name), probe.actsOnTrue);
  }
  return polarities;
}

/** Plays `play` twice: the natural turn on a copy, then the real turn on the live battle with the forced dice. */
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
  // The next turn's roll came from a stream the forced die may have moved: the natural one stands.
  if (natural.startRoll !== undefined) (live as unknown as StartRoll).quickClawRoll = natural.startRoll;
  return {
    forced: forced.map(die => reportOf({
      die, note: prng.notes.get(dieKey(die.name)), battle: live, start, saw: watch.moves, startRoll: written.has(dieKey(die.name)),
    })),
    naturalEndSeed: natural.endSeed,
    ...(prng.unnamed > 0 ? { unnamed: prng.unnamed } : {}),
  };
}
