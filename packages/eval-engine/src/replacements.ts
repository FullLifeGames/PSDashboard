import { toId } from '@fulllifegames/replay-core';
import { TIER_THRESHOLDS } from './analysis.ts';
import type { EvalResult, RankedChoice } from './types.ts';

export interface ReplacementEvalData {
  turn: number;
  ordinal: number;
  result: EvalResult;
  forced: { p1: number[]; p2: number[] };
  played: { p1: string[]; p2: string[] };
}

export interface ReplacementSideAnalysis {
  slots: number;
  /** The replay's replacement matched into the ranked list; null where no option names it. */
  played: RankedChoice | null;
  best: RankedChoice | null;
  /** best.ev − played.ev (own perspective), floored at 0. */
  regret: number | null;
  /** The played replacement is the engine's pick, or trails it by less than the inaccuracy bar. */
  agrees: boolean;
  onlyChoice: boolean;
  /** The engine's top options (up to three), best first. */
  options: RankedChoice[];
}

/** The analysis of one replacement point; a side with no slot to fill is null. */
export interface ReplacementAnalysis {
  turn: number;
  ordinal: number;
  p1: ReplacementSideAnalysis | null;
  p2: ReplacementSideAnalysis | null;
}

/** The species an option brings in: its label's switch parts, a pass left out ('→ A + pass' brings A). */
export const replacementSpeciesOf = (label: string): string[] =>
  label.split(' + ').filter(part => part.startsWith('→ ')).map(part => part.slice(2));

const sameBody = (left: string, right: string): boolean => toId(left) === toId(right);

// The log names a Mega-evolved body by its forme ('Mawile-Mega'); the option names the set's species.
const sameBase = (left: string, right: string): boolean => toId(left.split('-')[0]) === toId(right.split('-')[0]);

/** Matches the species sent in to a ranked option as an unordered set; exact names first, then base names. */
export function matchReplacementOption(options: RankedChoice[], species: string[]): RankedChoice | null {
  if (species.length === 0) return null;
  for (const same of [sameBody, sameBase]) {
    const found = options.find(option => {
      const brought = replacementSpeciesOf(option.label);
      return brought.length === species.length && species.every(name => brought.some(other => same(name, other)));
    });
    if (found) return found;
  }
  return null;
}

// A lone body that may sit in either slot is no choice.
const bodiesToChoose = (options: RankedChoice[]): number =>
  new Set(options.map(option => replacementSpeciesOf(option.label).map(toId).sort().join('|'))).size;

function analyzeSide(data: ReplacementEvalData, side: 'p1' | 'p2'): ReplacementSideAnalysis | null {
  const slots = data.forced[side].length;
  if (slots === 0) return null;
  const options = data.result.perSide[side];
  const best = options[0] ?? null;
  const played = matchReplacementOption(options, data.played[side]);
  const regret = played && best ? Math.max(0, best.ev - played.ev) : null;
  const agrees = regret !== null && regret < TIER_THRESHOLDS.inaccuracy;
  return { slots, played, best, regret, agrees, onlyChoice: bodiesToChoose(options) <= 1, options: options.slice(0, 3) };
}

export function analyzeReplacements(data: ReplacementEvalData): ReplacementAnalysis {
  return { turn: data.turn, ordinal: data.ordinal, p1: analyzeSide(data, 'p1'), p2: analyzeSide(data, 'p2') };
}
