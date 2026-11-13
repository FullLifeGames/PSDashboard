import { winDeltaText, winPctText, type EvalLine, type EvalResult, type SideAnalysis, type TurnAnalysis, type VerdictTier } from '@fulllifegames/eval-engine';
import { activeNamesAt, lineBlocks, type LineBlockView, type LinesHost } from '../../lib/line-view';
import { cardLines, engineChoice, regretView } from './turn-copy';

/**
 * Round 89 (#104), step G4: what the Game review lists, as plain data. Ruling 33 (4a): only the turns the cards grade (inaccuracy,
 * mistake, blunder); the graph marks the same turns (`reviewMarks`). Each row carries the side's engine line and played line the
 * Lines section shows (`lineBlocks`, one rule in one module), with the text of one line and the block's own play tooltip.
 */

type Side = 'p1' | 'p2';
export type ReviewGrade = Extract<VerdictTier, 'inaccuracy' | 'mistake' | 'blunder'>;

export interface ReviewMark { turn: number; side: Side }
export interface ReviewLineView {
  key: string;
  role: 'engine' | 'played';
  /** The whole line on one row: "<own choice> vs <the answer>, then …". */
  text: string;
  block: LineBlockView;
}
export interface ReviewRowView {
  key: string;
  turn: number;
  side: Side;
  grade: ReviewGrade;
  /** "Hyper Voice 42%". */
  played: string;
  /** "Surf 51%": the engine's choice as the turn card names it (`engineChoice`). */
  engine: string;
  /** "engine", or "safe" where the card's reference is the safe line. */
  engineWord: 'engine' | 'safe';
  loss: string;
  lossTitle: string;
  lines: ReviewLineView[];
}
export interface ReviewSideView { side: Side; player: string; rows: ReviewRowView[] }

const SIDES: readonly Side[] = ['p1', 'p2'];
const SIDE_INDEX: Record<Side, 0 | 1> = { p1: 0, p2: 1 };

/**
 * The grade the turn card prints for a side, or null. A mistake or blunder that the card replaces by a sack or a read that paid
 * off is not graded; an inaccuracy keeps its chip beside them. A side without its played or its engine row has nothing to compare.
 */
export function gradedTier(side: SideAnalysis): ReviewGrade | null {
  const tier = side.tier;
  if (tier !== 'inaccuracy' && tier !== 'mistake' && tier !== 'blunder') return null;
  if (!side.played || !side.best) return null;
  if (tier !== 'inaccuracy' && (side.sacrifice || side.riskPaidOff)) return null;
  return tier;
}

/** Turns the cards grade in the order the review lists them: turn by turn, player 1 before player 2. */
function gradedSides(analyses: readonly (TurnAnalysis | null)[] | null | undefined): { analysis: TurnAnalysis; side: Side; grade: ReviewGrade }[] {
  const found: { analysis: TurnAnalysis; side: Side; grade: ReviewGrade }[] = [];
  for (const analysis of analyses ?? []) {
    // a turn whose played actions were never parsed has no grade on its card
    if (!analysis || analysis.playedTracking === false) continue;
    for (const side of SIDES) {
      const grade = gradedTier(analysis[side]);
      if (grade) found.push({ analysis, side, grade });
    }
  }
  return found;
}

/** The marks of the graph: one per graded side and turn. */
export function reviewMarks(analyses: readonly (TurnAnalysis | null)[] | null | undefined): ReviewMark[] {
  return gradedSides(analyses).map(({ analysis, side }) => ({ turn: analysis.turn, side }));
}

/** One line on one row: the listed player's choice against the answer, a replacement by the player who replaces. */
function lineText(line: EvalLine, playerNames: [string, string]): string {
  const other: Side = line.side === 'p1' ? 'p2' : 'p1';
  return line.steps.map(step => {
    if (step.replacement) {
      const replacing: Side[] = step.replacement === 'both' ? ['p1', 'p2'] : [step.replacement];
      return replacing.map(side => `${playerNames[SIDE_INDEX[side]]} replaces: ${step[side].label}`).join(' and ');
    }
    return `${step[line.side].label} vs ${step[other].label}`;
  }).join(', then ');
}

interface ReviewArgs {
  analyses: readonly (TurnAnalysis | null)[] | null | undefined;
  results: readonly (EvalResult | null | undefined)[];
  playerNames: [string, string];
  doubles: boolean;
  host: LinesHost;
}

function rowLines(args: ReviewArgs, analysis: TurnAnalysis, side: Side): ReviewLineView[] {
  const { turn } = analysis;
  // only the card's own engine choice has an engine line
  const lines = cardLines(args.results[turn - 1]?.lines?.filter(line => line.side === side) ?? [], analysis);
  if (lines.length === 0) return [];
  const ctx = {
    turn, playerNames: args.playerNames, doubles: args.doubles, rules: args.host.rules,
    actives: activeNamesAt(args.host.snapshotAt?.(turn) ?? args.host.snapshot),
  };
  // `lineBlocks` puts the engine's line before the played line; a line that holds both roles reads as the engine's
  return lineBlocks(lines, ctx).map((block): ReviewLineView => ({
    key: block.key, role: block.line.for.includes('engine') ? 'engine' : 'played', text: lineText(block.line, args.playerNames), block,
  }));
}

function reviewRow(args: ReviewArgs, analysis: TurnAnalysis, side: Side, grade: ReviewGrade): ReviewRowView {
  const sideAnalysis = analysis[side];
  const name = args.playerNames[SIDE_INDEX[side]];
  const played = sideAnalysis.played!;
  const engine = engineChoice(sideAnalysis)!;
  const loss = regretView(name, sideAnalysis, sideAnalysis.regret ?? 0);
  const share = sideAnalysis.faintedFraction;
  return {
    key: `${analysis.turn}-${side}`, turn: analysis.turn, side, grade,
    played: `${played.label} ${winPctText(played.ev, share)}`,
    engine: `${engine.label} ${winPctText(engine.value, share)}`,
    engineWord: engine.word,
    loss: grade === 'inaccuracy' ? winDeltaText(-(sideAnalysis.regret ?? 0)) : loss.text,
    lossTitle: loss.title,
    lines: rowLines(args, analysis, side),
  };
}

/** The lists of the Game review: one per player, player 1 first, the graded turns in turn order. */
export function gameReview(args: ReviewArgs): ReviewSideView[] {
  const graded = gradedSides(args.analyses);
  return SIDES.map(side => ({
    side, player: args.playerNames[SIDE_INDEX[side]],
    rows: graded.filter(entry => entry.side === side).map(entry => reviewRow(args, entry.analysis, side, entry.grade)),
  }));
}
