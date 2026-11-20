import { describe, expect, test } from 'vitest';
import type { TurnAnalysis } from '../src/analysis';
import { summarizeTurn } from '../src/summary';
import { buildScene, GAMES } from './read-against-click-builder';

/**
 * Round 89 (FT-1a): a body knocked out before it moved has no choice in the log; the engine stands a stay-in in for it
 * (`phantomStayIn`, singles only). The card's sentences must not credit that side with a played line or print the engine's label
 * inside a sentence: 655336 t28 said "Both sides played the engine's preferred line.", 562428 t21 said "... but stayed in
 * (KO'd before acting) came instead." Doubles parse no such stand-in (`phantomStayIn` returns null for a doubles parse), so the
 * rows below run on the singles scene; the doubles scene must keep its sentences unchanged.
 */

const PHANTOM = 'stayed in (KO’d before acting)';
const WORDS = 'knocked out before it moved, so the log shows no choice';
const singles = GAMES[0][1];
const doubles = GAMES[1][1];

/** The scene's opponent of `reader` p1 is p2: it never acted, and its stand-in is the engine's own pick (655336 t28). */
function neverActedScene(make: () => ReturnType<typeof singles>, patchBeta: Partial<TurnAnalysis['p2']> = {}, patchAlpha: Partial<TurnAnalysis['p1']> = {}) {
  const { analysis, names } = buildScene(make, { reader: 'p1', kind: 'inaccuracy', playedCell: 0.325, safeCell: 0.454, lostGround: 0.1 });
  const unhinted = (side: TurnAnalysis['p1']): TurnAnalysis['p1'] => ({ ...side, hindsightRead: undefined });
  const asBest = (side: TurnAnalysis['p1']): TurnAnalysis['p1'] => ({ ...side, played: side.best, tier: undefined, regret: 0 });
  const beta = analysis.p2;
  const stayIn = { ...beta.best!, label: PHANTOM };
  const p1: TurnAnalysis['p1'] = { ...asBest(unhinted(analysis.p1)), ...patchAlpha };
  const p2: TurnAnalysis['p2'] = { ...unhinted(beta), played: stayIn, best: stayIn, neverActed: true, tier: undefined, regret: 0, ...patchBeta };
  return { analysis: { ...analysis, p1, p2 }, names };
}

describe('a side that was knocked out before it moved (singles)', () => {
  test('"Both sides played the engine\'s preferred line." names only the side that moved (655336 t28)', () => {
    const { analysis, names } = neverActedScene(singles, {}, { forcedMix: { label: 'Switch-In', weight: 0.95 } });
    const text = summarizeTurn(analysis, names);
    expect(text).not.toContain('Both sides played');
    expect(text).toContain("Alpha played the engine's preferred line.");
    expect(text).not.toContain(PHANTOM);
  });

  test('the quiet card with the colon names only the side that moved', () => {
    const { analysis, names } = neverActedScene(singles);
    const text = summarizeTurn(analysis, names);
    expect(text).not.toContain('both sides played');
    expect(text).toContain("A quiet turn: Alpha played the engine's preferred line.");
  });

  test('the mover not on the engine line keeps the plain sentences', () => {
    const { analysis, names } = neverActedScene(singles, {}, { played: null });
    const text = summarizeTurn(analysis, names);
    expect(text).not.toContain('played the engine');
    expect(text).toContain('A quiet turn.');
  });

  test('the equilibrium sentence says what happened in the row\'s words, not the stand-in label (562428 t21)', () => {
    const { analysis, names } = neverActedScene(singles, { forcedMix: { label: '→ Landorus-Therian', weight: 0.93 } });
    const text = summarizeTurn(analysis, names);
    expect(text).toContain(`switching to Landorus-Therian here (93%), but Beta was ${WORDS}.`);
    expect(text).not.toContain(PHANTOM);
    expect(text).not.toContain('came instead');
  });

  test('a read the opponent never answered says so in the row\'s words, not the label', () => {
    const { analysis, names } = neverActedScene(singles, {}, {});
    const own = analysis.p1;
    const patched: TurnAnalysis = {
      ...analysis,
      attribution: 'p1-read', swing: 0.2,
      p1: { ...own, played: own.played && { ...own.played, punishedBy: 'Taunt' }, riskPaidOff: true, riskPayoff: 0.2, safe: own.safe, tier: undefined },
    };
    const text = summarizeTurn(patched, names);
    expect(text).toContain('a read that paid off');
    expect(text).toContain(`; Beta was ${WORDS}`);
    expect(text).not.toContain(PHANTOM);
    expect(text).not.toContain('KO’d before acting');
  });

  test('a doubles card keeps "came instead" with the played label (no stand-in exists there)', () => {
    const { analysis, names } = buildScene(doubles, { reader: 'p1', kind: 'inaccuracy', playedCell: 0.325, safeCell: 0.454, lostGround: 0.1 });
    const patched: TurnAnalysis = { ...analysis, p2: { ...analysis.p2, forcedMix: { label: analysis.p2.best!.label, weight: 0.95 } } };
    const text = summarizeTurn(patched, names);
    expect(text).toContain('came instead');
    expect(text).not.toContain('knocked out before it moved');
  });
});
