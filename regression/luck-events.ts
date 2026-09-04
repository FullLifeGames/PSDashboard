/**
 * Luck events against the favored side, read from the protocol from a
 * sample turn to the end (round 34, bank decomposition stage 1): crits
 * taken, own misses, and turns lost to paralysis, freeze, or flinch.
 * Sleep and confusion are not counted (they are usually self-inflicted
 * or chosen into). A missing turn line means the whole log counts.
 */
export interface LuckCounts { crit: number; miss: number; cant: number }

const CANT_REASONS = new Set(['par', 'frz', 'flinch']);

export function luckAgainstFavored(log: string, fromTurn: number, favored: 'p1' | 'p2'): LuckCounts {
  const lines = log.split('\n');
  const start = lines.indexOf(`|turn|${fromTurn}`);
  const counts: LuckCounts = { crit: 0, miss: 0, cant: 0 };
  for (const line of lines.slice(Math.max(0, start))) {
    if (line.startsWith(`|-crit|${favored}`)) counts.crit += 1;
    else if (line.startsWith(`|-miss|${favored}`)) counts.miss += 1;
    else if (line.startsWith(`|cant|${favored}`) && CANT_REASONS.has(line.split('|')[3] ?? '')) counts.cant += 1;
  }
  return counts;
}

export const hasLuckAgainst = (counts: LuckCounts): boolean => counts.crit + counts.miss + counts.cant > 0;
