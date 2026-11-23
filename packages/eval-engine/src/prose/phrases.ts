import type { SideAnalysis } from '../analysis.ts';
import type { KoOddsInfo } from '../types.ts';
import { splitCombinedLabel } from '../turn-analysis/played-match.ts';
import { winDeltaText, winPctText } from '../winprob.ts';

/** The phrase helpers the turn summary and the game report share; pure template composition, sim-free and safe for the main bundle. */

/** Choice labels as prose ("→ Dragapult" becomes "switching to Dragapult"); a doubles pair reads per slot, a pair of moves keeps its label. */
export const phrase = (label: string): string => {
  const slots = splitCombinedLabel(label);
  if (slots.length < 2 || !slots.some(part => part.startsWith('→ '))) {
    return label.startsWith('→ ') ? `switching to ${label.slice(2)}` : label;
  }
  return slots
    .map(part => (part.startsWith('→ ') ? { verb: 'switching to', object: part.slice(2) } : { verb: 'playing', object: part }))
    .map((slot, index, all) => (index > 0 && all[index - 1].verb === slot.verb ? slot.object : `${slot.verb} ${slot.object}`))
    .join(' and ');
};

/**
 * An opponent reply label as prose: a doubles pair reads per slot like `phrase`; a singles reply keeps its string, since `phrase`
 * would turn "→ Heatran" into "switching to Heatran" and the singles pins read the raw label.
 */
export const phraseReplies = (label: string): string => (splitCombinedLabel(label).length > 1 ? phrase(label) : label);

/** The side row's hindsight sentence; a doubles pair of clicks reads in brackets, since a bare "Against playing ..." does not parse. */
export const hindsightLine = (read: { response: string; against: string; gain: number }): string => {
  const lead = splitCombinedLabel(read.against).length > 1
    ? `Against what was clicked (${phrase(read.against)})`
    : `Against ${phrase(read.against)}`;
  return `${lead}, ${phrase(read.response)} was worth ${winDeltaText(read.gain)} more.`;
};

/**
 * The gerund fits a subject, not an object, so what a side did reads as a verb per slot ("switched to Keldeo and played Protect").
 * A Tera or Mega marker stays with its move.
 */
export const playedVerb = (label: string): string =>
  splitCombinedLabel(label)
    .map(part => (part.startsWith('→ ') ? { verb: 'switched to', object: part.slice(2) } : { verb: 'played', object: part }))
    .map((slot, index, slots) => (index > 0 && slots[index - 1].verb === slot.verb ? slot.object : `${slot.verb} ${slot.object}`))
    .join(' and ');

/** A probability under 1 as a whole percent that never reads as certain (99.5% is 99, not 100); exactly 1 stays 100. */
export const percentBelowSure = (odds: number): number => (odds >= 1 ? 100 : Math.min(99, Math.round(odds * 100)));

type ForcedCaveat = 'none' | 'barring-crit' | 'sampled-rolls';

export const caveatWords = (caveat: ForcedCaveat): string =>
  caveat === 'barring-crit' ? ', barring a crit' : caveat === 'sampled-rolls' ? ' on the sampled rolls' : '';

/**
 * The words a forced-win proof adds to its sentence, in one place for the turn card and the game report: empty for a full proof,
 * the crit caveat, and below mass 1 the share of the rolls it covers (never above 99%).
 */
export function forcedQualifier(forced: { mass: number; caveat: ForcedCaveat }): string {
  const tail = caveatWords(forced.caveat);
  if (forced.mass >= 1) return tail;
  const share = percentBelowSure(forced.mass);
  return forced.caveat === 'sampled-rolls' ? ` in ${share}% of the sampled rolls` : ` in ${share}% of the rolls${tail}`;
}

/** What a forced-win proof says besides its mass (`ForcedWin.delayName`, `ForcedWin.choiceNames`). */
interface ForcedLean {
  delay?: string;
  delayName?: string;
  choiceNames?: { first: string; partner?: string };
}

