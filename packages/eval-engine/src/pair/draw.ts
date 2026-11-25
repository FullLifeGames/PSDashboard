import { PRNG } from '@pkmn/sim';
import type { PRNGSeed } from '@pkmn/sim';
import type { MatchupCache } from '../eval-function.ts';
import { forkBattleWithPrng, positionBattle, toPosition, type SimPosition } from '../forward/position.ts';
import { answerFollowUps, applyChoice, resolveForcedSwitches, type StaticPick } from '../forward/switches.ts';
import { leafValue } from '../search/leaf.ts';
import type { DieQuantiles } from '../search/root-quantile.ts';
import { PairPRNG, type PairRecord, type PairScripts } from './prng.ts';


export interface PairDraw {
  child: SimPosition;
  log: string[];
  /** The rolls of this draw; their `logIndex` counts from its first line. */
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
  const picks = resolveForcedSwitches(battle, seed, { p1: p1Choice.split(' > ')[1], p2: p2Choice.split(' > ')[1] });
  prng.release();
  battle.prng = new PRNG(prng.getSeed());
  const records = prng.records.map(record => ('logIndex' in record ? { ...record, logIndex: record.logIndex - logStart } : record));
  const child = toPosition(battle, picks);
  const childBattle = positionBattle(child);
  return { child, log: battle.log.slice(logStart), records, leaf: leafValue(childBattle, matchupCache), ended: childBattle.ended };
}

const NO_SCRIPTS: PairScripts = new Map();

/** The tree's root draw under the pair recorder; `quantiles` answer the named dice after the natural draw. */
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
  let picks: StaticPick[] = [];
  if (stopAtForcedSwitch) {
    const stand = answerFollowUps(battle, followUps);
    if (stand === 'pending') pendingSwitch = true;
    else if (stand === 'mixed') picks = resolveForcedSwitches(battle, seed, followUps);
  } else {
    picks = resolveForcedSwitches(battle, seed, followUps);
  }
  prng.release();
  battle.prng = new PRNG(prng.getSeed());
  const records = prng.records.map(record => ('logIndex' in record ? { ...record, logIndex: record.logIndex - logStart } : record));
  return { child: toPosition(battle, picks), log: battle.log.slice(logStart), pendingSwitch, records };
}
