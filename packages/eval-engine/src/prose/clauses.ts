import { TIER_THRESHOLDS, diffChoices, playedSetupMove, type SideAnalysis } from '../analysis.ts';
import type { RankedChoice } from '../types.ts';
import { winDeltaText, winPctText } from '../winprob.ts';
import { formatLine } from './line.ts';
import { cameInstead, choiceNoun, conditionalNote, displayBest, nullNote, oddsNote, oddsPart, phrase, phraseReplies, playedVerb } from './phrases.ts';

function readClause(name: string, side: SideAnalysis, opponent: SideAnalysis, opponentName: string): string | null {
  if (!side.riskPaidOff || !side.played || !side.safe) return null;
  const came = opponent.played ? `; ${cameInstead(opponentName, opponent)}` : '';
  const held = side.safeAgainstClick;
  const beat = held ? `, and against it the play beat the safe line by ${winDeltaText(held.playedValue - held.safeValue)}` : '';
  const priced = side.played.punishedBy ? ` The floor priced in ${phraseReplies(side.played.punishedBy)}${came}${beat}.` : '';
  const horizon = side.riskPayoffTurn
    ? side.riskPayoffTurn === 1 ? ' one turn later' : ` ${side.riskPayoffTurn} turns later`
    : '';
  const odds = side.hitStopped?.played ? undefined : side.played.koOdds;
  const click = odds ? ` ${oddsPart('The click', odds, 'was')}.` : '';
  return `${name} ${playedVerb(side.played.label)}: a read that paid off${horizon}, ` +
    `${winDeltaText(side.riskPayoff ?? 0)} over the safe ${choiceNoun(side.safe.label)} (${winPctText(side.safe.worstCase, side.faintedFraction)} guaranteed).${priced}${click}`;
}

export function heldRiskClause(name: string, side: SideAnalysis): string | null {
  const held = side.safeAgainstClick;
  if (!held || side.riskPaidOff || !side.played || !side.safe) return null;
  const gap = held.safeValue - held.playedValue;
  const versus = Math.round(gap * 50) === 0 ? 'did as well' : `was worth ${winDeltaText(gap)} more`;
  const priced = side.played.punishedBy
    ? ` The floor priced in ${phraseReplies(side.played.punishedBy)}; ${phrase(held.against)} came instead.`
    : '';
  const odds = side.hitStopped?.played ? undefined : side.played.koOdds;
  const click = odds ? ` ${oddsPart('The click', odds, 'was')}.` : '';
  return `${name} ${playedVerb(side.played.label)}: a risk that went unpunished.${priced} ` +
    `Against it the safe ${choiceNoun(side.safe.label)} ${versus}.${click}`;
}

const partialNote = (side: SideAnalysis, verb: 'graded' | 'credited'): string =>
  side.playedPartial ? ` (Partner's action hidden; ${verb} on the visible slot.)` : '';

/** `praised` false (the side lost ground) silences a paid-off read; no misplay clause takes its place. */
export function sideClause(name: string, side: SideAnalysis, opponent: SideAnalysis, praised = true, opponentName = 'the opponent'): string | null {
  if (side.riskPaidOff && !praised) return null;
  const clause = readClause(name, side, opponent, opponentName) ?? mistakeClause(name, side, opponent, opponentName);
  return clause ? `${clause}${partialNote(side, 'graded')}` : null;
}

const lineOf = (choice: { line?: { p1: string; p2: string }[] }) =>
  choice.line && choice.line.length > 0 ? `, then ${formatLine(choice.line)}` : '';

// Neutral framing: "safe", not "better", because maximin's guarantee only holds the current assessment.
function unpunishedReadClause(
  name: string,
  side: SideAnalysis,
  opponent: SideAnalysis,
  opponentName: string,
  played: RankedChoice,
  safe: RankedChoice,
  why: string,
  caveat: string,
): string {
  const came = played.punishedBy && opponent.played
    ? `its floor risked ${phraseReplies(played.punishedBy)} (down to ${winPctText(played.worstCase, side.faintedFraction)}); ${cameInstead(opponentName, opponent)}`
    : `its floor sat at ${winPctText(played.worstCase, side.faintedFraction)}`;
  const framing = side.riskWasRead
    ? `a read against the opponent's tendencies: ${came}`
    : `a read: ${came}`;
  return `${name} ${playedVerb(played.label)} as ${framing}. ` +
    `The engine's safe line was ${phrase(safe.label)} (${winPctText(safe.worstCase, side.faintedFraction)} guaranteed)${lineOf(safe)}.${why}${caveat}${oddsNote(side)}`;
}

