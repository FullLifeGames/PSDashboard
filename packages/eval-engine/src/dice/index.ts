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
export { learnHitCount, type LearnInput } from './learn.ts';
export { offeredDice, offeredOrderDice, type DieOffer } from './offer.ts';
export { probeCheck, type CheckProbe } from './status-probe.ts';
export { readsStartRoll } from './start-roll.ts';
export { secondaryEffectId } from './recognize.ts';
