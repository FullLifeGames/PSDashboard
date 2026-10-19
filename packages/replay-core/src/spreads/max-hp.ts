import { generationsFor } from '../format-generations.ts';
import { keyOf } from './fit.ts';
import { calcEvs, evBudget, evStep, ZERO_EVS, type EvBudget } from './ev-budget.ts';

/** One Pokémon's maximum HP as the log printed it, with the level of that line. */
export interface ObservedMaxHp {
  maxhp: number;
  level: number;
}

/**
 * The exact maximum HP a server log prints on every switch line
 * (`|switch|p2a: Name|Garchomp, F|409/409`), keyed like the solver
 * (`side:speciesId`), first sighting per Pokémon. Percent logs (`100/100`)
 * carry no measurement and are skipped. Round 40: 573756's Garchomp read
 * 409/409, which pins 208 HP EVs and leaves the budget room for the 252 Spe
 * its published set claims; the ladder's 252-HP rung (420 HP) contradicted
 * the log.
 */
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

/** The library's stat formula, @pkmn/data's `gen.stats.calc`, in the modern generations (the replays this reads are Gen 3 and later). */
const modernStats = generationsFor('').get(9).stats;

/**
 * The HP EVs that reproduce an observed maximum HP: the library's HP formula
 * (`gen.stats.calc`, `floor((2·base + iv + floor(ev/4) + 100) · level / 100) + 10`)
 * inverted over the legal EV counts (multiples of four, 0..252). Round 72
 * (T241): the formula comes from the library, held to the simulator's `maxhp`
 * for every species by max-hp-sweep.spec.ts. Level 100 inverts
 * exactly; lower levels leave a few candidates, of which the one nearest
 * the prior's HP EVs wins. `undefined` when no count reaches the HP
 * (foreign IVs; Shedinja, whose 1 HP is no function of the spread): then the log measured nothing usable. On Stat
 * Points (round 67) the candidates are the points 0..32, each through its
 * EVs (calcEvs), and the answer is in points.
 */
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
