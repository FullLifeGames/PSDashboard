import { lostGround, replacementWords, winPctText, type EvalLine, type EvalResult, type SideAnalysis, type TurnAnalysis, type VerdictTier } from '@fulllifegames/eval-engine';
import { linesForMode, worstLookup } from '../../lib/worst-reply';
import { activeNamesAt, lineBlocks, ranksOf, type LineBlockView, type LineReply, type LinesHost } from '../../lib/line-view';
import { cardLines, engineChoice, neverActedOf, neverActedText, inaccuracyView, regretView, rowValueTexts } from './turn-copy';


type Side = 'p1' | 'p2';
export type ReviewGrade = Extract<VerdictTier, 'inaccuracy' | 'mistake' | 'blunder'>;

export interface ReviewMark { turn: number; side: Side }
export interface ReviewLineView {
  key: string;
  role: 'engine' | 'played';
  text: string;
  /** "ends at 19%": the line's own number; the head of the row prints the row's. */
  end: string;
  block: LineBlockView;
}
export interface ReviewRowView {
  key: string;
  turn: number;
  side: Side;
  grade: ReviewGrade;
  played: string;
  playedText: string;
  engine: string;
  engineWord: 'engine' | 'safe';
  loss: string;
  lossTitle: string;
  lines: ReviewLineView[];
}
export interface ReviewSideView { side: Side; player: string; rows: ReviewRowView[] }

const SIDES: readonly Side[] = ['p1', 'p2'];
const SIDE_INDEX: Record<Side, 0 | 1> = { p1: 0, p2: 1 };

/** The grade the turn card prints for a side, or null; a sack or a read that paid off replaces a mistake or blunder. */
export function gradedTier(side: SideAnalysis, lostGroundOnTurn = false): ReviewGrade | null {
  const tier = side.tier;
  if (tier !== 'inaccuracy' && tier !== 'mistake' && tier !== 'blunder') return null;
  if (!side.played || !side.best) return null;
  if (tier !== 'inaccuracy' && (side.sacrifice || side.riskPaidOff)) return null;
  if (tier === 'inaccuracy' && side.riskPaidOff && !side.sacrifice && !lostGroundOnTurn) return null;
  return tier;
}

/** Turns the cards grade, in review order: turn by turn, player 1 before player 2. */
export function gradedSides(analyses: readonly (TurnAnalysis | null)[] | null | undefined): { analysis: TurnAnalysis; side: Side; grade: ReviewGrade }[] {
  const found: { analysis: TurnAnalysis; side: Side; grade: ReviewGrade }[] = [];
  for (const analysis of analyses ?? []) {
    if (!analysis || analysis.playedTracking === false) continue;
    for (const side of SIDES) {
      const grade = gradedTier(analysis[side], lostGround(analysis, side));
      if (grade) found.push({ analysis, side, grade });
    }
  }
  return found;
}

export function reviewMarks(analyses: readonly (TurnAnalysis | null)[] | null | undefined): ReviewMark[] {
  return gradedSides(analyses).map(({ analysis, side }) => ({ turn: analysis.turn, side }));
}

function lineText(line: EvalLine, playerNames: [string, string], doubles: boolean, reply: LineReply | null): string {
  const other: Side = line.side === 'p1' ? 'p2' : 'p1';
  const ranked = (label: string, index: number): string => (index === 0 && reply ? `${label} (${reply.rank})` : label);
  return line.steps.map((step, index) => {
    if (step.replacement) {
      const replacing: Side[] = step.replacement === 'both' ? ['p1', 'p2'] : [step.replacement];
      return replacing.map(side => `${playerNames[SIDE_INDEX[side]]} replaces: ${replacementWords(step[side].label)}`).join(' and ');
    }
    if (doubles) return `${playerNames[SIDE_INDEX[line.side]]}: ${step[line.side].label}; ${playerNames[SIDE_INDEX[other]]}: ${ranked(step[other].label, index)}`;
    return `${step[line.side].label} vs ${ranked(step[other].label, index)}`;
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
  const result = args.results[turn - 1];
  const lines = linesForMode(cardLines(result?.lines?.filter(line => line.side === side) ?? [], analysis), !!args.host.hardMode);
  if (lines.length === 0) return [];
  const ctx = {
    turn, playerNames: args.playerNames, doubles: args.doubles, rules: args.host.rules,
    actives: activeNamesAt(args.host.snapshotAt?.(turn) ?? args.host.snapshot),
    rowValues: rowValueTexts(analysis),
    neverActed: neverActedOf(analysis),
    ranks: result ? ranksOf(result) : undefined,
    ...(args.host.hardMode && result ? { worst: worstLookup(result, { p1: analysis.p1.faintedFraction, p2: analysis.p2.faintedFraction }) } : {}),
  };
  // `lineBlocks` puts the engine's line before the played line; a line that holds both roles reads as the engine's
  return lineBlocks(lines, ctx).map((block): ReviewLineView => ({
    key: block.key, role: block.line.for.includes('engine') ? 'engine' : 'played', text: lineText(block.line, args.playerNames, args.doubles, block.reply), end: `ends at ${block.endPct}`, block,
  }));
}

function reviewRow(args: ReviewArgs, analysis: TurnAnalysis, side: Side, grade: ReviewGrade): ReviewRowView {
  const sideAnalysis = analysis[side];
  const name = args.playerNames[SIDE_INDEX[side]];
  const played = sideAnalysis.played!;
  const engine = engineChoice(sideAnalysis)!;
  const loss = grade === 'inaccuracy' ? inaccuracyView(sideAnalysis) : regretView(name, sideAnalysis, sideAnalysis.regret ?? 0);
  const share = sideAnalysis.faintedFraction;
  return {
    key: `${analysis.turn}-${side}`, turn: analysis.turn, side, grade,
    played: `${played.label} ${winPctText(played.ev, share)}`,
    playedText: sideAnalysis.neverActed ? neverActedText(sideAnalysis) : `played ${played.label} ${winPctText(played.ev, share)}`,
    engine: `${engine.label} ${winPctText(engine.value, share)}`,
    engineWord: engine.word,
    loss: loss.text,
    lossTitle: loss.title,
    lines: rowLines(args, analysis, side),
  };
}

export interface EndgameRowView { side: Side; player: string; turn: number; text: string }

/** The Endgame row for the player who lost; `endgame` means three bodies or fewer standing at the turn's start. */
export function endgameRow(endgame: { loser: Side; turns: readonly number[] } | null | undefined, playerNames: [string, string]): EndgameRowView | null {
  if (!endgame || endgame.turns.length === 0) return null;
  const player = playerNames[SIDE_INDEX[endgame.loser]];
  const turn = endgame.turns[0];
  return { side: endgame.loser, player, turn, text: `Endgame · T${turn} · How could ${player} have won?` };
}

export function gameReview(args: ReviewArgs): ReviewSideView[] {
  const graded = gradedSides(args.analyses);
  return SIDES.map(side => ({
    side, player: args.playerNames[SIDE_INDEX[side]],
    rows: graded.filter(entry => entry.side === side).map(entry => reviewRow(args, entry.analysis, side, entry.grade)),
  }));
}

export const reviewBlocks = (view: readonly ReviewSideView[]): LineBlockView[] => view.flatMap(side => side.rows.flatMap(row => row.lines.map(line => line.block)));

export function reviewDiffers(view: readonly ReviewSideView[]): boolean {
  return view.some(side => side.rows.some(row => row.lines.some(line => line.block.differs)));
}
