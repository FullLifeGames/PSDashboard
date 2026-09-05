import { test, expect, describe } from 'vitest';
import type { TurnAnalysis } from '@fulllifegames/eval-engine';
import { attributionBadge } from '../src/components/eval-badges';

// The attribution badge is the one label the turn card and the game report
// share for "who moved the needle": only the attribution and the two
// sides' verdict flags decide it.
const side = (extra: Partial<TurnAnalysis['p1']> = {}) => ({ tier: 'inaccuracy', riskUnpunished: false, riskPaidOff: false, ...extra }) as TurnAnalysis['p1'];
const analysis = (attribution: TurnAnalysis['attribution'], p1: Partial<TurnAnalysis['p1']> = {}, p2: Partial<TurnAnalysis['p2']> = {}, extra: Partial<TurnAnalysis> = {}) =>
  ({ turn: 3, attribution, p1: side(p1), p2: side(p2), ...extra }) as unknown as TurnAnalysis;

const names: [string, string] = ['Alice', 'Bob'];

describe('attributionBadge', () => {
  test('a decision names the side and its tier; an unpunished risk reads as a risk', () => {
    expect(attributionBadge(analysis('p1-decision', { tier: 'blunder' }), names)).toEqual({ text: 'Alice blundered', color: '#ff7a7a' });
    expect(attributionBadge(analysis('p2-decision', {}, { tier: 'mistake' }), names)).toEqual({ text: 'Bob misplayed', color: '#f3a6a6' });
    expect(attributionBadge(analysis('p1-decision', { riskUnpunished: true }), names)).toEqual({ text: 'Alice took a risk (unpunished)', color: '#b6a46a' });
  });

  test('both sides: misplays unless both merely took risks', () => {
    expect(attributionBadge(analysis('both-decision'), names).text).toBe('both sides misplayed');
    expect(attributionBadge(analysis('both-decision', { riskUnpunished: true }, { riskUnpunished: true }), names).text).toBe('both took risks (unpunished)');
  });

  test('reads, chance, shifts, and unclear turns have their own words', () => {
    expect(attributionBadge(analysis('p1-read'), names)).toEqual({ text: "Alice's read paid off", color: '#8c8' });
    expect(attributionBadge(analysis('p2-read'), names).text).toBe("Bob's read paid off");
    expect(attributionBadge(analysis('both-read'), names).text).toBe("both sides' reads paid off");
    expect(attributionBadge(analysis('chance'), names).text).toBe('chance swing (rolls, crits, reveals)');
    expect(attributionBadge(analysis('shift'), names).text).toBe('advantage shifted (no blunder)');
    expect(attributionBadge(analysis('shift', {}, {}, { playedTracking: false }), names).text).toBe('advantage shifted');
    expect(attributionBadge(analysis('unclear'), names)).toEqual({ text: 'unclear (a choice never surfaced)', color: '#778' });
    expect(attributionBadge(analysis('none' as TurnAnalysis['attribution']), names).text).toBe('quiet turn');
  });
});
