import type { Battle, PRNG } from '@pkmn/sim';
import { LoggedRollPRNG } from '../branch/logged-rolls.ts';
import { copyOf } from '../sim-ask/copy.ts';
import { learnHitCount } from './learn.ts';
import { ForcedDicePRNG, RecordingPRNG } from './prng.ts';
import { reportOf } from './report.ts';
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

function naturalTurn(live: Battle, play: (battle: Battle) => void): { record: NaturalRecord; endSeed: string } {
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
  return { record: recording.record, endSeed: String(stream.getSeed()) };
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

export function playForcedTurn({ live, forced, play }: ForcedTurnInput): DiceReport {
  if (forced.length === 0) {
    play(live);
    return { forced: [], naturalEndSeed: String(live.prng.getSeed()) };
  }
  const natural = naturalTurn(live, play);
  const inner = live.prng;
  const watch = watchBattle(live);
  const start = live.log.length;
  const scripts = learnedScripts({ live, forced, record: natural.record, play });
  const prng = new ForcedDicePRNG({ inner, watch, forced, record: natural.record, scripts });
  live.prng = prng;
  try {
    play(live);
  } finally {
    watch.uninstall();
    live.prng = inner;
  }
  inner.setSeed(natural.endSeed as Parameters<PRNG['setSeed']>[0]);
  return {
    forced: forced.map(die => reportOf({ die, note: prng.notes.get(dieKey(die.name)), battle: live, start, saw: watch.moves })),
    naturalEndSeed: natural.endSeed,
  };
}
