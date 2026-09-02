import { TIER_THRESHOLDS, type SideAnalysis } from '../../lib/eval/analysis';
import type { RankedChoice } from '../../lib/eval/types';
import { winPctText } from '../../lib/eval/winprob';

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
    ? `${side.played.label} (${winPctText(side.played.ev)})`
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
