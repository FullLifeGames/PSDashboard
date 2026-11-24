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

// Design: ADR 0022.

type ExpectedEvents = ReturnType<typeof extractProtocolEvents>;

export interface AlignedBlock {
  expectedEvents: ExpectedEvents;
  alignForced: { p1: string[]; p2: string[] };
  seedChoice: SeedChoice;
  /** `forced`: seed index 0 with the log's dice forced; `fallback`: the seed search chose. */
  via: 'forced' | 'fallback';
}

export function blockOf(battle: SimBattle, turnBlock: TurnBlock): Pick<AlignedBlock, 'expectedEvents' | 'alignForced'> {
  return {
    expectedEvents: extractProtocolEvents([...turnBlock.preUpkeep, ...turnBlock.postUpkeep]),
    alignForced: {
      p1: collectForcedSwitchSpecies(turnBlock.preUpkeep, turnBlock.postUpkeep, 'p1', battle.dex),
      p2: collectForcedSwitchSpecies(turnBlock.preUpkeep, turnBlock.postUpkeep, 'p2', battle.dex),
    },
  };
}

export function forcedBlock(battle: SimBattle, turnBlock: TurnBlock): AlignedBlock {
  return {
    ...blockOf(battle, turnBlock), via: 'forced',
    seedChoice: { seed: ALIGNMENT_SEEDS[0], trialScore: null, trialPerfect: false, candidatesTried: 0, trialsFailed: 0 },
  };
}

/** Picks the candidate seed whose rolls reproduce the block's protocol events; fails open to candidate 0. */
// Events are keyed by name, since the built sets carry the replay's nicknames.
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
    // Serialization failure on an odd state: the block runs under candidate 0.
  }
  return { expectedEvents, alignForced, seedChoice, via: 'fallback' };
}

/** Puts the position of replay turn `targetTurn` on the seed that turn plays under in the log; null: unchanged. */
// A direct PRNG swap, not `resetRNG`, which writes a message line into the battle log (an adopted log is the replay's).
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

function arrivalRolls(
  battle: SimBattle, block: TurnBlock, replayLog: string, p1Choice: string, p2Choice: string, shouldStop?: () => boolean,
): { block: AlignedBlock; logged: ReturnType<typeof recordLoggedRolls> } | null {
  const forced = forcedBlock(battle, block);
  try {
    const lines = [...block.preUpkeep, ...block.postUpkeep];
    const choices = { p1: p1Choice, p2: p2Choice };
    const bench = protocolBenchOf(replayLog, lines, block.turn);
    const { dice, seed } = faintStep({
      battle, expected: forced.expectedEvents, seed: forced.seedChoice.seed, choices, lines, forced: forced.alignForced, bench,
    }, forcedTurnDice(battle, lines, choices));
    // The seed the step found for the dice no `DieKind` names is the seed the rebuild played the turn under.
    const logged = dice && recordForcedRolls(battle, dice, seed, p1Choice, p2Choice, forced.alignForced, bench);
    if (logged) return { block: seed === forced.seedChoice.seed ? forced : { ...forced, seedChoice: { ...forced.seedChoice, seed } }, logged };
  } catch {
    // An odd state: the search below reads the block.
  }
  const searched = alignBlockSeed(battle, block, p1Choice, p2Choice, shouldStop);
  if (searched.seedChoice.trialScore === null) return null;
  return { block: searched, logged: recordLoggedRolls(battle, searched.seedChoice.seed, p1Choice, p2Choice, searched.alignForced) };
}
