import { CHANCE_CANT } from '../dice-events.ts';

// A hit's window ends at the next |move| line; the owner's HP lines give exact HP (max HP is the denominator).

// The |cant| reasons the simulator draws, by condition name ("Attract"), not sleep: test/pair-cant-reasons.spec.ts.
const RANDOM_CANT: ReadonlySet<string> = new Set([...CHANCE_CANT].filter(reason => reason !== 'slp'));

function windowEnd(log: readonly string[], from: number): number {
  for (let index = from; index < log.length; index++) if (log[index].startsWith('|move|')) return index;
  return log.length;
}

/** The target's exact HP right after the hit rolled at `from`: 0 on `0 fnt`; null without a direct damage line. */
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

/** A random outcome the plan does not price; a |cant| a recorded secondary die explains is no deviation. */
export function randomDeviation(log: readonly string[], explained: ReadonlySet<string> = new Set()): string | null {
  for (const line of log) {
    const parts = line.split('|');
    const reason = parts[3] ?? '';
    if (parts[1] === 'cant' && RANDOM_CANT.has(reason) && !explained.has(`${(parts[2] ?? '').split(':')[0]}|${reason.toLowerCase()}`)) return `cant:${reason}`;
    if (parts[1] === '-activate' && parts[3] === 'confusion') return 'confusion';
    if (parts[1] === 'drag') return 'drag';
  }
  return null;
}

/** Whether the body in `slot` has a |move| or |cant| line at or after `from` (a flinched body shows |cant|). */
export function actsLater(log: readonly string[], from: number, slot: string): boolean {
  const prefixes = [`|move|${slot}: `, `|cant|${slot}: `];
  for (let index = from; index < log.length; index++) if (prefixes.some(prefix => log[index].startsWith(prefix))) return true;
  return false;
}

export function movesLater(log: readonly string[], from: number, slot: string): boolean {
  const prefix = `|move|${slot}: `;
  for (let index = from; index < log.length; index++) if (log[index].startsWith(prefix)) return true;
  return false;
}
