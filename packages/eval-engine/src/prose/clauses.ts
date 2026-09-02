import { diffChoices, playedSetupMove, type SideAnalysis } from '../analysis';
import type { RankedChoice } from '../types';
import { winDeltaText, winPctText } from '../winprob';
import { conditionalNote, displayBest, koPhrase, nullNote, oddsNote, phrase } from './phrases';

/**
 * The per-side clauses of the turn summary: paid-off reads, misplays,
 * inaccuracies, forced expectations, sacks, streaks, sensitivity hinges,
 * and unanswered entries. Every clause returns null when it has nothing to
 * say; the summary decides the order.
 */

/** A flagged risk that won value over the safe guarantee — praised, not blamed. */
function readClause(name: string, side: SideAnalysis, opponent: SideAnalysis): string | null {
  if (!side.riskPaidOff || !side.played || !side.safe) return null;
  const came = opponent.played ? `; ${phrase(opponent.played.label)} came instead` : '';
  const priced = side.played.punishedBy ? ` The floor priced in ${side.played.punishedBy}${came}.` : '';
  const horizon = side.riskPayoffTurn
    ? side.riskPayoffTurn === 1 ? ' one turn later' : ` ${side.riskPayoffTurn} turns later`
    : '';
  const click = side.played.koOdds ? ` The click was ${koPhrase(side.played.koOdds)}.` : '';
  return `${name} played ${phrase(side.played.label)} — a read that paid off${horizon}, ` +
    `${winDeltaText(side.riskPayoff ?? 0)} over the safe ${phrase(side.safe.label)} (${winPctText(side.safe.worstCase)} guaranteed).${priced}${click}`;
}

export function sideClause(name: string, side: SideAnalysis, opponent: SideAnalysis): string | null {
  const clause = readClause(name, side, opponent) ?? mistakeClause(name, side, opponent);
  if (!clause) return null;
  // A charitable partial grade must say so — one slot's choice was never
  // visible (flinch/sleep), so the combo shown is the best consistent one.
  return side.playedPartial
    ? `${clause} (Partner's action hidden — graded on the visible slot.)`
    : clause;
}

/** The principal variation after a choice, as a ", then A · B → C · D" tail. */
const lineOf = (choice: { line?: { p1: string; p2: string }[] }) =>
  choice.line && choice.line.length > 0
    ? `, then ${choice.line.map(step => `${step.p1} · ${step.p2}`).join(' → ')}`
    : '';

/**
 * An unpunished read gets neutral framing: the engine's line is "safe",
 * not "better" — maximin's guarantee always merely holds the current
 * assessment, and holding is no achievement. When the opponent model's
 * own best response matches the play, credit the read explicitly.
 */
function unpunishedReadClause(
  name: string,
  side: SideAnalysis,
  opponent: SideAnalysis,
  played: RankedChoice,
  safe: RankedChoice,
  why: string,
  caveat: string,
): string {
  const came = played.punishedBy && opponent.played
    ? `its floor risked ${played.punishedBy} (down to ${winPctText(played.worstCase)}); ${phrase(opponent.played.label)} came instead`
    : `its floor sat at ${winPctText(played.worstCase)}`;
  const framing = side.riskWasRead
    ? `a read against the opponent's tendencies: ${came}`
    : `a read: ${came}`;
  return `${name} played ${phrase(played.label)} — ${framing}. ` +
    `The engine's safe line was ${phrase(safe.label)} (${winPctText(safe.worstCase)} guaranteed)${lineOf(safe)}.${why}${caveat}${oddsNote(side)}`;
}

/**
 * The punished misplay reads in EV terms: what the choice was worth against
 * balanced play, vs what the engine's line was worth. A blunder earns the
 * word; a mistake keeps the softer framing. A null-swapped recommendation
 * drops the PV line and the why clause — both belong to the true best.
 */
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
    return `${name} played ${phrase(played.label)} (${winPctText(played.ev)}) — ` +
      `a blunder; clearly better was ${phrase(shown.label)} (${winPctText(shown.ev)})${line}.${reasons}`;
  }
  return `${name} played ${phrase(played.label)} (${winPctText(played.ev)}); ` +
    `safer was ${phrase(shown.label)} (${winPctText(shown.ev)})${line}.${reasons}`;
}

function mistakeClause(name: string, side: SideAnalysis, opponent: SideAnalysis): string | null {
  if (side.sacrifice) return null; // the sack note carries the turn instead
  if ((side.tier !== 'mistake' && side.tier !== 'blunder') || !side.played || !side.best) return null;
  const difference = diffChoices(side.played, side.best);
  const why = difference ? ` The difference: ${difference}.` : '';
  const setup = playedSetupMove(side);
  const caveat = setup
    ? ` (${setup} is a setup move — its payoff lies past the search horizon, so the regret may be overstated.)`
    : '';
  if (side.riskUnpunished && side.safe) {
    return unpunishedReadClause(name, side, opponent, side.played, side.safe, why, caveat);
  }
  return punishedMisplayClause(name, side, side.played, side.best, why, caveat);
}