/**
 * The clause a delayed win carries, in one place for the turn card and the game report; a result cached without the stall's
 * name says "a repeated stalling move".
 */
export function delayClause(forced: ForcedLean, past = false): string {
  if (!forced.delay) return '';
  return `; a repeated ${forced.delayName ?? 'stalling move'} only ${past ? 'delayed' : 'delays'} it`;
}

/** Names the winning choice when the proof wins through one the search's own list never held (a sure strike, doubles only). */
export function choiceSentence(forced: ForcedLean, past = false): string {
  const names = forced.choiceNames;
  if (!names) return '';
  const beside = names.partner ? `, with ${names.partner} beside it` : '';
  return ` The winning line ${past ? 'was' : 'is'} ${names.first}, which ${past ? 'struck' : 'strikes'} first${beside}.`;
}

/** The near-decided click: "sure KO" only at odds 1, else an "N% roll" (99.5% is no sure KO). */
export const rollText = (odds: number): string => (odds >= 1 ? 'sure KO' : `${percentBelowSure(odds)}% roll`);

export const choiceNoun = (label: string): string =>
  splitCombinedLabel(label)
    .map(part => (part.startsWith('→ ') ? `switch to ${part.slice(2)}` : part))
    .join(' and ');

/**
 * The engine's stand-in label ("stayed in (KO'd before acting)") names what it graded, not what happened, so a sentence says this
 * instead; the app's `neverActedText` builds on the same words.
 */
export const NEVER_ACTED_WORDS = 'knocked out before it moved, so the log shows no choice';

export const cameInstead = (name: string, side: SideAnalysis): string =>
  side.neverActed ? `${name} was ${NEVER_ACTED_WORDS}` : `${phrase(side.played!.label)} came instead`;

export const playedBest = (side: SideAnalysis) =>
  side.played !== null && side.best !== null && side.played.choice === side.best.choice;

/**
 * The recommendation to display: the true best, unless it is mechanically null against the opposing active and a co-optimal
 * alternative exists (grading stays priced against the true argmax). `swapped` tells callers to drop best-specific extras (the PV line).
 */
export const displayBest = (side: SideAnalysis): { label: string; ev: number; swapped: boolean } =>
  side.bestNull?.alternative
    ? { ...side.bestNull.alternative, swapped: true }
    : { label: side.best!.label, ev: side.best!.ev, swapped: false };

/** Regret is best ev minus played ev on the score scale [−1, 1], so it reaches 2; above 1 the card shows the two win chances instead of linear points. */
export const REGRET_SPAN_MIN = 1;

/** A regret as text: points up to `REGRET_SPAN_MIN`, above it the two win chances the regret spans. */
export const regretText = (regret: number, from: number, to: number, faintedFraction?: number | null): string =>
  regret > REGRET_SPAN_MIN ? `${winPctText(from, faintedFraction)} to ${winPctText(to, faintedFraction)}` : winDeltaText(-regret);

/** The two values a regret over 1 spans (the displayed best, the played choice), for the report's misplay. */
export const regretSpanFor = (side: SideAnalysis): { span?: { from: number; to: number; faintedFraction?: number } } =>
  side.played && side.best && (side.regret ?? 0) > REGRET_SPAN_MIN
    ? { span: { from: displayBest(side).ev, to: side.played.ev, ...(side.faintedFraction === undefined ? {} : { faintedFraction: side.faintedFraction }) } }
    : {};

/** The report's misplay of a body that fell before it moved: the stand-in's chance, for the sentence of `neverActedText`. */
export const neverActedFor = (side: SideAnalysis): { neverActed?: { ev: number; faintedFraction?: number } } =>
  side.neverActed && side.played
    ? { neverActed: { ev: side.played.ev, ...(side.faintedFraction === undefined ? {} : { faintedFraction: side.faintedFraction }) } }
    : {};

export const misplayExtrasFor = (side: SideAnalysis) => ({ ...regretSpanFor(side), ...neverActedFor(side) });

