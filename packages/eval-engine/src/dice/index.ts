/**
 * Round 82 (forced dice): the dice module's barrel. The package barrel exports it in step A6; the app loads it with a
 * dynamic import only when a branch turn carries a forced die (decision D11).
 */
export { answerDie, type Answered } from './answer.ts';
export { playForcedTurn, type ForcedTurnInput } from './play.ts';
export { ForcedDicePRNG, RecordingPRNG, type DieNote } from './prng.ts';
export { genShape, recognize } from './recognize.ts';
export { reportOf, type ReportInput } from './report.ts';
export {
  dieKey, tieName,
  type Answer, type DiceReport, type DieKind, type DieName, type DieReport, type DieResult, type DieTook, type Draw,
  type ForcedDie, type NaturalRecord,
} from './types.ts';
export { watchBattle, type ArmedHook, type BattleWatch } from './watch.ts';
export { learnHitCount, learnOption, reachableOptions, type LearnInput, type LearnOptionInput } from './learn.ts';
export { offeredDice, offeredEndDice, offeredOrderDice, type DieOffer } from './offer.ts';
export { probeCheck, type CheckProbe } from './status-probe.ts';
export { readsStartRoll } from './start-roll.ts';
export { secondaryEffectId } from './recognize.ts';
export { loggedActions, loggedDice, mergeLoggedDice, type LoggedAction, type LoggedOptions, type MergeInput } from './logged-results.ts';
export { dieLabel, type DieWords } from './die-label.ts';
export { chainCount, chainResults, type HitResult } from './chain.ts';
export { secondariesIn } from './secondaries.ts';
export { FIRST_TURN_JOINS_LOG, loggedDiceAt, loggedTurnDice, playBranchTurn, turnChanges, userDice, type BranchTurnInput, type BranchTurnResult, type PendingTurn } from './turn.ts';
export { DIE_KINDS } from './types.ts';
