import { chanceRolled, quietVoice, shownAttribution, type LeadSideAnalysis, type TurnAnalysis } from '@fulllifegames/eval-engine';

/**
 * The team-preview verdict a side's lead may carry. A doubles lead (a led pair) sits close to a coin flip: matrix and tree name a
 * different best lead on 76 of 92 sides, so a doubles lead gets no mistake or inaccuracy, only the engine's pick.
 */
export function leadTier(side: LeadSideAnalysis): LeadSideAnalysis['tier'] {
  return isPairLead(side) ? undefined : side.tier;
}

export function isPairLead(side: LeadSideAnalysis): boolean {
  const label = side.played?.label ?? side.best?.label ?? '';
  return label.includes(' + ');
}

interface Badge {
  text: string;
  color: string;
}

function decisionBadge(side: TurnAnalysis['p1'], name: string): Badge {
  if (side.riskUnpunished) return { text: `${name} took a risk (unpunished)`, color: '#b6a46a' };
  const decisionWord = side.tier === 'blunder' ? 'blundered' : 'misplayed';
  return { text: `${name} ${decisionWord}`, color: side.tier === 'blunder' ? '#ff7a7a' : '#f3a6a6' };
}

function quietBadge(voice: ReturnType<typeof quietVoice>): Badge {
  switch (voice) {
    case 'no-mistake': return { text: 'no mistake', color: '#778' };
    case 'risk': return { text: 'risk (unpunished)', color: '#b6a46a' };
    case 'inaccuracy': return { text: 'small inaccuracy', color: '#b6a46a' };
    default: return { text: 'quiet turn', color: '#778' };
  }
}

/** The shared attribution label and color for analysis and report views: the attribution as shown, so a read whose side lost ground shows the turn's movement, never "read paid off". */
export function attributionBadge(analysis: TurnAnalysis, playerNames: [string, string]): Badge {
  switch (shownAttribution(analysis)) {
    case 'p1-decision': return decisionBadge(analysis.p1, playerNames[0]);
    case 'p2-decision': return decisionBadge(analysis.p2, playerNames[1]);
    case 'both-decision': return analysis.p1.riskUnpunished && analysis.p2.riskUnpunished
      ? { text: 'both took risks (unpunished)', color: '#b6a46a' }
      : { text: 'both sides misplayed', color: '#f3a6a6' };
    case 'p1-read': return { text: `${playerNames[0]}'s read paid off`, color: '#8c8' };
    case 'p2-read': return { text: `${playerNames[1]}'s read paid off`, color: '#8c8' };
    case 'both-read': return { text: 'both sides\' reads paid off', color: '#8c8' };
    // Without a roll in the swing's direction the estimate moved on its own.
    case 'chance': return chanceRolled(analysis) === false
      ? { text: 'estimate moved (no roll behind it)', color: '#b6a46a' }
      : { text: 'chance swing (rolls, crits, reveals)', color: '#b6a46a' };
    case 'shift':
      return analysis.playedTracking === false
        ? { text: 'advantage shifted', color: '#b6a46a' }
        : { text: 'advantage shifted (no blunder)', color: '#b6a46a' };
    case 'unclear': return { text: 'unclear (a choice never surfaced)', color: '#778' };
    // "quiet turn" stands only where the card highlights nothing else; a card that names an unpunished risk or an inaccuracy says so on the badge, never "no mistake".
    default: return quietBadge(quietVoice(analysis, playerNames));
  }
}
