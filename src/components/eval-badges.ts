import type { LeadSideAnalysis, TurnAnalysis } from '@fulllifegames/eval-engine';

/**
 * Round 63 (T116): the team-preview verdict a side's lead may carry. In
 * doubles (a led pair) the reading sits close to a coin flip — the matrix
 * and the tree name a different best lead on 76 of 92 sides, and only 2 of
 * the 14 matrix lead mistakes on the 46 bank previews hold under the tree —
 * so a doubles lead gets no mistake or inaccuracy, only the engine's pick.
 */
export function leadTier(side: LeadSideAnalysis): LeadSideAnalysis['tier'] {
  return isPairLead(side) ? undefined : side.tier;
}

/** A doubles lead: the led (or the engine's) choice names a pair. Round 64 (T123): the turn-0 card reads it too. */
export function isPairLead(side: LeadSideAnalysis): boolean {
  const label = side.played?.label ?? side.best?.label ?? '';
  return label.includes(' + ');
}

interface Badge {
  text: string;
  color: string;
}

/** One side's decision verdict: an unpunished risk, or the graded misplay. */
function decisionBadge(side: TurnAnalysis['p1'], name: string): Badge {
  if (side.riskUnpunished) return { text: `${name} took a risk (unpunished)`, color: '#b6a46a' };
  const decisionWord = side.tier === 'blunder' ? 'blundered' : 'misplayed';
  return { text: `${name} ${decisionWord}`, color: side.tier === 'blunder' ? '#ff7a7a' : '#f3a6a6' };
}

/** Shared attribution label + color for analysis and report views. */
export function attributionBadge(analysis: TurnAnalysis, playerNames: [string, string]): Badge {
  switch (analysis.attribution) {
    case 'p1-decision': return decisionBadge(analysis.p1, playerNames[0]);
    case 'p2-decision': return decisionBadge(analysis.p2, playerNames[1]);
    case 'both-decision': return analysis.p1.riskUnpunished && analysis.p2.riskUnpunished
      ? { text: 'both took risks (unpunished)', color: '#b6a46a' }
      : { text: 'both sides misplayed', color: '#f3a6a6' };
    case 'p1-read': return { text: `${playerNames[0]}'s read paid off`, color: '#8c8' };
    case 'p2-read': return { text: `${playerNames[1]}'s read paid off`, color: '#8c8' };
    case 'both-read': return { text: 'both sides\' reads paid off', color: '#8c8' };
    case 'chance': return { text: 'chance swing (rolls, crits, reveals)', color: '#b6a46a' };
    case 'shift':
      return analysis.playedTracking === false
        ? { text: 'advantage shifted', color: '#b6a46a' }
        : { text: 'advantage shifted (no blunder)', color: '#b6a46a' };
    case 'unclear': return { text: 'unclear (a choice never surfaced)', color: '#778' };
    default: return { text: 'quiet turn', color: '#778' };
  }
}
