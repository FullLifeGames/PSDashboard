import type { DieReport, ForcedDie } from './types.ts';
import type { DieNote } from './prng.ts';


export const parts = (line: string): string[] => line.split('|');
export const slotOfIdent = (ident: string | undefined): string | undefined => ident?.split(':')[0].trim();

export const about = (line: string, slot: string | undefined): boolean => slot === undefined || slotOfIdent(parts(line)[2]) === slot;

export const shows = (line: string): string => `the protocol shows "${line}"`;

export interface Witness {
  die: ForcedDie;
  seen: Pick<DieReport, 'chance' | 'logIndex'>;
  note: DieNote;
  action: string[];
  target: string[];
  targetSlot: string | undefined;
  name: string;
}

export const applied = (w: Witness): DieReport => ({ die: w.die, took: 'applied', ...w.seen });
export const otherwise = (w: Witness, took: DieReport['took'], reason: string): DieReport => ({ die: w.die, took, ...w.seen, reason });
