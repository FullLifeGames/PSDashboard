import { regretText, TIER_THRESHOLDS, type EvalLine, type LeadSideAnalysis, type SideAnalysis, type TurnAnalysis, type RankedChoice, winDeltaText, winPctText, winPercent } from '@fulllifegames/eval-engine';
import { opponentReadsEnabled } from '../../lib/feature-flags';
import type { RowValues } from '../../lib/line-view';

/** The floor appears only as a labeled risk clause, and only when the row gave up mistake-sized safety. */
export const RISK_DISPLAY_GAP = TIER_THRESHOLDS.mistake;
export const evTitle = (name: string) =>
  `${name}'s win probability with this choice against balanced play; higher is better for ${name}.`;
/** Played-vs-engine EV gaps under this are display noise: the picks are equivalent. */
export const ENGINE_EQUIVALENT_EPSILON = 0.01;

function preventedText(reason: string): string {
  if (reason === 'faint') return 'fainted before its action came out';
  if (reason === 'slp') return 'slept through the turn: the chosen action never surfaced';
  if (reason === 'frz') return 'stayed frozen: the chosen action never surfaced';
  if (reason === 'par') return 'was fully paralyzed: the chosen action never surfaced';
  if (reason === 'flinch') return 'flinched: the chosen action never surfaced';
  if (reason === 'recharge') return 'had to recharge';
  if (reason.startsWith('move: ')) return `was blocked by ${reason.slice('move: '.length)}: the chosen action never surfaced`;
  return `was prevented (${reason}): the chosen action never surfaced`;
}

function playedRawLabel(side: SideAnalysis): string | undefined {
  return side.playedRaw?.kind === 'switch'
    ? `→ ${side.playedRaw.species ?? side.playedRaw.name}`
    : side.playedRaw?.name;
}

function playedSlotsLabel(side: SideAnalysis): string | undefined {
  return side.playedSlots
    ?.filter((action): action is NonNullable<typeof action> => action !== null)
    .map(action => (action.kind === 'switch' ? `→ ${action.species ?? action.name}` : action.name))
    .join(' + ');
}

/** A deliberate copy of `NEVER_ACTED_WORDS` in `prose/phrases.ts`; `copies.spec.ts` compares the two. */
export const NEVER_ACTED_WORDS = 'knocked out before it moved, so the log shows no choice';

export function neverActedText(side: { played: { ev: number } | null; faintedFraction?: number }): string {
  return `${NEVER_ACTED_WORDS}${side.played ? ` · staying in ${winPctText(side.played.ev, side.faintedFraction)}` : ''}`;
}

export function neverActedOf(analysis: Pick<TurnAnalysis, 'p1' | 'p2'> | null | undefined): { p1: boolean; p2: boolean } | undefined {
  return analysis ? { p1: analysis.p1.neverActed === true, p2: analysis.p2.neverActed === true } : undefined;
}

export function playedTextFor(side: SideAnalysis): { acted: boolean; playedText: string } {
  if (side.neverActed) return { acted: false, playedText: neverActedText(side) };
  const playedRawName = playedRawLabel(side);
  const slotText = playedSlotsLabel(side);
  const acted = Boolean(side.played || slotText || side.playedRaw);
  const playedText = side.played
    ? `${side.played.label} (${winPctText(side.played.ev, side.faintedFraction)})`
    : slotText
      ? `${slotText} (not among the engine's candidates)`
      : side.playedRaw
        ? `${playedRawName} (not among the engine's options)`
        : side.prevented
          ? preventedText(side.prevented)
          : 'choice never surfaced';
  return { acted, playedText };
}

/** For a read the SAFE line (max floor), not the ev-best: "better" would credit what the read outperformed. */
export function comparisonTarget(side: SideAnalysis, best: RankedChoice) {
  const asSafe = side.riskUnpunished || side.riskPaidOff;
  const target = asSafe ? side.safe ?? best : best;
  const swapped = !asSafe ? side.bestNull?.alternative ?? null : null;
  const value = asSafe ? target.worstCase : swapped?.ev ?? target.ev;
  return { asSafe, target, swapped, value };
}

/** The one place that names a side's engine choice; the Game review takes only this choice's line. */
export function engineChoice(side: SideAnalysis): { label: string; value: number; word: 'engine' | 'safe' } | null {
  const best = side.best;
  if (!best) return null;
  if (side.tier !== 'mistake' && side.tier !== 'blunder') return { label: best.label, value: best.ev, word: 'engine' };
  const { asSafe, target, swapped, value } = comparisonTarget(side, best);
  return { label: swapped ? swapped.label : target.label, value, word: asSafe ? 'safe' : 'engine' };
}

