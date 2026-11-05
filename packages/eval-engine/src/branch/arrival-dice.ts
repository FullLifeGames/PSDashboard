import { PRNG } from '@pkmn/sim';
import { faintStep, forcedTurnDice, protocolBenchOf } from '../dice/logged-block.ts';
import { serializeBattleStable, trialAdvanceLog } from '../forward-model.ts';
import {
  ALIGNMENT_SEEDS, chooseAlignedSeed, extractProtocolEvents, type SeedChoice,
} from '../hax-alignment.ts';
import { hasForceSwitch } from './corrections.ts';
import { LoggedRollPRNG, recordForcedRolls, recordLoggedRolls } from './logged-rolls.ts';
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
  /** Round 86 (T306): `forced` when the block plays under seed index 0 with the log's dice forced, `fallback` when the seed search chose. */
  via: 'forced' | 'fallback';
}

/** What the block's lines say before any seed plays: the events the sim must reproduce and the species the log sends in for each forced replacement. */
export function blockOf(battle: SimBattle, turnBlock: TurnBlock): Pick<AlignedBlock, 'expectedEvents' | 'alignForced'> {
  return {
    expectedEvents: extractProtocolEvents([...turnBlock.preUpkeep, ...turnBlock.postUpkeep]),
    alignForced: {
      p1: collectForcedSwitchSpecies(turnBlock.preUpkeep, turnBlock.postUpkeep, 'p1', battle.dex),
      p2: collectForcedSwitchSpecies(turnBlock.preUpkeep, turnBlock.postUpkeep, 'p2', battle.dex),
    },
  };
}

/**
 * Round 86 (T306): the block played with the log's dice forced, under the hidden dice of seed index 0. There is no trial, so no score:
 * `trialPerfect` is false and `candidatesTried` 0, and the record scores the truly emitted block.
 */
export function forcedBlock(battle: SimBattle, turnBlock: TurnBlock): AlignedBlock {
  return {
    ...blockOf(battle, turnBlock), via: 'forced',
    seedChoice: { seed: ALIGNMENT_SEEDS[0], trialScore: null, trialPerfect: false, candidatesTried: 0, trialsFailed: 0 },
  };
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
  const { expectedEvents, alignForced } = blockOf(battle, turnBlock);
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
  return { expectedEvents, alignForced, seedChoice, via: 'fallback' };
}

/**
 * Round 70: puts the position of replay turn `targetTurn` on the seed that turn
 * plays under in the log, so the first turn a branch plays from here shows the
 * rolls the game showed for every action the user leaves as it was. The dice of
 * the actions before the first changed one are the logged dice, in singles and
 * in doubles; later actions draw from the same stream, so they stay deterministic
 * but are no longer the logged rolls.
 *
 * Round 86 (T306): the seed is index 0 of `ALIGNMENT_SEEDS` and the logged rolls are the draws of the turn the reconstruction plays, the
 * log's dice forced on that seed (`arrivalRolls`); the sixteen-seed search only runs when the forced turn cannot play.
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
    const p1Choice = getMainChoice(block.preUpkeep, 'p1', battle);
    const p2Choice = getMainChoice(block.preUpkeep, 'p2', battle);
    const aligned = arrivalRolls(battle, block, replayLog, p1Choice, p2Choice, shouldStop);
    if (!aligned) return null;
    const { seed } = aligned.block.seedChoice;
    if (aligned.logged) {
      const prng = new LoggedRollPRNG(seed, aligned.logged, targetTurn, {
        lines: [...block.preUpkeep, ...block.postUpkeep], choices: { p1: p1Choice, p2: p2Choice },
      });
      prng.attach(battle);
      battle.prng = prng;
    } else {
      battle.prng = new PRNG(seed);
    }
    return aligned.block.seedChoice;
  } catch {
    return null;
  }
}

/**
 * Round 86 (T306): the seed and the logged draws of the arrival turn. The turn plays as the reconstruction plays it: seed index 0 with the
 * log's dice forced (and the damage-roll steps of the faint step), and the draws it takes are the logged draws (`recordForcedRolls`). When the forced turn cannot play (the copy refuses a
 * choice, the state is odd) the sixteen-seed search of before chooses, and null comes back when no trial plays either: the fallback seed
 * is no reading of the log.
 */
function arrivalRolls(
  battle: SimBattle, block: TurnBlock, replayLog: string, p1Choice: string, p2Choice: string, shouldStop?: () => boolean,
): { block: AlignedBlock; logged: ReturnType<typeof recordLoggedRolls> } | null {
  const forced = forcedBlock(battle, block);
  try {
    const lines = [...block.preUpkeep, ...block.postUpkeep];
    const choices = { p1: p1Choice, p2: p2Choice };
    const bench = protocolBenchOf(replayLog, lines, block.turn);
    // the faint step the rebuild took for this block (same function, same position, same seed), then the draws of that turn
    const { dice, seed } = faintStep({
      battle, expected: forced.expectedEvents, seed: forced.seedChoice.seed, choices, lines, forced: forced.alignForced, bench,
    }, forcedTurnDice(battle, lines, choices));
    // Round 86 (ruling C2): the seed the step found for the dice no `DieKind` names is the seed the rebuild played the turn under
    const logged = dice && recordForcedRolls(battle, dice, seed, p1Choice, p2Choice, forced.alignForced, bench);
    if (logged) return { block: seed === forced.seedChoice.seed ? forced : { ...forced, seedChoice: { ...forced.seedChoice, seed } }, logged };
  } catch {
    // an odd state: the search below reads the block as before
  }
  const searched = alignBlockSeed(battle, block, p1Choice, p2Choice, shouldStop);
  if (searched.seedChoice.trialScore === null) return null;
  return { block: searched, logged: recordLoggedRolls(battle, searched.seedChoice.seed, p1Choice, p2Choice, searched.alignForced) };
}
