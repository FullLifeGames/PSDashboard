import { PRNG } from '@pkmn/sim';
import type { PRNGSeed } from '@pkmn/sim';
import type { MatchupCache } from '../eval-function.ts';
import { forkBattleWithPrng, positionBattle, toPosition, type SimPosition } from '../forward/position.ts';
import { applyChoice, resolveForcedSwitches } from '../forward/switches.ts';
import { leafValue } from '../search/leaf.ts';
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
  // The child is a plain battle again: the same seed state, no recorder attached.
  battle.prng = new PRNG(prng.getSeed());
  const records = prng.records.map(record => ('logIndex' in record ? { ...record, logIndex: record.logIndex - logStart } : record));
  const child = toPosition(battle);
  const childBattle = positionBattle(child);
  return { child, log: battle.log.slice(logStart), records, leaf: leafValue(childBattle, matchupCache), ended: childBattle.ended };
}
