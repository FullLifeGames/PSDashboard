import { generationsFor } from '../format-generations.ts';
import { keyOf } from './fit.ts';
import { calcEvs, evBudget, evStep, ZERO_EVS, type EvBudget } from './ev-budget.ts';

/** One Pokémon's maximum HP as the log printed it, with the level of that line. */
export interface ObservedMaxHp {
  maxhp: number;
  level: number;
}

/** The exact maximum HP a server log prints on a switch line, per `side:speciesId`; percent logs carry none. */
export function observedMaxHp(log: string): Map<string, ObservedMaxHp> {
  const seen = new Map<string, ObservedMaxHp>();
  for (const line of log.split('\n')) {
    const match = line.match(/^\|(?:switch|drag)\|(p[12])[a-d]: [^|]*\|([^,|]+)((?:, [^|,]+)*)\|(\d+)\/(\d+)/);
    if (!match) continue;
    const maxhp = parseInt(match[5], 10);
    if (maxhp <= 0 || maxhp === 100) continue;
    const key = keyOf(match[1] as 'p1' | 'p2', match[2].trim());
    if (seen.has(key)) continue;
    const level = parseInt(match[3].match(/, L(\d+)/)?.[1] ?? '100', 10);
    seen.set(key, { maxhp, level });
  }
  return seen;
}

// The modern stat formula; the replays this reads are Gen 3 and later.
const modernStats = generationsFor('').get(9).stats;

// On Stat Points the answer is in points (0..32, each through calcEvs); Shedinja's 1 HP is no function of the spread.
/** The HP EVs that reproduce an observed maximum HP (the library's formula inverted); `undefined` when none does. */
export function hpEvsForMaxHp(
  baseHp: number, level: number, maxhp: number, priorHp: number, iv = 31, budget: EvBudget = evBudget(''),
): number | undefined {
  if (baseHp === 1) return undefined;
  let best: number | undefined;
  for (let value = 0; value <= budget.perStat; value += evStep(budget)) {
    const ev = calcEvs({ ...ZERO_EVS, hp: value }, budget).hp;
    if (modernStats.calc('hp', baseHp, iv, ev, level) !== maxhp) continue;
    if (best === undefined || Math.abs(value - priorHp) < Math.abs(best - priorHp)) best = value;
  }
  return best;
}
