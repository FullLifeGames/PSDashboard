import type { SideAnalysis } from '../analysis.ts';
import type { KoOddsInfo } from '../types.ts';
import { splitCombinedLabel } from '../turn-analysis/played-match.ts';
import { winDeltaText, winPctText } from '../winprob.ts';

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

/** An opponent reply label as prose; a singles reply keeps its raw label, which the singles pins read. */
export const phraseReplies = (label: string): string => (splitCombinedLabel(label).length > 1 ? phrase(label) : label);

/** The hindsight sentence; a doubles pair reads in brackets, since a bare "Against playing ..." does not parse. */
export const hindsightLine = (read: { response: string; against: string; gain: number }): string => {
  const lead = splitCombinedLabel(read.against).length > 1
    ? `Against what was clicked (${phrase(read.against)})`
    : `Against ${phrase(read.against)}`;
  return `${lead}, ${phrase(read.response)} was worth ${winDeltaText(read.gain)} more.`;
};

export const playedVerb = (label: string): string =>
  splitCombinedLabel(label)
    .map(part => (part.startsWith('→ ') ? { verb: 'switched to', object: part.slice(2) } : { verb: 'played', object: part }))
    .map((slot, index, slots) => (index > 0 && slots[index - 1].verb === slot.verb ? slot.object : `${slot.verb} ${slot.object}`))
    .join(' and ');

export const percentBelowSure = (odds: number): number => (odds >= 1 ? 100 : Math.min(99, Math.round(odds * 100)));

type ForcedCaveat = 'none' | 'barring-crit' | 'sampled-rolls';

export const caveatWords = (caveat: ForcedCaveat): string =>
  caveat === 'barring-crit' ? ', barring a crit' : caveat === 'sampled-rolls' ? ' on the sampled rolls' : '';

export function forcedQualifier(forced: { mass: number; caveat: ForcedCaveat }): string {
  const tail = caveatWords(forced.caveat);
  if (forced.mass >= 1) return tail;
  const share = percentBelowSure(forced.mass);
  return forced.caveat === 'sampled-rolls' ? ` in ${share}% of the sampled rolls` : ` in ${share}% of the rolls${tail}`;
}

interface ForcedLean {
  delay?: string;
  delayName?: string;
  choiceNames?: { first: string; partner?: string };
}

/** A result cached without the stall's name says "a repeated stalling move". */
export function delayClause(forced: ForcedLean, past = false): string {
  if (!forced.delay) return '';
  return `; a repeated ${forced.delayName ?? 'stalling move'} only ${past ? 'delayed' : 'delays'} it`;
}

/** Names the winning choice when the proof wins through one the search never listed (a sure strike, doubles only). */
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

/** The engine's stand-in label names what it graded, not what happened, so a sentence says this instead. */
export const NEVER_ACTED_WORDS = 'knocked out before it moved, so the log shows no choice';

export const GAME_ENDED_WORDS = 'cut off by the end of the game, so the log shows no choice';

export const cameInstead = (name: string, side: SideAnalysis): string =>
  side.neverActed ? `${name} was ${NEVER_ACTED_WORDS}` : `${phrase(side.played!.label)} came instead`;

export const playedBest = (side: SideAnalysis) =>
  side.played !== null && side.best !== null && side.played.choice === side.best.choice;

/** The true best, unless it is mechanically null and a co-optimal one exists; `swapped` says to drop the PV line. */
export const displayBest = (side: SideAnalysis): { label: string; ev: number; swapped: boolean } =>
  side.bestNull?.alternative
    ? { ...side.bestNull.alternative, swapped: true }
    : { label: side.best!.label, ev: side.best!.ev, swapped: false };

/** Regret is best minus played ev on the [−1, 1] score scale, so it reaches 2; above this the card shows chances. */
export const REGRET_SPAN_MIN = 1;

/** A regret as text: points up to `REGRET_SPAN_MIN`, above it the two win chances the regret spans. */
export const regretText = (regret: number, from: number, to: number, faintedFraction?: number | null): string =>
  regret > REGRET_SPAN_MIN ? `${winPctText(from, faintedFraction)} to ${winPctText(to, faintedFraction)}` : winDeltaText(-regret);

export const regretSpanFor = (side: SideAnalysis): { span?: { from: number; to: number; faintedFraction?: number } } =>
  side.played && side.best && (side.regret ?? 0) > REGRET_SPAN_MIN
    ? { span: { from: displayBest(side).ev, to: side.played.ev, ...(side.faintedFraction === undefined ? {} : { faintedFraction: side.faintedFraction }) } }
    : {};

export const neverActedFor = (side: SideAnalysis): { neverActed?: { ev: number; faintedFraction?: number } } =>
  side.neverActed && side.played
    ? { neverActed: { ev: side.played.ev, ...(side.faintedFraction === undefined ? {} : { faintedFraction: side.faintedFraction }) } }
    : {};

export const misplayExtrasFor = (side: SideAnalysis) => ({ ...regretSpanFor(side), ...neverActedFor(side) });

export const nullNote = (side: SideAnalysis): string =>
  side.bestNull && !side.bestNull.alternative && side.best
    ? ` (A caveat: ${side.best.label} does nothing here because ${side.bestNull.reason}; it only pays against the rest of the team.)`
    : '';

export function koPhrase(odds: { accuracy: number; killFraction: number }): string {
  const acc = Math.round(odds.accuracy * 100);
  const kill = Math.round(odds.killFraction * 100);
  const art = (n: number) => (n === 8 || n === 11 || n === 18 || (n >= 80 && n <= 89) ? 'an' : 'a');
  if (odds.accuracy < 1 && odds.killFraction < 1) return `${art(acc)} ${acc}% roll into a ~${kill}% kill range`;
  if (odds.killFraction < 1) return `kills ~${kill}% of the time`;
  return `${art(acc)} ${acc}% roll to connect`;
}

export const oddsPart =(name: string, odds: KoOddsInfo, copula: 'was' | 'is') =>
  `${phrase(odds.label ?? name)} ${odds.killFraction < 1 && odds.accuracy === 1 ? koPhrase(odds) : `${copula} ${koPhrase(odds)}`}`;

export const oddsNote = (side: SideAnalysis): string => {
  const shown = displayBest(side);
  const shownOdds = side.bestNull?.alternative ? side.bestNull.alternative.koOdds : side.best?.koOdds;
  const parts: string[] = [];
  if (side.played?.koOdds && side.played.choice !== side.best?.choice && !side.hitStopped?.played) parts.push(oddsPart(side.played.label, side.played.koOdds, 'was'));
  if (shownOdds && !side.hitStopped?.best) parts.push(oddsPart(shown.label, shownOdds, 'is'));
  return parts.length > 0 ? ` (True odds: ${parts.join('; ')}.)` : '';
};

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

/** One-line exploitative read: the payoff spread stays visible, since a read is a priced gamble, not a mean. */
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