/** The null recommendation kept its place (no alternative): name the caveat. */
export const nullNote = (side: SideAnalysis): string =>
  side.bestNull && !side.bestNull.alternative && side.best
    ? ` (A caveat: ${side.best.label} does nothing here because ${side.bestNull.reason}; it only pays against the rest of the team.)`
    : '';

/** The three analytic odds shapes: "a 90% roll into a ~43% kill range", "kills ~43% of the time", "an 80% roll to connect". */
export function koPhrase(odds: { accuracy: number; killFraction: number }): string {
  const acc = Math.round(odds.accuracy * 100);
  const kill = Math.round(odds.killFraction * 100);
  const art = (n: number) => (n === 8 || n === 11 || n === 18 || (n >= 80 && n <= 89) ? 'an' : 'a');
  if (odds.accuracy < 1 && odds.killFraction < 1) return `${art(acc)} ${acc}% roll into a ~${kill}% kill range`;
  if (odds.killFraction < 1) return `kills ~${kill}% of the time`;
  return `${art(acc)} ${acc}% roll to connect`;
}

/** One named claim: a doubles label names the slot, singles the option. */
export const oddsPart =(name: string, odds: KoOddsInfo, copula: 'was' | 'is') =>
  `${phrase(odds.label ?? name)} ${odds.killFraction < 1 && odds.accuracy === 1 ? koPhrase(odds) : `${copula} ${koPhrase(odds)}`}`;

/**
 * One parenthetical naming the true odds behind the clause's claims; the "kills ~43% of the time" shape reads as a verb phrase,
 * the roll shapes take a copula. A claim whose hit the opponent's click stopped (`hitStopped`) is not quoted.
 */
export const oddsNote = (side: SideAnalysis): string => {
  const shown = displayBest(side);
  const shownOdds = side.bestNull?.alternative ? side.bestNull.alternative.koOdds : side.best?.koOdds;
  const parts: string[] = [];
  if (side.played?.koOdds && side.played.choice !== side.best?.choice && !side.hitStopped?.played) parts.push(oddsPart(side.played.label, side.played.koOdds, 'was'));
  if (shownOdds && !side.hitStopped?.best) parts.push(oddsPart(shown.label, shownOdds, 'is'));
  return parts.length > 0 ? ` (True odds: ${parts.join('; ')}.)` : '';
};

/** The engine's own equilibrium leans a different choice than the rendered recommendation: says so and names the replies that split them. */
export function conditionalNote(side: SideAnalysis): string {
  const conditional = side.conditional;
  if (!conditional || !side.best) return '';
  const segments = [
    conditional.bestWhen
      ? `${phrase(displayBest(side).label)} is the pick only if you expect ${phraseReplies(conditional.bestWhen)}`
      : null,
    conditional.mixWhen ? `${phrase(conditional.mixLabel)} covers ${phraseReplies(conditional.mixWhen)}` : null,
  ].filter((segment): segment is string => segment !== null);
  return ` The engine's own equilibrium leans ${phrase(conditional.mixLabel)} ` +
    `(${Math.round(conditional.mixWeight * 100)}%)${segments.length > 0 ? `: ${segments.join('; ')}` : ''}.`;
}

/** One-line rendering of an exploitative read: the payoff spread stays visible, since a read is a priced gamble, not a mean. */
export function formatRead(read: {
  choice: { label: string };
  net: number;
  breakdown: { label: string; prob: number; value: number }[];
}, faintedFraction?: number | null): string {
  const target = read.choice.label.startsWith('→ ')
    ? `switch ${read.choice.label.slice(2)}`
    : read.choice.label;
  const parts = read.breakdown
    .map(entry => `${winPctText(entry.value, faintedFraction)} if ${entry.label} (${Math.round(entry.prob * 100)}% likely)`)
    .join(', ');
  return `Read: ${target}${parts ? `; ${parts}` : ''}; net ${winPctText(read.net, faintedFraction)}.`;
}
