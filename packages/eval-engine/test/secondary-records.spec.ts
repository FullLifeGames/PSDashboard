import type { Battle } from '@pkmn/sim';
import { describe, expect, test } from 'vitest';
import { createMatchupCache } from '../src/eval-function';
import { secondaryEffectId } from '../src/dice/recognize';
import { advancePositionWithLog } from '../src/forward-model';
import { loadSimMods } from '../src/forward/sim-mods';
import { DiceSink } from '../src/forward/scripted-prng';
import { drawPair } from '../src/pair/draw';
import { SWEEPS_FULL, type Mode } from './dice-fixtures';
import {
  clicksAccepted, effectShown, isCharge, isDelayed, SWEEP_CASES, sweepBoard, sweepClicks, sweepMoves, type DexMove, type SecondaryEntry,
} from './dice-sweep-support';
import { entriesOf, FAST, rootOf, toleranceOf } from './secondary-classes-support';

/**
 * Round 86 (T305), step A5a: the record of the secondary dice. A class draw hands the fork a `DiceSink` as its scripts and reads
 * `sink.secondaries` after the advance; the doubles pair plan reads the `secondary` records of `PairPRNG`. Every generation 1 to
 * 9 and the Champions mod, singles and from Gen 3 doubles, over the moves whose entry the protocol shows by a standard line:
 *
 * - the sink changes nothing the simulator can see (the same log as the plain fork, seed for seed);
 * - every record names the move's own entry (effect id, chance of the entry, the user's slot) and its `happened` is what the
 *   protocol shows: the effect on the target when it came true, no such line when it did not.
 */
await loadSimMods('gen9championsou');

const SEEDS = ['1,2,3,4', '5,6,7,8', '9,10,11,12', '13,14,15,16', '17,18,19,20', '21,22,23,24'];

const choicesOf = (mode: Mode, move: DexMove): { p1: string; p2: string } => (mode === 'singles'
  ? { p1: `move ${move.id}`, p2: 'move splash' }
  : { p1: `move ${move.id}${['normal', 'any', 'adjacentFoe'].includes(move.target) ? ' 1' : ''}, move splash`, p2: 'move splash, move splash' });

/** The log without its wall-clock lines (`|t:|`), which differ between two plays of one turn. */
const withoutClock = (log: string[]): string => log.filter(line => !line.startsWith('|t:|')).join('|');

/** An entry whose effect the protocol shows by a standard line on the target. */
const witnessed = (entry: SecondaryEntry): boolean =>
  entry.chance !== undefined && entry.chance < 100 && !entry.self && !!(entry.status || entry.volatileStatus === 'flinch' || entry.boosts);

interface Seen { effectId: string; chance: number; happened: boolean; slot?: string; moveId?: string; targetSlot?: string; key?: string }

/** What a draw recorded and the log of the turn, singles through the sink, doubles through the pair plan's records. */
function played(mode: Mode, board: Battle, move: DexMove, seed: string): { log: string[]; plain: string[]; seen: Seen[] } {
  const choices = choicesOf(mode, move);
  const plain = advancePositionWithLog(rootOf(board), choices.p1, choices.p2, seed).log;
  if (mode === 'singles') {
    const sink = new DiceSink();
    const { log } = advancePositionWithLog(rootOf(board), choices.p1, choices.p2, seed, { scripts: sink as never });
    return { log, plain, seen: sink.secondaries };
  }
  const drawn = drawPair(rootOf(board), choices.p1, choices.p2, seed, new Map(), createMatchupCache());
  const seen = drawn.records.flatMap(record => (record.kind === 'secondary' ? [record] : []));
  return { log: drawn.log, plain, seen };
}

describe.each(SWEEP_CASES)('the record of the secondary dice: $name', ({ rules, mode, name }) => {
  const { moves } = sweepMoves(rules, move => entriesOf(move).some(witnessed) && !isDelayed(move) && !isCharge(move) && move.priority >= 0
    && ['normal', 'any', 'adjacentFoe', 'allAdjacentFoes', 'allAdjacent'].includes(move.target));
  const sample = SWEEPS_FULL ? moves : moves.slice(0, 10);

  test(`${name}: the sink and the records leave the log as the plain fork wrote it, and say what came true`, () => {
    const problems: string[] = [];
    let recorded = 0;
    for (const move of sample) {
      const board = sweepBoard(rules, move.id, mode, '1,2,3,4', false, FAST);
      if (!clicksAccepted(board, sweepClicks(mode, move.target))) continue;
      const entries = entriesOf(move).filter(witnessed);
      for (const seed of SEEDS) {
        const { log, plain, seen } = played(mode, board, move, seed);
        if (withoutClock(log) !== withoutClock(plain)) problems.push(`${move.id} ${seed}: the recording fork wrote another log`);
        for (const record of seen) {
          // the pair plan keys a record by instance, `p1a:move>target`; a sink record names its target
          const target = record.targetSlot ?? record.key!.split('>')[1];
          const missed = log.some(line => line.startsWith(`|-miss|p1a: `) && line.includes(`|${target}: `));
          recorded++;
          const entry = entries.find(candidate => secondaryEffectId(candidate) === record.effectId);
          if (!entry) { problems.push(`${move.id} ${seed}: a record of ${record.effectId}, no such entry`); continue; }
          if (Math.abs(record.chance - (entry.chance ?? 100) / 100) > toleranceOf(rules)) problems.push(`${move.id} ${seed}: chance ${record.chance}`);
          if (missed) problems.push(`${move.id} ${seed}: a record for a move that missed`);
          const shown = effectShown({ log } as unknown as Battle, 0, entry, target, 'p1a');
          // a flinch that came true shows only if nothing else stops the target first (a freeze that came true in the same hit)
          const preempted = record.effectId === 'flinch' && log.some(line => line.startsWith('|cant|') && line.includes(`|${target}: `) && !line.endsWith('|flinch'));
          if (!preempted && entries.filter(other => secondaryEffectId(other) === record.effectId).length === 1 && shown !== record.happened) {
            problems.push(`${move.id} ${seed} ${record.effectId}: recorded ${record.happened}, the protocol shows ${shown}`);
          }
        }
      }
    }
    expect(problems.slice(0, 12).join(' | ')).toBe('');
    expect(recorded).toBeGreaterThan(0);
  });
});
