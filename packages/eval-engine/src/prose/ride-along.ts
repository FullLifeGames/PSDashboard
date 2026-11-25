import type { SideAnalysis, TurnAnalysis } from '../analysis.ts';
import { chanceRolled } from '../turn-analysis/luck.ts';
import { lostGround } from '../turn-analysis/risk.ts';
import {
  forcedClause, heldRiskNote, inaccuracyClause, readCreditClause, sackClause, sensitivityClause, streakClause, unansweredClause,
} from './clauses.ts';

type PlayerNames = [string, string];

export type NamedJudgement = 'risk' | 'inaccuracy';

// `judged` names a risk or an inaccuracy, the two a quiet card may not follow with "Neither side made a mistake."
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

/** A sack replaces the inaccuracy note its demoted tier would give; decision clauses speak only from mistake up. */
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
