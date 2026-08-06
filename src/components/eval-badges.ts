import type { TurnAnalysis } from '../lib/eval/analysis';

/** Shared attribution label + color for analysis and report views. */
export function attributionBadge(analysis: TurnAnalysis, playerNames: [string, string]): { text: string; color: string } {
  const decisionWord = (side: TurnAnalysis['p1']) => (side.tier === 'blunder' ? 'blundered' : 'misplayed');
  switch (analysis.attribution) {
    case 'p1-decision': return analysis.p1.riskUnpunished
      ? { text: `${playerNames[0]} took a risk (unpunished)`, color: '#b6a46a' }
      : { text: `${playerNames[0]} ${decisionWord(analysis.p1)}`, color: analysis.p1.tier === 'blunder' ? '#ff7a7a' : '#f3a6a6' };
    case 'p2-decision': return analysis.p2.riskUnpunished
      ? { text: `${playerNames[1]} took a risk (unpunished)`, color: '#b6a46a' }
      : { text: `${playerNames[1]} ${decisionWord(analysis.p2)}`, color: analysis.p2.tier === 'blunder' ? '#ff7a7a' : '#f3a6a6' };
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
