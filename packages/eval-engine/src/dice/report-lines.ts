import type { DieReport, ForcedDie } from './types.ts';
import type { DieNote } from './prng.ts';

/**
 * Round 82 (forced dice): the small readers of the protocol's lines every report witness shares (`report.ts` and
 * `report-moves.ts`): the fields of a line, the body a line is about, and the witness a draw hands to its report.
 */

export const parts = (line: string): string[] => line.split('|');
export const slotOfIdent = (ident: string | undefined): string | undefined => ident?.split(':')[0].trim();

/** The line is about the body in `slot` (its first argument), or about any body when the die names none. */
export const about = (line: string, slot: string | undefined): boolean => slot === undefined || slotOfIdent(parts(line)[2]) === slot;

export const shows = (line: string): string => `the protocol shows "${line}"`;

/** What every witness reads: the die, the notes of its draw and the lines of the action that holds it. */
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
