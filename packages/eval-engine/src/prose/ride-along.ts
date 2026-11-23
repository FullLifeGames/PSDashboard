import type { SideAnalysis, TurnAnalysis } from '../analysis.ts';
import { chanceRolled } from '../turn-analysis/luck.ts';
import { lostGround } from '../turn-analysis/risk.ts';
import {
  forcedClause, heldRiskNote, inaccuracyClause, readCreditClause, sackClause, sensitivityClause, streakClause, unansweredClause,
} from './clauses.ts';

type PlayerNames = [string, string];

/** What a ride-along note judges, by its words: an unpunished risk or a light inaccuracy. */
export type NamedJudgement = 'risk' | 'inaccuracy';

/**
 * The first note of a side: a sack, a read credit or a held risk (the last two only on a side that kept ground), else the
 * inaccuracy. `judged` names a risk or an inaccuracy, the two a quiet card may not follow with "Neither side made a mistake."
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
 * The notes that ride along on any attribution, p1 before p2 per kind. A sack replaces the inaccuracy note its demoted tier would
 * otherwise produce; the decision clauses only speak at mistake level and up. Returns the sentences and the judgements they name.
 */
export function rideAlongOf(analysis: TurnAnalysis, playerNames: PlayerNames): { sentences: string[]; judged: NamedJudgement[] } {
  const sentences: string[] = [];
  const judged: NamedJudgement[] = [];
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
