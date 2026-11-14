import { regretText, TIER_THRESHOLDS, type EvalLine, type SideAnalysis, type TurnAnalysis, type RankedChoice, winDeltaText, winPctText } from '@fulllifegames/eval-engine';
import type { RowValues } from '../../lib/line-view';

/**
 * Every displayed value is a WIN PROBABILITY for the named player — "52%"
 * absolutes (higher is always better for that player) and "+8%" deltas —
 * because raw wp-units ("+0.05", "−0.39") never said WHOSE position they
 * helped. The played chip shows the row's EV — the SAME quantity as the
 * engine chip and the regret grading. The floor appears only as a labeled
 * risk clause, and only when the row gave up mistake-sized safety (a
 * genuine gamble): showing the floor beside the engine's EV once made a
 * co-optimal switch look ranked very lowly (draft T50).
 */
export const RISK_DISPLAY_GAP = TIER_THRESHOLDS.mistake;
/** Tooltip for a side's own EV percentages. */
export const evTitle = (name: string) =>
  `${name}'s win probability with this choice against balanced play; higher is better for ${name}.`;
/** Played-vs-engine EV gaps under this are display noise — the picks are equivalent. */
export const ENGINE_EQUIVALENT_EPSILON = 0.01;

/** `|cant|` reasons → honest copy: the player DID choose; this swallowed it. */
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

/** What the side played, worded by what the analysis could match. */
export function playedTextFor(side: SideAnalysis): { acted: boolean; playedText: string } {
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

/**
 * The reference line a regretful row compares against. For a read, the
 * reference is the SAFE line (max floor) shown at its guarantee — calling
 * the ev-best "better" would credit what the read outperformed. Red
 * misplays compare against the ev-best at its equilibrium value. A
 * mechanically null best displays as its co-optimal alternative (same
 * swap the summary makes); punisher/PV belong to the true best, so they
 * drop, and explore stays off the substitute.
 */
export function comparisonTarget(side: SideAnalysis, best: RankedChoice) {
  const asSafe = side.riskUnpunished || side.riskPaidOff;
  const target = asSafe ? side.safe ?? best : best;
  const swapped = !asSafe ? side.bestNull?.alternative ?? null : null;
  const value = asSafe ? target.worstCase : swapped?.ev ?? target.ev;
  return { asSafe, target, swapped, value };
}

/**
 * Round 89 (#104), step G4b: the engine's choice of a side as the turn card names it, and the one place that says so: a graded
 * mistake or blunder shows its reference line (`comparisonTarget`: the safe line for a read, the co-optimal alternative for a null
 * best, else the best), every other row its best row at the row's own value. The Game review reads the same choice, value and word
 * ("safe" where the card says "safe:"), and takes as the engine's line only the line of this choice.
 */
export function engineChoice(side: SideAnalysis): { label: string; value: number; word: 'engine' | 'safe' } | null {
  const best = side.best;
  if (!best) return null;
  if (side.tier !== 'mistake' && side.tier !== 'blunder') return { label: best.label, value: best.ev, word: 'engine' };
  const { asSafe, target, swapped, value } = comparisonTarget(side, best);
  return { label: swapped ? swapped.label : target.label, value, word: asSafe ? 'safe' : 'engine' };
}

/**
 * The lines a card shows: a line is the engine's only when it is the line of the card's engine choice (a result blended over
 * several worlds keeps the heaviest world's lines, whose best row need not be the blend's), and a line that was both the engine's
 * and the played one but is no longer the engine's reads as the played line alone.
 */
export function cardLines(lines: readonly EvalLine[], analysis: Pick<TurnAnalysis, 'p1' | 'p2'> | null | undefined): EvalLine[] {
  if (!analysis) return [...lines];
  return lines.flatMap((line): EvalLine[] => {
    const engine = engineChoice(analysis[line.side]);
    const roles = line.for.filter(role => role !== 'engine' || engine === null || engine.label === line.label);
    if (roles.length === 0) return [];
    return [roles.length === line.for.length ? line : { ...line, for: roles }];
  });
}

/**
 * Round 89 (#104), G10: the percentages the card's rows show for each side, printed as the card prints them: the engine's row (the
 * value `engineChoice` names) and the played row. A line reads its own row's number from here, so the Lines section and the Game
 * review put the same two numbers side by side.
 */
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

/**
 * The heading over the live evaluation (round 77, C6): it names the position the shown result was computed for,
 * read from the run's position tag (`main:10`, `variation:10`), never the position the pointer holds now. A result
 * without a tag falls back to the position on screen.
 */
export function resultPositionLabel(
  resultTag: string | null, screen: { viewTurn: number; viewingVariation: boolean },
): string {
  const match = resultTag === null ? null : /^(main|variation):(\d+)$/.exec(resultTag);
  const turn = match ? Number(match[2]) : screen.viewTurn;
  const variation = match ? match[1] === 'variation' : screen.viewingVariation;
  return `Turn ${turn} · ${variation ? 'variation' : 'main line'}`;
}

/**
 * Round 64 (T123): the regret as its chip shows it. Over 1 it reads as the two win chances it spans
 * (regretText), and the title keeps the real number on the score scale.
 */
export function regretView(name: string, side: SideAnalysis, regret: number): { text: string; title: string } {
  const from = side.bestNull?.alternative?.ev ?? side.best?.ev;
  const to = side.played?.ev;
  if (from === undefined || to === undefined) {
    return { text: winDeltaText(-regret), title: `${name} gave up this much win probability vs the engine's best.` };
  }
  const text = regretText(regret, from, to, side.faintedFraction);
  return text === winDeltaText(-regret)
    ? { text, title: `${name} gave up this much win probability vs the engine's best.` }
    : {
      text,
      title: `${name}'s win chance fell from ${winPctText(from, side.faintedFraction)} with the engine's line to ${winPctText(to, side.faintedFraction)} with the played choice ` +
        `(regret ${regret.toFixed(2)} on the score scale from −1 to 1).`,
    };
}
