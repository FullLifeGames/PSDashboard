import type { SideAnalysis, TurnAnalysis } from '../analysis.ts';
import { chanceRolled } from '../turn-analysis/luck.ts';
import { lostGround } from '../turn-analysis/risk.ts';
import {
  forcedClause, heldRiskNote, inaccuracyClause, readCreditClause, sackClause, sensitivityClause, streakClause, unansweredClause,
} from './clauses.ts';

type PlayerNames = [string, string];

/**
 * The notes that ride along on any attribution, p1 before p2 per kind:
 * sacks and inaccuracies (the decision clauses only speak at mistake level
 * and up; a sack replaces the inaccuracy note its demoted tier would
 * otherwise produce), forced equilibrium expectations (turn context, not
 * a verdict), entry-is-profit context (round 13), streak cumulation
 * (multi-turn expectation, never a verdict), and sensitivity hinges (the
 * softened tier may have silenced the decision clause entirely, but the
 * hinge itself is the finding).
 */
export function rideAlongSentences(analysis: TurnAnalysis, playerNames: PlayerNames): string[] {
  const sentences: string[] = [];
  // Round 67 (T22): the credit's luck rider says no roll is behind it when none went the residual's way;
  // (T59) a side that lost ground gets no credit sentence.
  const rolled = chanceRolled(analysis) !== false;
  const kinds: ((name: string, side: SideAnalysis, ownLuck: number | null, praised: boolean) => string | null)[] = [
    (name, side, ownLuck, praised) => sackClause(name, side) ??
      (praised ? readCreditClause(name, side, ownLuck, rolled) ?? heldRiskNote(name, side) : null) ?? inaccuracyClause(name, side),
    forcedClause,
    (_name, side) => unansweredClause(side),
    streakClause,
    sensitivityClause,
  ];
  const luck = analysis.chanceDelta;
  for (const clause of kinds) {
    const p1Note = clause(playerNames[0], analysis.p1, luck, !lostGround(analysis, 'p1'));
    const p2Note = clause(playerNames[1], analysis.p2, luck === null ? null : -luck, !lostGround(analysis, 'p2'));
    if (p1Note) sentences.push(p1Note);
    if (p2Note) sentences.push(p2Note);
  }
  return sentences;
}
