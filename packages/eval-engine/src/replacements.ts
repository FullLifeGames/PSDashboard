import { toId } from '@fulllifegames/replay-core';
import { TIER_THRESHOLDS } from './analysis.ts';
import type { EvalResult, RankedChoice } from './types.ts';

/**
 * Round 79 (T290): the replacement after a knockout, read like the lead decision of turn 0 (leads.ts) and shown as a note on the
 * card of the turn that follows. The root is the position at the open forced request: the replacing side's options are the bench
 * switches (doubles: one per forced slot, a pass where the bench cannot fill a slot), the other side waits. Nothing here grades:
 * no tier, no verdict, no input to the totals or the game report. Pure, no sim imports, main-bundle safe.
 */

/** Sweep payload of one replacement point (the `onReplacement` hook's point plus the root's result). */
export interface ReplacementEvalData {
  /** The knockout turn; the replacement stands on the board of the next turn. */
  turn: number;
  /** The block's n-th open knockout request (a replacement that falls to an entry hazard opens a second). */
  ordinal: number;
  result: EvalResult;
  /** The slots to fill per side. */
  forced: { p1: number[]; p2: number[] };
  /** The species the replay sent in per side, in the order of the log. */
  played: { p1: string[]; p2: string[] };
}

export interface ReplacementSideAnalysis {
  /** How many slots the side filled (doubles: 1 or 2). */
  slots: number;
  /** The replacement the replay sent in, matched into the engine's ranked list; null where no option names it. */
  played: RankedChoice | null;
  best: RankedChoice | null;
  /** best.ev − played.ev (own perspective), floored at 0. */
  regret: number | null;
  /** The played replacement is the engine's pick, or trails it by less than the inaccuracy bar. */
  agrees: boolean;
  /** The side had one body to send in (nothing to choose). */
  onlyChoice: boolean;
  /** The engine's top options (up to three), best first. */
  options: RankedChoice[];
}

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

/** The base name of a forme (the log writes a mega-evolved body that returns as 'Mawile-Mega', the option names its set's species). */
const sameBase = (left: string, right: string): boolean => toId(left.split('-')[0]) === toId(right.split('-')[0]);

/**
 * Matches the species the replay sent in against a ranked option as an unordered set: the log names the slots in its own order,
 * the options in slot order. The first match in ranked order wins (equal values: '→ A + pass' and 'pass + → A'). The species
 * names meet exactly first, by their base name when no option meets exactly.
 */
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

/** Whether the options bring in one set of bodies only (a lone body that may sit in either slot is no choice). */
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
