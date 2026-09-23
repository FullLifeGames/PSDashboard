/**
 * Round 56: the doubles pair plan reads a draw's own lines. A hit's window
 * runs from its roll to the next |move| line; the owner's HP lines carry
 * the exact HP (denominator = max HP), the public ones a percentage.
 */

const RANDOM_CANT = new Set(['flinch', 'par', 'frz', 'attract']);

/** The next |move| line at or after `from`, or the log's end. */
function windowEnd(log: readonly string[], from: number): number {
  for (let index = from; index < log.length; index++) if (log[index].startsWith('|move|')) return index;
  return log.length;
}

/** The target's exact HP right after the hit rolled at `from`: 0 on `0 fnt`, null when the window has no direct damage line. */
export function hpAfterHit(log: readonly string[], from: number, targetSlot: string, maxhp: number): number | null {
  const end = windowEnd(log, from);
  const prefix = `|-damage|${targetSlot}: `;
  for (let index = from; index < end; index++) {
    const line = log[index];
    if (!line.startsWith(prefix) || line.includes('[from]')) continue;
    const hp = line.split('|')[3] ?? '';
    if (hp.startsWith('0 fnt')) return 0;
    const match = /^(\d+)\/(\d+)/.exec(hp);
    if (match && Number(match[2]) === maxhp) return Number(match[1]);
  }
  return null;
}

/** A random outcome the plan does not price: a |cant| from flinch, paralysis, freeze or attraction, a confusion check, a random drag-in. */
export function randomDeviation(log: readonly string[]): string | null {
  for (const line of log) {
    const parts = line.split('|');
    if (parts[1] === 'cant' && RANDOM_CANT.has(parts[3] ?? '')) return `cant:${parts[3]}`;
    if (parts[1] === '-activate' && parts[3] === 'confusion') return 'confusion';
    if (parts[1] === 'drag') return 'drag';
  }
  return null;
}

/** Whether the body in `slot` has a |move| line at or after `from`: it acts later in the turn. */
export function movesLater(log: readonly string[], from: number, slot: string): boolean {
  const prefix = `|move|${slot}: `;
  for (let index = from; index < log.length; index++) if (log[index].startsWith(prefix)) return true;
  return false;
}
