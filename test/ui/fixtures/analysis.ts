import { winPercent, type LeadAnalysis, type SideAnalysis, type TurnAnalysis } from '@fulllifegames/eval-engine';
import { rankedChoice } from './eval-result';

export const chanceGap = (better: number, played: number, share?: number): string => `−${winPercent(better, share) - winPercent(played, share)}%`;

const p1Line = () => rankedChoice('move earthquake', 'Earthquake', 0.35);
const p2Line = () => rankedChoice('move leechseed', 'Leech Seed', -0.3);

export function sideAnalysis(overrides: Partial<SideAnalysis> = {}): SideAnalysis {
  const best = p1Line();
  return { playedRaw: { kind: 'move', name: 'Earthquake' }, played: best, best, safe: best, regret: 0, ...overrides };
}

export function misplayedSide(tier: 'mistake' | 'blunder' = 'mistake', overrides: Partial<SideAnalysis> = {}): SideAnalysis {
  const best = rankedChoice('move earthquake', 'Earthquake', 0.35, { punishedBy: 'Protect' });
  const played = rankedChoice('move stoneedge', 'Stone Edge', tier === 'blunder' ? -0.15 : 0.1, { punishedBy: 'Leech Seed' });
  return {
    playedRaw: { kind: 'move', name: 'Stone Edge' }, played, best, safe: best,
    regret: Math.round((best.ev - played.ev) * 100) / 100, tier, ...overrides,
  };
}

export function turnAnalysis(turn: number, overrides: Partial<TurnAnalysis> = {}): TurnAnalysis {
  const leech = p2Line();
  return {
    turn, scoreBefore: 0.1, scoreAfter: 0.15, swing: 0.05, playedOutcome: 0.12, decisionDelta: 0.02, chanceDelta: 0.03,
    attribution: 'quiet',
    p1: sideAnalysis(),
    p2: sideAnalysis({ playedRaw: { kind: 'move', name: 'Leech Seed' }, played: leech, best: leech, safe: leech }),
    ...overrides,
  };
}

export function leadAnalysis(overrides: Partial<LeadAnalysis> = {}): LeadAnalysis {
  const p1Best = rankedChoice('team 1', 'Lead Garchomp', 0.2);
  const p2Best = rankedChoice('team 2', 'Lead Rotom-Wash', -0.1);
  const p2Played = rankedChoice('team 1', 'Lead Ferrothorn', -0.4);
  return {
    p1: { played: p1Best, best: p1Best, regret: 0 },
    p2: { played: p2Played, best: p2Best, regret: 0.3, tier: 'mistake' },
    ...overrides,
  };
}
