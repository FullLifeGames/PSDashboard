import { keyOf } from './fit.ts';

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
  for (const rawLine of log.split('\n')) {
    const match = rawLine.replace(/\r$/, '').match(/^\|(?:switch|drag)\|(p[12])[a-d]: [^|]*\|([^,|]+)((?:, [^|,]+)*)\|(\d+)\/(\d+)/);
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

/**
 * The HP EVs that reproduce an observed maximum HP: the formula
 * `floor((2·base + iv + floor(ev/4)) · level / 100) + level + 10` inverted
 * over the legal EV counts (multiples of four, 0..252). Level 100 inverts
 * exactly; lower levels leave a few candidates, of which the one nearest
 * the prior's HP EVs wins. `undefined` when no count reaches the HP
 * (foreign IVs, Shedinja): then the log measured nothing usable.
 */
export function hpEvsForMaxHp(baseHp: number, level: number, maxhp: number, priorHp: number, iv = 31): number | undefined {
  let best: number | undefined;
  for (let ev = 0; ev <= 252; ev += 4) {
    const hp = Math.floor((2 * baseHp + iv + Math.floor(ev / 4)) * level / 100) + level + 10;
    if (hp !== maxhp) continue;
    if (best === undefined || Math.abs(ev - priorHp) < Math.abs(best - priorHp)) best = ev;
  }
  return best;
}
