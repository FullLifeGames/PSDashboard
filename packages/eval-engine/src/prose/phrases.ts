import type { SideAnalysis } from '../analysis.ts';
import type { KoOddsInfo } from '../types.ts';
import { splitCombinedLabel } from '../turn-analysis/played-match.ts';
import { winDeltaText, winPctText } from '../winprob.ts';

/**
 * The phrase helpers the turn summary and the game report share: choice
 * labels as prose, the recommendation to display (the null-move swap), the
 * true-odds parentheticals, and the conditional-equilibrium note. Pure
 * template composition; sim-free, main-bundle safe.
 */

/** Choice labels read as prose: "→ Dragapult" becomes "switching to Dragapult". */
export const phrase = (label: string) => (label.startsWith('→ ') ? `switching to ${label.slice(2)}` : label);

/**
 * Round 64 (T123): the gerund fits a subject ("switching to Heatran was
 * worth"), not an object. What a side did reads as a verb per slot
 * ("switched to Keldeo", "switched to Calyrex-Shadow and played Protect"),
 * a line after "the safe" as a noun per slot ("switch to Volcanion",
 * "switch to Chi-Yu and Collision Course→Chien-Pao"). A doubles pair splits
 * into its slots, a Tera or Mega marker staying with its move.
 */
export const playedVerb = (label: string): string =>
  splitCombinedLabel(label)
    .map(part => (part.startsWith('→ ') ? { verb: 'switched to', object: part.slice(2) } : { verb: 'played', object: part }))
    // Two slots of one kind share the verb: "played Tailwind and Solar Beam→Groudon".
    .map((slot, index, slots) => (index > 0 && slots[index - 1].verb === slot.verb ? slot.object : `${slot.verb} ${slot.object}`))
    .join(' and ');

/**
 * Round 64 (T123): a probability under 1 as a whole percent that never
 * reads as certain (99.5% is 99, not 100); exactly 1 stays 100.
 */
export const percentBelowSure = (odds: number): number => (odds >= 1 ? 100 : Math.min(99, Math.round(odds * 100)));

/** The near-decided click: a "sure KO" only at odds 1, else an "N% roll" (T123: 99.5% is no sure KO). */
export const rollText = (odds: number): string => (odds >= 1 ? 'sure KO' : `${percentBelowSure(odds)}% roll`);

/** The noun form of a line, for "the safe …" (see playedVerb). */
export const choiceNoun = (label: string): string =>
  splitCombinedLabel(label)
    .map(part => (part.startsWith('→ ') ? `switch to ${part.slice(2)}` : part))
    .join(' and ');

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

/**
 * Round 64 (T123, decision 22): regret is best ev minus played ev on the
 * score scale [−1, 1], so it reaches 2. Above 1 the played choice turned a
 * board the engine's line held into one it loses, and the linear points
 * ("−84%") claim more than the two win chances the card shows. Such a
 * regret reads as those two chances, from the engine's line to the played
 * choice ("85% to 19%", 2630685175 t8); at or under 1 the points stay.
 */
export const REGRET_SPAN_MIN = 1;

export const regretText = (regret: number, from: number, to: number): string =>
  regret > REGRET_SPAN_MIN ? `${winPctText(from)} to ${winPctText(to)}` : winDeltaText(-regret);

/** The two values a regret over 1 spans (the displayed best, the played choice), for the report's misplay. */
export const regretSpanFor = (side: SideAnalysis): { span?: { from: number; to: number } } =>
  side.played && side.best && (side.regret ?? 0) > REGRET_SPAN_MIN
    ? { span: { from: displayBest(side).ev, to: side.played.ev } }
    : {};

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

/** One named claim: a doubles label (round 56) names the slot, singles the option. */
export const oddsPart =(name: string, odds: KoOddsInfo, copula: 'was' | 'is') =>
  `${phrase(odds.label ?? name)} ${odds.killFraction < 1 && odds.accuracy === 1 ? koPhrase(odds) : `${copula} ${koPhrase(odds)}`}`;

/**
 * One parenthetical naming the true odds behind the clause's claims — the
 * played move's and/or the recommendation's. The "kills ~43% of the time"
 * shape already reads as a verb phrase; the roll shapes take a copula.
 */
export const oddsNote = (side: SideAnalysis): string => {
  const shown = displayBest(side);
  const shownOdds = side.bestNull?.alternative ? side.bestNull.alternative.koOdds : side.best?.koOdds;
  const parts: string[] = [];
  if (side.played?.koOdds && side.played.choice !== side.best?.choice) parts.push(oddsPart(side.played.label, side.played.koOdds, 'was'));
  if (shownOdds) parts.push(oddsPart(shown.label, shownOdds, 'is'));
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
