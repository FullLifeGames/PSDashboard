import { describe, expect, test } from 'vitest';
import type { TurnAnalysis } from '../src/analysis';
import { quietVoice, summarizeTurn } from '../src/summary';
import { buildScene, GAMES, READERS } from './read-against-click-builder';

/**
 * Round 89 (user ruling B8a, wording G-Q3 option 2 of the plan): "A quiet turn." stands only on a card that highlights nothing
 * else. Beside another sentence (a risk sentence, an equilibrium switch, an unanswered entry, a decided or predictive sentence,
 * an inaccuracy note) or a shown hindsight hint on a side row, the card says "Neither side made a mistake." and the badge reads
 * "no mistake". A side with a mistake or blunder tier makes that sentence false: the card then writes no sentence. Singles and
 * doubles share every rule; the labels come from the shared builder (read-against-click-builder.ts).
 */

const NEITHER = 'Neither side made a mistake.';
const BOTH_BEST = "Both sides played the engine's preferred line.";
const HINT = 'Against the Protect actually clicked, Earthquake was worth +20% more.';

describe.each(GAMES)('%s', (_game, make) => {
  describe.each(READERS)('read by %s', reader => {
    /**
     * A quiet card with nothing else on it: an inaccuracy risk whose side lost ground keeps today's silent card (D-Q2 a). The
     * builder's lost-ground side also carries a shown hindsight hint (2663093831 t1), which the bare card does without.
     */
    const bare = () => {
      const built = buildScene(make, { reader, kind: 'inaccuracy', playedCell: 0.325, safeCell: 0.454, lostGround: 0.1 });
      const { analysis } = built;
      const unhinted = (side: TurnAnalysis['p1']): TurnAnalysis['p1'] => ({ ...side, hindsightRead: undefined });
      return { ...built, analysis: { ...analysis, p1: unhinted(analysis.p1), p2: unhinted(analysis.p2) } };
    };
    const withSide = (patch: Partial<TurnAnalysis['p1']>, other: Partial<TurnAnalysis['p1']> = {}) => {
      const { analysis, names } = bare();
      const own = reader;
      const opp = reader === 'p1' ? 'p2' : 'p1';
      const patched: TurnAnalysis = { ...analysis, [own]: { ...analysis[own], ...patch }, [opp]: { ...analysis[opp], ...other } };
      return { analysis: patched, names, text: summarizeTurn(patched, names) };
    };

    test('a quiet card with nothing else keeps "A quiet turn."', () => {
      const { analysis, names } = bare();
      expect(analysis.attribution).toBe('quiet');
      const text = summarizeTurn(analysis, names);
      expect(text).toContain('A quiet turn.');
      expect(text).not.toContain(NEITHER);
      expect(quietVoice(analysis, names)).toBe('alone');
    });

    test('a hindsight hint on a side row takes the word "quiet" off the card', () => {
      const { analysis, names, text } = withSide({ hindsightRead: { response: 'Earthquake', against: 'Protect', gain: 0.2, shown: true, line: HINT } });
      expect(text).toContain(NEITHER);
      expect(text).not.toContain('quiet');
      expect(quietVoice(analysis, names)).toBe('no-mistake');
    });

    test('a hint the row does not show leaves the card quiet', () => {
      const { analysis, names, text } = withSide({ hindsightRead: { response: 'Earthquake', against: 'Protect', gain: 0.2, line: HINT } });
      expect(text).toContain('A quiet turn.');
      expect(quietVoice(analysis, names)).toBe('alone');
    });

    test('a switch the equilibrium did not expect says "Neither side made a mistake." before it (648453 t13)', () => {
      const { text } = withSide({ forcedMix: { label: 'Switch-In', weight: 0.95 } });
      expect(text).toContain(`${NEITHER} The equilibrium all but commits`);
      expect(text).not.toContain('quiet');
    });

    test('an unanswered entry does the same', () => {
      const { text } = withSide({ unanswered: { species: 'Lopunny-Mega' } });
      expect(text).toContain(`${NEITHER} Lopunny-Mega has no live answer`);
      expect(text).not.toContain('quiet');
    });

    test('a decided sentence and a predictive sentence count as another sentence', () => {
      const decided = withSide({ decided: { species: 'Garchomp', announce: true } });
      expect(decided.text).toContain(NEITHER);
      expect(decided.text).not.toContain('quiet');
      const predictive = withSide({ predictiveRead: { expect: 'Protect', confidence: 0.9, response: 'Earthquake', over: 'Recover', gain: 0.2 } });
      expect(predictive.text).toContain(NEITHER);
      expect(predictive.text).not.toContain('quiet');
    });

    test('an inaccuracy note beside the quiet turn: an inaccuracy is "a minor imprecision, not a mistake"', () => {
      const { analysis, names } = bare();
      const side = analysis[reader];
      const patched: TurnAnalysis = { ...analysis, [reader]: { ...side, safeAgainstClick: undefined, riskPaidOff: undefined, tier: 'inaccuracy' } };
      const text = summarizeTurn(patched, names);
      expect(text).toContain('was an inaccuracy');
      expect(text).toContain(NEITHER);
      expect(text).not.toContain('quiet');
    });

    test('the risk sentence of B6 beside the quiet turn (648453 t8)', () => {
      const { analysis, names } = buildScene(make, { reader, kind: 'gamble', playedCell: 0.189, safeCell: 0.19 });
      expect(analysis.attribution).toBe('quiet');
      const text = summarizeTurn(analysis, names);
      expect(text).toContain('a risk that went unpunished');
      expect(text).toContain(NEITHER);
      expect(text).not.toContain('quiet');
      expect(quietVoice(analysis, names)).toBe('no-mistake');
    });

    test('both sides on the engine line with another sentence: "Both sides played the engine\'s preferred line." and no quiet turn', () => {
      const { analysis, names } = bare();
      const asBest = (side: TurnAnalysis['p1']): TurnAnalysis['p1'] => ({ ...side, played: side.best });
      const patched: TurnAnalysis = {
        ...analysis,
        p1: { ...asBest(analysis.p1), ...(reader === 'p1' ? { forcedMix: { label: 'Switch-In', weight: 0.95 } } : {}) },
        p2: { ...asBest(analysis.p2), ...(reader === 'p2' ? { forcedMix: { label: 'Switch-In', weight: 0.95 } } : {}) },
      };
      const text = summarizeTurn(patched, names);
      expect(text).toContain(`${BOTH_BEST} The equilibrium all but commits`);
      expect(text).not.toContain('quiet');
      expect(text).not.toContain(NEITHER);
      expect(quietVoice(patched, names)).toBe('no-mistake');
    });

    test('both sides on the engine line with nothing else: the quiet form with the colon stays', () => {
      const { analysis, names } = bare();
      const asBest = (side: TurnAnalysis['p1']): TurnAnalysis['p1'] => ({ ...side, played: side.best });
      const patched: TurnAnalysis = { ...analysis, p1: asBest(analysis.p1), p2: asBest(analysis.p2) };
      expect(summarizeTurn(patched, names)).toContain("A quiet turn: both sides played the engine's preferred line.");
      expect(quietVoice(patched, names)).toBe('alone');
    });

    test('a side with a mistake tier that lost ground: no sentence beside another sentence, never "Neither side made a mistake."', () => {
      const { analysis, names, text } = withSide({ tier: 'mistake', forcedMix: { label: 'Switch-In', weight: 0.95 } });
      expect(text).toContain('The equilibrium all but commits');
      expect(text).not.toContain(NEITHER);
      expect(text).not.toContain('quiet');
      expect(quietVoice(analysis, names)).toBe('silent');
      const blunder = withSide({ tier: 'blunder', hindsightRead: { response: 'Earthquake', against: 'Protect', gain: 0.2, shown: true, line: HINT } });
      expect(blunder.text).not.toContain(NEITHER);
      expect(blunder.text).not.toContain('quiet');
    });

    test('a turn without played actions: no sentence beside another sentence, "A quiet turn." alone', () => {
      const { analysis, names } = bare();
      const untracked: TurnAnalysis = { ...analysis, playedTracking: false, attribution: 'quiet' };
      expect(summarizeTurn(untracked, names)).toContain('A quiet turn.');
      const decided: TurnAnalysis = { ...untracked, p1: { ...untracked.p1, decided: { species: 'Garchomp', announce: true } } };
      const text = summarizeTurn(decided, names);
      expect(text).toContain('practically decided');
      expect(text).not.toContain('quiet');
      expect(text).not.toContain(NEITHER);
    });
  });
});