/** A line is the engine's only when it is the line of the card's engine choice (a blend keeps the heaviest world). */
export function cardLines(lines: readonly EvalLine[], analysis: Pick<TurnAnalysis, 'p1' | 'p2'> | null | undefined): EvalLine[] {
  if (!analysis) return [...lines];
  return lines.flatMap((line): EvalLine[] => {
    const engine = engineChoice(analysis[line.side]);
    const roles = line.for.filter(role => role !== 'engine' || engine === null || engine.label === line.label);
    if (roles.length === 0) return [];
    return [roles.length === line.for.length ? line : { ...line, for: roles }];
  });
}

export function rowValueTexts(analysis: Pick<TurnAnalysis, 'p1' | 'p2'> | null | undefined): { p1?: RowValues; p2?: RowValues } | undefined {
  if (!analysis) return undefined;
  const of = (side: SideAnalysis): RowValues => {
    const engine = engineChoice(side);
    return {
      ...(engine ? { engine: winPctText(engine.value, side.faintedFraction) } : {}),
      ...(side.played ? { played: winPctText(side.played.ev, side.faintedFraction) } : {}),
    };
  };
  return { p1: of(analysis.p1), p2: of(analysis.p2) };
}

/** Names the run's position, never the pointer's; on an open replacement it names the turn the frame shows. */
export function resultPositionLabel(
  resultTag: string | null, screen: { viewTurn: number; viewingVariation: boolean }, replacement = false,
): string {
  const match = resultTag === null ? null : /^(main|variation):(\d+)$/.exec(resultTag);
  const turn = match ? Number(match[2]) : screen.viewTurn;
  const variation = match ? match[1] === 'variation' : screen.viewingVariation;
  const line = variation ? 'variation' : 'main line';
  return match && replacement ? `Replacement after turn ${turn - 1} · ${line}` : `Turn ${turn} · ${line}`;
}

const chanceGapText = (better: number, played: number, faintedFraction?: number | null): string =>
  `−${Math.max(0, winPercent(better, faintedFraction) - winPercent(played, faintedFraction))}%`;

/** Up to a regret of 1 the chip is the gap of the two chances the card prints; over 1 it names both. */
export function regretView(name: string, side: SideAnalysis, regret: number): { text: string; title: string } {
  const from = side.best ? comparisonTarget(side, side.best).value : undefined;
  const to = side.played?.ev;
  if (from === undefined || to === undefined) {
    return { text: winDeltaText(-regret), title: `${name} gave up this much win probability vs the engine's best.` };
  }
  const spanned = regretText(regret, from, to, side.faintedFraction);
  if (spanned === winDeltaText(-regret)) {
    return { text: chanceGapText(from, to, side.faintedFraction), title: `${name} gave up this much win probability vs the engine's best.` };
  }
  return {
    text: spanned,
    title: `${name}'s win chance fell from ${winPctText(from, side.faintedFraction)} with the engine's line to ${winPctText(to, side.faintedFraction)} with the played choice ` +
      `(regret ${regret.toFixed(2)} on the score scale from −1 to 1).`,
  };
}

export const exploreTitle = (opponentReads = false): string => opponentReads && opponentReadsEnabled()
  ? 'Play this turn in a variation; the opponent reads your move and plays the reply the search rates lowest for it.'
  : 'Play this turn in a variation; the opponent plays its top choice.';

export function inaccuracyView(side: Pick<SideAnalysis, 'best' | 'played' | 'faintedFraction' | 'regret'>): { text: string; title: string } {
  const regret = side.regret ?? 0;
  const { best, played } = side;
  const text = best && played ? chanceGapText(best.ev, played.ev, side.faintedFraction) : winDeltaText(-regret);
  const lead = best ? `${best.label} was a touch better: a minor imprecision, not a mistake.` : 'A minor imprecision, not a mistake.';
  return {
    text,
    title: `${lead} The size is the gap of the two win chances shown; the grade rests on a regret of ${regret.toFixed(2)} on the score scale (${TIER_THRESHOLDS.inaccuracy.toFixed(2)} or more).`,
  };
}

export function leadGradeSize(side: Pick<LeadSideAnalysis, 'best' | 'played' | 'regret'>): string {
  return side.best && side.played ? chanceGapText(side.best.ev, side.played.ev) : winDeltaText(-(side.regret ?? 0));
}
