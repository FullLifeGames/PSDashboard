import { PRNG } from '@pkmn/sim';
import { serializeBattleStable, trialAdvanceLog } from '../forward-model.ts';
import {
  ALIGNMENT_SEEDS, chooseAlignedSeed, extractProtocolEvents, type SeedChoice,
} from '../hax-alignment.ts';
import { hasForceSwitch } from './corrections.ts';
import { collectForcedSwitchSpecies, getMainChoice, parseTurnBlocks } from './protocol-choices.ts';
import type { SimBattle, TurnBlock } from './types.ts';

/**
 * The dice of a logged turn (hax alignment). The reconstruction replays the
 * real game's choices but the sim rolls its own crits, misses and secondary
 * effects, so every block plays under the candidate seed whose rolls
 * reproduce the block's protocol events (spec 2026-08-15-hax-alignment-design.md).
 * The same choice serves the position a branch opens on (round 70): the first
 * turn the user plays from turn N is turn N of the log, and a flinch the log
 * does not show must not appear in it because the position carried the seed
 * the reconstruction started on.
 */

type ExpectedEvents = ReturnType<typeof extractProtocolEvents>;

export interface AlignedBlock {
  expectedEvents: ExpectedEvents;
  alignForced: { p1: string[]; p2: string[] };
  seedChoice: SeedChoice;
}

/**
 * Picks the candidate seed whose rolls reproduce this block's protocol events
 * (crits/misses/secondaries/faints), with the block's logged choices. The
 * events are keyed by name: the built sets carry the replay's nicknames
 * (round 72, T238), so the block's lines meet the sim's as they are (before,
 * a nicknamed body's events never met the sim's, round 67, G4). Fail-open:
 * when no trial runs, candidate 0 (1,2,3,4) stays.
 */
export function alignBlockSeed(
  battle: SimBattle, turnBlock: TurnBlock, p1Choice: string, p2Choice: string,
  shouldStop?: () => boolean,
): AlignedBlock {
  const expectedEvents = extractProtocolEvents([...turnBlock.preUpkeep, ...turnBlock.postUpkeep]);
  const alignForced = {
    p1: collectForcedSwitchSpecies(turnBlock.preUpkeep, turnBlock.postUpkeep, 'p1'),
    p2: collectForcedSwitchSpecies(turnBlock.preUpkeep, turnBlock.postUpkeep, 'p2'),
  };
  let seedChoice: SeedChoice = {
    seed: ALIGNMENT_SEEDS[0], trialScore: null, trialPerfect: false,
    candidatesTried: 0, trialsFailed: 0,
  };
  try {
    const checkpoint = serializeBattleStable(battle);
    seedChoice = chooseAlignedSeed({
      expected: expectedEvents,
      trial: seed => {
        try {
          return trialAdvanceLog(
            { serialized: checkpoint }, p1Choice, p2Choice, seed,
            { p1: [...alignForced.p1], p2: [...alignForced.p2] },
          );
        } catch {
          return null;
        }
      },
      shouldStop,
    });
  } catch {
    // Serialization failure on an odd state: run the block exactly as today.
  }
  return { expectedEvents, alignForced, seedChoice };
}

/**
 * Round 70: puts the position of replay turn `targetTurn` on the seed that turn
 * plays under in the log, so the first turn a branch plays from here shows the
 * rolls the game showed for every action the user leaves as it was. The dice of
 * the actions before the first changed one are the logged dice, in singles and
 * in doubles; later actions draw from the same stream, so they stay deterministic
 * but are no longer the logged rolls.
 *
 * A direct PRNG swap, not `resetRNG`: that one writes a message line into the
 * battle log, and an adopted position's log is the replay's. Null (nothing
 * changed) when the battle does not stand at the turn's move request: ended,
 * another turn, a forced replacement pending, or a turn the log does not have;
 * when no trial could play the logged choices (an edited set that lost the
 * logged move), since the fallback seed is no reading of the log; and when
 * reading the block's choices fails on an odd state, which must never cost the
 * branch its position.
 */
export function alignArrivalDice(
  battle: SimBattle, replayLog: string, targetTurn: number, shouldStop?: () => boolean,
): SeedChoice | null {
  if (battle.ended || battle.turn !== targetTurn || battle.requestState !== 'move') return null;
  if (hasForceSwitch(battle, 0) || hasForceSwitch(battle, 1)) return null;
  const block = parseTurnBlocks(replayLog).turns.find(entry => entry.turn === targetTurn);
  if (!block) return null;
  try {
    const aligned = alignBlockSeed(
      battle, block, getMainChoice(block.preUpkeep, 'p1', battle), getMainChoice(block.preUpkeep, 'p2', battle),
      shouldStop,
    );
    if (aligned.seedChoice.trialScore === null) return null;
    battle.prng = new PRNG(aligned.seedChoice.seed);
    return aligned.seedChoice;
  } catch {
    return null;
  }
}
