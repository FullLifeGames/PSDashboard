import type { SideAnalysis, TurnAnalysis } from '../analysis.ts';
import { chanceRolled } from '../turn-analysis/luck.ts';
import { lostGround } from '../turn-analysis/risk.ts';
import {
  forcedClause, heldRiskNote, inaccuracyClause, readCreditClause, sackClause, sensitivityClause, streakClause, unansweredClause,
} from './clauses.ts';

type PlayerNames = [string, string];

/** What a ride-along note judges, by its words: an unpunished risk or a light inaccuracy (round 89, FT-1). */
export type NamedJudgement = 'risk' | 'inaccuracy';

/**
 * The first note of a side: a sack, a read credit or a held risk (the last two only on a side that kept ground), else the
 * inaccuracy. `judged` says when the note names a risk or an inaccuracy, the two a quiet card may not follow with "Neither side made a
 * mistake." (ruling 43, FT4a).
 */
function sideNote(
  name: string, side: SideAnalysis, ownLuck: number | null, rolled: boolean, praised: boolean,
): { text: string; judged?: NamedJudgement } | null {
  const sack = sackClause(name, side);
  if (sack) return { text: sack };
  if (praised) {
    const credit = readCreditClause(name, side, ownLuck, rolled);
    if (credit) return { text: credit };
    const held = heldRiskNote(name, side);
    if (held) return { text: held, judged: 'risk' };
  }
  const inaccuracy = inaccuracyClause(name, side);
  return inaccuracy ? { text: inaccuracy, judged: 'inaccuracy' } : null;
}

/**
 * The notes that ride along on any attribution, p1 before p2 per kind:
 * sacks and inaccuracies (the decision clauses only speak at mistake level
 * and up; a sack replaces the inaccuracy note its demoted tier would
 * otherwise produce), forced equilibrium expectations (turn context, not
 * a verdict), entry-is-profit context (round 13), streak cumulation
 * (multi-turn expectation, never a verdict), and sensitivity hinges (the
 * softened tier may have silenced the decision clause entirely, but the
 * hinge itself is the finding).
 *
 * Returns the sentences, and which judgements the card names in them.
 */
export function rideAlongOf(analysis: TurnAnalysis, playerNames: PlayerNames): { sentences: string[]; judged: NamedJudgement[] } {
  const sentences: string[] = [];
  const judged: NamedJudgement[] = [];
  // Round 67 (T22): the credit's luck rider says no roll is behind it when none went the residual's way;
  // (T59) a side that lost ground gets no credit sentence.
  const rolled = chanceRolled(analysis) !== false;
  const luck = analysis.chanceDelta;
  const sides = [
    { key: 'p1' as const, name: playerNames[0], ownLuck: luck },
    { key: 'p2' as const, name: playerNames[1], ownLuck: luck === null ? null : -luck },
  ];
  const kinds: ((name: string, side: SideAnalysis, ownLuck: number | null, praised: boolean) => string | null)[] = [
    (name, side, ownLuck, praised) => {
      const note = sideNote(name, side, ownLuck, rolled, praised);
      if (note?.judged) judged.push(note.judged);
      return note?.text ?? null;
    },
    forcedClause,
    (_name, side) => unansweredClause(side),
    streakClause,
    sensitivityClause,
  ];
  for (const clause of kinds) {
    for (const { key, name, ownLuck } of sides) {
      const note = clause(name, analysis[key], ownLuck, !lostGround(analysis, key));
      if (note) sentences.push(note);
    }
  }
  return { sentences, judged };
}
