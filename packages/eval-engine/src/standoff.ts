import type { SideAnalysis, TurnAnalysis } from './analysis.ts';

// A standoff: consecutive turns with no faint and no switch. Pure, no sim imports, main-bundle safe.

export const STANDOFF_MIN_TURNS = 10;

export interface Standoff {
  /** First and last turn of the run, both inside it. */
  from: number;
  to: number;
}

// Singles read playedRaw, doubles the slot lists: a label can carry a switch after another action.
function switched(side: SideAnalysis): boolean | null {
  const slots = side.playedSlots;
  if (slots !== undefined) return slots.some(slot => slot?.kind === 'switch');
  return side.playedRaw === null ? null : side.playedRaw.kind === 'switch';
}

// A turn the analysis cannot see (no played tracking, share or action) counts as not quiet.
function quietTurn(analysis: TurnAnalysis): boolean {
  if (analysis.playedTracking !== true) return false;
  if (analysis.faintedFraction === undefined || analysis.faintedFractionAfter !== analysis.faintedFraction) return false;
  return [analysis.p1, analysis.p2].every(side => !side.neverActed && switched(side) === false);
}

export function standoffsOf(known: TurnAnalysis[]): Standoff[] {
  const found: Standoff[] = [];
  let run: TurnAnalysis[] = [];
  const close = (): void => {
    if (run.length >= STANDOFF_MIN_TURNS) found.push({ from: run[0].turn, to: run[run.length - 1].turn });
    run = [];
  };
  for (const analysis of known) {
    const last = run[run.length - 1];
    if (last && (analysis.turn !== last.turn + 1 || analysis.faintedFraction !== last.faintedFraction)) close();
    if (quietTurn(analysis)) run.push(analysis);
    else close();
  }
  close();
  return found;
}

export const inStandoff = (standoffs: readonly Standoff[], turn: number): boolean =>
  standoffs.some(standoff => turn >= standoff.from && turn <= standoff.to);

const listOf = (parts: string[]): string =>
  parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

export function standoffSentence(standoffs: readonly Standoff[]): string {
  const spans = standoffs.map(standoff => `${standoff.from} to ${standoff.to}`);
  if (standoffs.length === 1) {
    const turns = standoffs[0].to - standoffs[0].from + 1;
    return `Turns ${spans[0]} were a standoff: nothing fainted and nobody switched for ${turns} turns, so their shifts and reads stay out of the key moments.`;
  }
  return `Turns ${listOf(spans)} were standoffs: nothing fainted and nobody switched in them, so their shifts and reads stay out of the key moments.`;
}