// A null-swapped recommendation drops the PV line and the why clause: both belong to the true best.
function punishedMisplayClause(
  name: string,
  side: SideAnalysis,
  played: RankedChoice,
  best: RankedChoice,
  why: string,
  caveat: string,
): string {
  const shown = displayBest(side);
  const line = shown.swapped ? '' : lineOf(best);
  const reasons = `${shown.swapped ? '' : why}${caveat}${nullNote(side)}${conditionalNote(side)}${oddsNote(side)}`;
  if (side.tier === 'blunder') {
    return `${name} ${playedVerb(played.label)} (${winPctText(played.ev, side.faintedFraction)}), ` +
      `a blunder; clearly better was ${phrase(shown.label)} (${winPctText(shown.ev, side.faintedFraction)})${line}.${reasons}`;
  }
  return `${name} ${playedVerb(played.label)} (${winPctText(played.ev, side.faintedFraction)}); ` +
    `safer was ${phrase(shown.label)} (${winPctText(shown.ev, side.faintedFraction)})${line}.${reasons}`;
}

function mistakeClause(name: string, side: SideAnalysis, opponent: SideAnalysis, opponentName: string): string | null {
  if (side.sacrifice) return null;
  if ((side.tier !== 'mistake' && side.tier !== 'blunder') || !side.played || !side.best) return null;
  const difference = diffChoices(side.played, side.best);
  const why = difference ? ` The difference: ${difference}.` : '';
  const setup = playedSetupMove(side);
  const caveat = setup
    ? ` (${setup} is a setup move: its payoff lies past the search horizon, so the regret may be overstated.)`
    : '';
  if (side.safeAgainstClick && !side.riskPaidOff) return heldRiskClause(name, side);
  if (side.riskUnpunished && side.safe) {
    return unpunishedReadClause(name, side, opponent, opponentName, side.played, side.safe, why, caveat);
  }
  return punishedMisplayClause(name, side, side.played, side.best, why, caveat);
}

/** Praise, never a verdict; `rolled` false words the rider's swing as one with no roll behind it. */
export function readCreditClause(name: string, side: SideAnalysis, ownLuck: number | null, rolled = true): string | null {
  const credit = side.readCredit;
  if (!credit || !side.played || !side.safe) return null;
  const when = credit.payoffTurn
    ? `${credit.payoffTurn === 1 ? 'one turn later' : `${credit.payoffTurn} turns later`}, before the rolls,`
    : 'before the rolls,';
  const luck = ownLuck !== null && Math.abs(ownLuck) >= TIER_THRESHOLDS.inaccuracy
    ? rolled
      ? ` On top of that, luck contributed ${winDeltaText(ownLuck)} for ${name}.`
      : ` On top of that, the estimate moved ${winDeltaText(ownLuck)} for ${name} with no roll behind it.`
    : '';
  return `${name} ${playedVerb(side.played.label)}, a read the engine gave no weight: ${when} it stood ` +
    `${winDeltaText(credit.payoff)} over the safe ${choiceNoun(side.safe.label)} (${winPctText(side.safe.worstCase, side.faintedFraction)} guaranteed).` +
    `${partialNote(side, 'credited')}${luck}`;
}

export function heldRiskNote(name: string, side: SideAnalysis): string | null {
  if (side.tier === 'mistake' || side.tier === 'blunder') return null;
  const clause = heldRiskClause(name, side);
  return clause ? `${clause}${partialNote(side, 'graded')}` : null;
}

export function inaccuracyClause(name: string, side: SideAnalysis): string | null {
  if (side.tier !== 'inaccuracy' || side.riskPaidOff || side.safeAgainstClick || !side.played || !side.best) return null;
  const shown = displayBest(side);
  return `${name}'s ${phrase(side.played.label)} was an inaccuracy; ` +
    `${phrase(shown.label)} was slightly better (${winPctText(shown.ev, side.faintedFraction)} vs ${winPctText(side.played.ev, side.faintedFraction)}).` +
    `${oddsNote(side)}${nullNote(side)}${conditionalNote(side)}${partialNote(side, 'graded')}`;
}