/** Sub-verdict note: a light imprecision worth naming, not blaming. */
export function inaccuracyClause(name: string, side: SideAnalysis): string | null {
  if (side.tier !== 'inaccuracy' || !side.played || !side.best) return null;
  const shown = displayBest(side);
  return `${name}'s ${phrase(side.played.label)} was an inaccuracy — ` +
    `${phrase(shown.label)} was slightly better (${winPctText(shown.ev)} vs ${winPctText(side.played.ev)}).` +
    `${oddsNote(side)}${nullNote(side)}${conditionalNote(side)}`;
}

/**
 * A near-pure equilibrium SWITCH is an expectation worth prose: the side is
 * effectively forced to give something up, and the reader should hear that
 * as a sentence, not read it off a matrix header percentage.
 */
export function forcedClause(name: string, side: SideAnalysis): string | null {
  if (!side.forcedMix) return null;
  // The conditional already told this story — one equilibrium mention is enough.
  if (side.conditional?.mixLabel === side.forcedMix.label) return null;
  const base = `The equilibrium all but commits ${name} to ${phrase(side.forcedMix.label)} ` +
    `here (${Math.round(side.forcedMix.weight * 100)}%)`;
  if (!side.played) return `${base}.`;
  return side.played.label === side.forcedMix.label
    ? `${base} — which is what happened.`
    : `${base} — ${phrase(side.played.label)} came instead.`;
}

/**
 * A deliberate low-cost sack: neutral framing, no blame vocabulary — the
 * engine cannot see the intent (Trick absorption, momentum), only the cost.
 */
export function sackClause(name: string, side: SideAnalysis): string | null {
  if (!side.sacrifice) return null;
  const pct = Math.round(side.sacrifice.hpFraction * 100);
  if (side.sacrifice.stayed) {
    if (side.sacrifice.verified) {
      return `${name} fed ${side.sacrifice.name} (${pct}% HP) — the line's priced floor is what happened, ` +
        `and the windowed payoff repaid the sack's full regret with a real edge on top; ` +
        `verified as a win-condition sacrifice, not graded as a misplay.`;
    }
    return `${name} fed ${side.sacrifice.name} (${pct}% HP) — the line's priced floor is what happened, ` +
      `and the line's payoff lands within the payoff window; graded as a sacrifice, not a misplay.`;
  }
  return side.sacrifice.healthy
    ? `${name} sacked a healthy ${side.sacrifice.name} (${pct}% HP) while decisively ahead — simplification, not graded as a misplay.`
    : `${name} sacked ${side.sacrifice.name} (${pct}% HP) — a low-cost trade, not graded as a misplay.`;
}

/** Multi-turn expectation: the narrative half of round 6 — never a grade. */
export function streakClause(name: string, side: SideAnalysis): string | null {
  if (!side.streakOdds) return null;
  const streak = side.streakOdds;
  const n = streak.n;
  const nth = `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
  const pct = Math.round(streak.cumulative * 100);
  if (streak.event === 'crit') {
    return `${name}'s ${nth} straight attack into the boosted ${streak.defenderSpecies} — cumulative crit odds ` +
      `reach ~${pct}% across the streak, and a crit ignores those boosts.`;
  }
  return `${name}'s ${nth} ${streak.moveLabel} into ${streak.defenderSpecies} — ${streak.event} fishing compounds to ~${pct}% across the streak.`;
}

/**
 * The verdict hinges on a guessed item: name the split so the reader knows
 * the grade depends on hidden information, not on the engine's confidence.
 */
export function sensitivityClause(name: string, side: SideAnalysis): string | null {
  if (!side.sensitivity) return null;
  const alternatives = side.sensitivity.alternatives
    .map(alternative => `${alternative.item}: ${alternative.tier === 'none' ? 'fine' : alternative.tier}`)
    .join(' · ');
  return `${name}'s verdict hinges on ${side.sensitivity.species}'s item (${alternatives}).`;
}

/**
 * Entry-is-profit context (round 13): bringing in a mon the opponent has no
 * live race answer to is board logic worth naming, not a verdict (648453
 * t13: the Lopunny switch). The round-14 switch-in stage names the one
 * standing mon still holding the pair — the expert's literal "no remaining
 * switch-ins" state.
 */
export function unansweredClause(side: SideAnalysis): string | null {
  if (!side.unanswered) return null;
  if (side.unanswered.heldBy) {
    return `${side.unanswered.species} has no switch-in left on the other side — only the standing ` +
      `${side.unanswered.heldBy} holds it, and from the bench the opponent can only sacrifice into it.`;
  }
  return `${side.unanswered.species} has no live answer on the other side — any turn that ` +
    'brings it in cleanly turns profit, and the opponent can only sacrifice into it.';
}
