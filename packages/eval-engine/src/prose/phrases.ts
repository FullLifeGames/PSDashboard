import type { SideAnalysis } from '../analysis.ts';
import { winPctText } from '../winprob.ts';

/**
 * The phrase helpers the turn summary and the game report share: choice
 * labels as prose, the recommendation to display (the null-move swap), the
 * true-odds parentheticals, and the conditional-equilibrium note. Pure
 * template composition; sim-free, main-bundle safe.
 */

/** Choice labels read as prose: "→ Dragapult" becomes "switching to Dragapult". */
export const phrase = (label: string) => (label.startsWith('→ ') ? `switching to ${label.slice(2)}` : label);

export const playedBest = (side: SideAnalysis) =>
  side.played !== null && side.best !== null && side.played.choice === side.best.choice;

/**
 * What the clause RECOMMENDS: the true best, unless it is mechanically null
 * against the opposing active and a co-optimal alternative exists — then the
 * alternative's label/EV display in its place (the grading upstream stays
 * priced against the true argmax; the swap lives within the rank-tie
 * epsilon). `swapped` tells callers to drop best-specific extras (the PV
 * line) that would misattach to the substitute.
 */
export const displayBest = (side: SideAnalysis): { label: string; ev: number; swapped: boolean } =>
  side.bestNull?.alternative
    ? { ...side.bestNull.alternative, swapped: true }
    : { label: side.best!.label, ev: side.best!.ev, swapped: false };

/** The null recommendation kept its place (no alternative): name the caveat. */
export const nullNote = (side: SideAnalysis): string =>
  side.bestNull && !side.bestNull.alternative && side.best
    ? ` (A caveat: ${side.best.label} does nothing here — ${side.bestNull.reason}; it only pays against the rest of the team.)`
    : '';

/**
 * The three analytic odds shapes (round 6 expectation grounding): "a 90%
 * roll into a ~43% kill range" / "kills ~43% of the time" / "an 80% roll
 * to connect". Exported for the report's seeds sentence.
 */
export function koPhrase(odds: { accuracy: number; killFraction: number }): string {
  const acc = Math.round(odds.accuracy * 100);
  const kill = Math.round(odds.killFraction * 100);
  const art = (n: number) => (n === 8 || n === 11 || n === 18 || (n >= 80 && n <= 89) ? 'an' : 'a');
  if (odds.accuracy < 1 && odds.killFraction < 1) return `${art(acc)} ${acc}% roll into a ~${kill}% kill range`;
  if (odds.killFraction < 1) return `kills ~${kill}% of the time`;
  return `${art(acc)} ${acc}% roll to connect`;
}

/**
 * One parenthetical naming the true odds behind the clause's claims — the
 * played move's and/or the recommendation's. The "kills ~43% of the time"
 * shape already reads as a verb phrase; the roll shapes take a copula.
 */
export const oddsNote = (side: SideAnalysis): string => {
  const shown = displayBest(side);
  const shownOdds = side.bestNull?.alternative ? side.bestNull.alternative.koOdds : side.best?.koOdds;
  const parts: string[] = [];
  if (side.played?.koOdds && side.played.choice !== side.best?.choice) {
    const odds = side.played.koOdds;
    parts.push(`${phrase(side.played.label)} ${odds.killFraction < 1 && odds.accuracy === 1 ? koPhrase(odds) : `was ${koPhrase(odds)}`}`);
  }
  if (shownOdds) {
    parts.push(`${phrase(shown.label)} ${shownOdds.killFraction < 1 && shownOdds.accuracy === 1 ? koPhrase(shownOdds) : `is ${koPhrase(shownOdds)}`}`);
  }
  return parts.length > 0 ? ` (True odds: ${parts.join('; ')}.)` : '';
};

/**
 * The engine's own equilibrium leans a different choice than the rendered
 * recommendation: say so, and name the opponent replies that split them —
 * the recommendation becomes conditional instead of absolute (653785 t19).
 */
export function conditionalNote(side: SideAnalysis): string {
  const conditional = side.conditional;
  if (!conditional || !side.best) return '';
  const segments = [
    conditional.bestWhen
      ? `${phrase(displayBest(side).label)} is the pick only if you expect ${conditional.bestWhen}`
      : null,
    conditional.mixWhen ? `${phrase(conditional.mixLabel)} covers ${conditional.mixWhen}` : null,
  ].filter((segment): segment is string => segment !== null);
  return ` The engine's own equilibrium leans ${phrase(conditional.mixLabel)} ` +
    `(${Math.round(conditional.mixWeight * 100)}%)${segments.length > 0 ? ` — ${segments.join('; ')}` : ''}.`;
}

/**
 * One-line rendering of an exploitative read recommendation (the Read row):
 * the payoff SPREAD stays visible — a read is a priced gamble, not a mean.
 */
export function formatRead(read: {
  choice: { label: string };
  net: number;
  breakdown: { label: string; prob: number; value: number }[];
}): string {
  const target = read.choice.label.startsWith('→ ')
    ? `switch ${read.choice.label.slice(2)}`
    : read.choice.label;
  const parts = read.breakdown
    .map(entry => `${winPctText(entry.value)} if ${entry.label} (${Math.round(entry.prob * 100)}% likely)`)
    .join(', ');
  return `Read: ${target}${parts ? ` — ${parts}` : ''} — net ${winPctText(read.net)}.`;
}
