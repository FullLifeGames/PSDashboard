import { PRNG } from '@pkmn/sim';
import type { PRNGSeed } from '@pkmn/sim';
import type { MatchupCache } from '../eval-function.ts';
import { forkBattleWithPrng, positionBattle, toPosition, type SimPosition } from '../forward/position.ts';
import { answerFollowUps, applyChoice, resolveForcedSwitches } from '../forward/switches.ts';
import { leafValue } from '../search/leaf.ts';
import type { DieQuantiles } from '../search/root-quantile.ts';
import { PairPRNG, type PairRecord, type PairScripts } from './prng.ts';

/**
 * Round 56: one advance of a doubles cell under the recording dice —
 * advancePositionWithLog's turn with its rolls written down. `logIndex` in
 * the records counts from the first line of this draw.
 */

export interface PairDraw {
  child: SimPosition;
  log: string[];
  records: PairRecord[];
  leaf: number;
  ended: boolean;
}

export function drawPair(
  root: SimPosition,
  p1Choice: string,
  p2Choice: string,
  seed: PRNGSeed,
  scripts: PairScripts,
  matchupCache: MatchupCache,
): PairDraw {
  const prng = new PairPRNG(seed, scripts);
  const battle = forkBattleWithPrng(root, prng);
  const logStart = battle.log.length;
  applyChoice(battle, 'p1', p1Choice);
  applyChoice(battle, 'p2', p2Choice);
  resolveForcedSwitches(battle, seed, { p1: p1Choice.split(' > ')[1], p2: p2Choice.split(' > ')[1] });
  // The child is a plain battle again: the same seed state, no recorder attached, no watch on the battle (round 86, T299).
  prng.release();
  battle.prng = new PRNG(prng.getSeed());
  const records = prng.records.map(record => ('logIndex' in record ? { ...record, logIndex: record.logIndex - logStart } : record));
  const child = toPosition(battle);
  const childBattle = positionBattle(child);
  return { child, log: battle.log.slice(logStart), records, leaf: leafValue(childBattle, matchupCache), ended: childBattle.ended };
}

const NO_SCRIPTS: PairScripts = new Map();

/**
 * Round 86 (A9b): the tree's root draw under the pair recorder. The advance is `advancePositionWithLog`'s (the same natural stream,
 * the same forced-switch rule, a plain PRNG on the child) with the dice written down, so `readPattern` can name the draw's class
 * the way it names the sampler's. `logIndex` in the records counts from the first line of this draw. Round 89 (#59): `quantiles`
 * (a tree's root quantiles) answer the named dice after the natural draw; without them the draw is as before.
 */
export function drawKeyed(
  root: SimPosition, p1Choice: string, p2Choice: string, seed: PRNGSeed, stopAtForcedSwitch: boolean, quantiles?: DieQuantiles,
): { child: SimPosition; log: string[]; pendingSwitch: boolean; records: PairRecord[] } {
  const prng = new PairPRNG(seed, NO_SCRIPTS, quantiles);
  const battle = forkBattleWithPrng(root, prng);
  const logStart = battle.log.length;
  applyChoice(battle, 'p1', p1Choice);
  applyChoice(battle, 'p2', p2Choice);
  const followUps = { p1: p1Choice.split(' > ')[1], p2: p2Choice.split(' > ')[1] };
  let pendingSwitch = false;
  if (stopAtForcedSwitch) {
    const stand = answerFollowUps(battle, followUps);
    if (stand === 'pending') pendingSwitch = true;
    else if (stand === 'mixed') resolveForcedSwitches(battle, seed, followUps);
  } else {
    resolveForcedSwitches(battle, seed, followUps);
  }
  prng.release();
  battle.prng = new PRNG(prng.getSeed());
  const records = prng.records.map(record => ('logIndex' in record ? { ...record, logIndex: record.logIndex - logStart } : record));
  return { child: toPosition(battle), log: battle.log.slice(logStart), pendingSwitch, records };
}
