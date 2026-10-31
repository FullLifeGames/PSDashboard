import type { Battle, PRNG } from '@pkmn/sim';
import { LoggedRollPRNG } from '../branch/logged-rolls.ts';
import { copyOf } from '../sim-ask/copy.ts';
import { learnHitCount } from './learn.ts';
import { ForcedDicePRNG, RecordingPRNG } from './prng.ts';
import { rollsAtTurnStart } from './recognize.ts';
import { reportOf } from './report.ts';
import { readsStartRoll } from './start-roll.ts';
import { probeCheck } from './status-probe.ts';
import { dieKey, type DiceReport, type ForcedDie, type NaturalRecord } from './types.ts';
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
}

/** A stream at the PRNG's place, attached to the battle it will play on. */
function forkPrng(prng: PRNG, battle: Battle): PRNG {
  const fork = prng instanceof LoggedRollPRNG ? prng.fork() : prng.clone();
  if (fork instanceof LoggedRollPRNG) fork.attach(battle);
  return fork;
}

/** The die of Gens 2 and 3 that lets a Quick Claw holder act first, kept on the battle (the simulator reads it in the action speed). */
type StartRoll = { quickClawRoll?: boolean };

interface NaturalTurn { record: NaturalRecord; endSeed: string; startRoll: boolean | undefined }

function naturalTurn(live: Battle, play: (battle: Battle) => void): NaturalTurn {
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
  return { record: recording.record, endSeed: String(stream.getSeed()), startRoll: (copy as unknown as StartRoll).quickClawRoll };
}

/**
 * The raw answers of the dice that learn theirs on copies (decision D6): a hit count whose draws the module cannot name by
 * the draw alone (Loaded Dice adds a second draw, Population Bomb draws `random(7)`). `null` marks a count no draws reach.
 */
function learnedScripts(input: Omit<Parameters<typeof learnHitCount>[0], 'fork' | 'die'>): Map<string, readonly number[] | null> {
  const scripts = new Map<string, readonly number[] | null>();
  for (const die of input.forced) {
    if (die.name.kind === 'hit-count' && 'hits' in die.result) {
      scripts.set(dieKey(die.name), learnHitCount({ ...input, fork: forkPrng, die: die as Parameters<typeof learnHitCount>[0]['die'] }));
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

export function playForcedTurn({ live, forced, play }: ForcedTurnInput): DiceReport {
  if (forced.length === 0) {
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
  const prng = new ForcedDicePRNG({ inner, watch, forced, record: natural.record, scripts, actsOnTrue });
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