export function forcedClause(name: string, side: SideAnalysis): string | null {
  if (!side.forcedMix) return null;
  if (side.conditional?.mixLabel === side.forcedMix.label) return null;
  const base = `The equilibrium all but commits ${name} to ${phrase(side.forcedMix.label)} ` +
    `here (${Math.round(side.forcedMix.weight * 100)}%)`;
  if (!side.played) return `${base}.`;
  return side.played.label === side.forcedMix.label
    ? `${base}, which is what happened.`
    : `${base}, but ${cameInstead(name, side)}.`;
}

/** Neutral framing, no blame: the engine cannot see the intent (Trick absorption, momentum), only the cost. */
export function sackClause(name: string, side: SideAnalysis): string | null {
  const sentence = sackSentence(name, side);
  const others = side.sacrifice?.alsoFell;
  return sentence && others && others.length > 0 ? `${sentence} ${name} also lost ${others.join(' and ')} on this turn.` : sentence;
}

function sackSentence(name: string, side: SideAnalysis): string | null {
  if (!side.sacrifice) return null;
  const pct = Math.round(side.sacrifice.hpFraction * 100);
  if (side.sacrifice.hazard) {
    return `${name} sacked ${side.sacrifice.name} (${pct}% HP) into the entry hazards; it fell before it could act, ` +
      'and the next Pokémon came in on a free switch' +
      (side.sacrifice.verified ? '; the payoff over the next turns repaid it, so it reads as a sacrifice, not a misplay.'
        : '; graded as a sacrifice, not a misplay.');
  }
  if (side.sacrifice.stayed) {
    if (side.sacrifice.verified) {
      return `${name} fed ${side.sacrifice.name} (${pct}% HP): the line's priced floor is what happened, ` +
        `and the windowed payoff repaid the sack's full regret with a real edge on top; ` +
        `verified as a win-condition sacrifice, not graded as a misplay.`;
    }
    return `${name} fed ${side.sacrifice.name} (${pct}% HP): the line's priced floor is what happened, ` +
      `and the line's payoff lands within the payoff window; graded as a sacrifice, not a misplay.`;
  }
  return side.sacrifice.healthy
    ? `${name} sacked a healthy ${side.sacrifice.name} (${pct}% HP) while decisively ahead: simplification, not graded as a misplay.`
    : `${name} sacked ${side.sacrifice.name} (${pct}% HP): a low-cost trade, not graded as a misplay.`;
}

export function streakClause(name: string, side: SideAnalysis): string | null {
  if (!side.streakOdds) return null;
  const streak = side.streakOdds;
  const n = streak.n;
  const nth = `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
  const pct = Math.round(streak.cumulative * 100);
  if (streak.event === 'crit') {
    return `${name}'s ${nth} straight attack into the boosted ${streak.defenderSpecies}: cumulative crit odds ` +
      `reach ~${pct}% across the streak, and a crit ignores those boosts.`;
  }
  return `${name}'s ${nth} ${streak.moveLabel} into ${streak.defenderSpecies}: ${streak.event} fishing compounds to ~${pct}% across the streak.`;
}

export function sensitivityClause(name: string, side: SideAnalysis): string | null {
  if (!side.sensitivity) return null;
  const alternatives = side.sensitivity.alternatives
    .map(alternative => `${alternative.item}: ${alternative.tier === 'none' ? 'fine' : alternative.tier}`)
    .join(' · ');
  return `${name}'s verdict hinges on ${side.sensitivity.species}'s item (${alternatives}).`;
}

export function unansweredClause(side: SideAnalysis): string | null {
  if (!side.unanswered) return null;
  if (side.unanswered.heldBy) {
    return `${side.unanswered.species} has no switch-in left on the other side; only the standing ` +
      `${side.unanswered.heldBy} holds it, and from the bench the opponent can only sacrifice into it.`;
  }
  return `${side.unanswered.species} has no live answer on the other side, so any turn that ` +
    'brings it in cleanly turns profit, and the opponent can only sacrifice into it.';
}
