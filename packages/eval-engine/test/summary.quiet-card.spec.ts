import { describe, expect, test } from 'vitest';
import type { TurnAnalysis, SideAnalysis } from '../src/analysis';
import { quietVoice, summarizeTurn } from '../src/summary';
import { buildScene, GAMES, READERS, type Scene } from './read-against-click-builder';
import { analyzeTurn, type AnalyzeTurnParams } from '../src/analysis';
import type { EvalResult, RankedChoice, KoOddsInfo } from '../src/types';
import { deniedEndSentence } from '../src/denied-end';

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
      // Round 89 (FT-1, ruling 43 FT4a): the card names the inaccuracy, so it starts with that sentence and never claims that no one erred.
      expect(text).toContain('was an inaccuracy');
      expect(text).not.toContain(NEITHER);
      expect(text).not.toContain('quiet');
      expect(text).toMatch(/^The estimate [^.]*\. \S+'s .* was an inaccuracy; /);
      expect(quietVoice(patched, names)).toBe('inaccuracy');
    });

    test('the risk sentence of B6 beside the quiet turn (648453 t8)', () => {
      const { analysis, names } = buildScene(make, { reader, kind: 'gamble', playedCell: 0.189, safeCell: 0.19 });
      expect(analysis.attribution).toBe('quiet');
      const text = summarizeTurn(analysis, names);
      // Round 89 (FT-1, ruling 43 FT4a): the card names the risk; "Neither side made a mistake." gives way (2663093831 t6).
      expect(text).toContain('a risk that went unpunished');
      expect(text).not.toContain(NEITHER);
      expect(text).not.toContain('quiet');
      expect(text).toMatch(/^The estimate [^.]*\. \S+ played .*: a risk that went unpunished\./);
      expect(quietVoice(analysis, names)).toBe('risk');
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

interface Words {
  played: string;
  punisher: string;
  click: string;
  safe: string;
  /** The verb phrase the card uses after the name: "played" plus the played label. */
  verbPlayed: string;
}

const WORDS: Record<string, Words> = {
  singles: {
    played: 'U-turn', punisher: 'Taunt', click: 'Protect', safe: 'Recover', verbPlayed: 'played U-turn',
  },
  doubles: {
    played: 'U-turn→Zamazenta-Crowned + Earth Power→Zamazenta-Crowned',
    punisher: 'Pollen Puff→Zamazenta-Crowned + Wide Guard',
    click: 'Icy Wind + Protect',
    safe: 'Grassy Glide→Calyrex-Shadow and Earth Power→Calyrex-Shadow',
    verbPlayed: 'played U-turn→Zamazenta-Crowned and Earth Power→Zamazenta-Crowned',
  },
};

describe.each(GAMES)('%s', (game, make) => {
  const words = WORDS[game];
  describe.each(READERS)('read by %s', reader => {
    const build = (scene: Pick<Scene, 'kind' | 'playedCell' | 'safeCell'> & Partial<Scene>) => {
      const built = buildScene(make, { reader, ...scene });
      const name = built.names[reader === 'p1' ? 0 : 1];
      return { ...built, name, text: summarizeTurn(built.analysis, built.names) };
    };
    const risk = (name: string, gap: string) =>
      `${name} ${words.verbPlayed}: a risk that went unpunished. The floor priced in ${words.punisher}; ${words.click} came instead. ` +
      `Against it the safe ${words.safe} ${gap}`;

    test('a mistake paid three turns later reads as a risk that went unpunished, with the gap to the safe line (2663093831 t8)', () => {
      const { name, text } = build({ kind: 'mistake', playedCell: 0.072, safeCell: 0.327, window: true });
      expect(text).toContain(risk(name, 'was worth +13% more.'));
      expect(text).not.toContain('a read that paid off');
      expect(text).not.toContain('as a read: its floor risked');
    });

    test('an inaccuracy risk that kept ground says it in the inaccuracy slot, and no inaccuracy note follows (2663093831 t6)', () => {
      const { name, text } = build({ kind: 'inaccuracy', playedCell: 0.325, safeCell: 0.454 });
      expect(text).toContain(risk(name, 'was worth +6% more.'));
      expect(text).not.toContain('was an inaccuracy');
    });

    test('a gamble whose safe line did as well reads "did as well" (648453 t8)', () => {
      const { name, text } = build({ kind: 'gamble', playedCell: 0.189, safeCell: 0.19 });
      expect(text).toContain(risk(name, 'did as well.'));
    });

    test('a failing side that lost ground keeps the card it had: neither the risk sentence nor the inaccuracy note (2663093831 t1, t2)', () => {
      const { text } = build({ kind: 'inaccuracy', playedCell: 0.325, safeCell: 0.454, lostGround: 0.1 });
      expect(text).not.toContain('a risk that went unpunished');
      expect(text).not.toContain('was an inaccuracy');
    });

    test('a read that beat the safe line names both numbers of the fair test (562428 t12 shape)', () => {
      const { name, text } = build({ kind: 'gamble', playedCell: 0.4, safeCell: 0.22 });
      expect(text).toContain(`${name} ${words.verbPlayed}: a read that paid off, +13% over the safe ${words.safe} (54% guaranteed).`);
      expect(text).toContain(`${words.click} came instead, and against it the play beat the safe line by +9%.`);
      expect(text).not.toContain('a risk that went unpunished');
    });

    test('a read without a matrix keeps today\'s sentence: no cell, no comparison clause', () => {
      const { text } = build({ kind: 'gamble', playedCell: 0.4, safeCell: 0.22, noMatrix: true });
      expect(text).toContain('a read that paid off');
      expect(text).not.toContain('beat the safe line');
    });
  });
});

const choice = (choiceStr: string, label: string, worstCase: number): RankedChoice =>
  ({ choice: choiceStr, label, worstCase, expected: worstCase, ev: worstCase, punishedBy: 'Reply' });

const names: [string, string] = ['Alpha', 'Beta'];

describe('the forced win in prose (round 35)', () => {
  const forcedResult = (forcedWin: EvalResult['forcedWin']): EvalResult => ({
    score: 0.95, interval: 0, depthCompleted: 1,
    perSide: {
      p1: [choice('move firefang', 'Fire Fang', 0.9)],
      p2: [choice('move roost', 'Roost', -0.9)],
    },
    unanswered: { p1: [], p2: [], nearDecided: { side: 'p1', species: 'Garchomp', odds: 0.95, removes: 'Corviknight' } },
    ...(forcedWin ? { forcedWin } : {}),
  });
  const summaryAt = (forcedWin: EvalResult['forcedWin'], decidedSeen?: ReadonlySet<string>) =>
    summarizeTurn(analyzeTurn({
      turn: 73,
      result: forcedResult(forcedWin),
      played: { p1: { kind: 'move', name: 'Fire Fang', tera: false }, p2: { kind: 'move', name: 'Roost', tera: false } },
      playedOutcome: 0.9, scoreBefore: 0.95, scoreAfter: 0.99,
      ...(decidedSeen ? { decidedSeen } : {}),
    }), names);

  test('a full proof speaks the plain sentence and mutes the near stage', () => {
    const summary = summaryAt({ side: 'p1', turns: 3, mass: 1, caveat: 'none', engineScore: 0.5, states: 12 });
    expect(summary).toContain('Alpha wins within 3 turns against every reply.');
    expect(summary).not.toContain('from clearing the rest');
  });

  test('a crit caveat rides on the sentence', () => {
    const summary = summaryAt({ side: 'p1', turns: 4, mass: 1, caveat: 'barring-crit', engineScore: 0.5, states: 30 });
    expect(summary).toContain('Alpha wins within 4 turns against every reply, barring a crit.');
  });

  test('an open hit class names the roll', () => {
    const summary = summaryAt({
      side: 'p1', turns: 3, mass: 0.95, caveat: 'barring-crit', engineScore: 0.5, states: 40,
      open: { side: 'p1', moveId: 'firefang', label: 'Fire Fang', odds: 0.95, kind: 'hit' },
    });
    expect(summary).toContain('Alpha wins within 3 turns against every reply if the 95% Fire Fang lands, barring a crit.');
  });

  test('an open kill class says knocks out; a mass without an open class says the share of rolls', () => {
    expect(summaryAt({
      side: 'p1', turns: 2, mass: 0.9, caveat: 'none', engineScore: 0.5, states: 9,
      open: { side: 'p1', moveId: 'firefang', label: 'Fire Fang', odds: 0.9, kind: 'kill' },
    })).toContain('Alpha wins within 2 turns against every reply if the 90% Fire Fang knocks out.');
    expect(summaryAt({ side: 'p1', turns: 5, mass: 0.92, caveat: 'sampled-rolls', engineScore: 0.5, states: 80 }))
      .toContain('Alpha wins within 5 turns against every reply in 92% of the sampled rolls.');
  });

  test('below the spoken mass the sentence stays quiet and the near stage speaks', () => {
    const summary = summaryAt({ side: 'p1', turns: 3, mass: 0.7, caveat: 'none', engineScore: 0.5, states: 12 });
    expect(summary).not.toContain('against every reply');
    expect(summary).toContain('from clearing the rest');
  });

  test('the game report speaks the proof once; the per-turn card every turn', () => {
    const forced: EvalResult['forcedWin'] = { side: 'p1', turns: 3, mass: 1, caveat: 'none', engineScore: 0.5, states: 12 };
    expect(summaryAt(forced, new Set(['p1:forced']))).not.toContain('against every reply');
    expect(summaryAt(forced)).toContain('against every reply');
    const analysis = analyzeTurn({
      turn: 73, result: forcedResult(forced), played: null, playedOutcome: null, scoreBefore: 0.95, scoreAfter: null,
      decidedSeen: new Set(['p1:forced']),
    });
    expect(analysis.p1.forcedWin).toEqual({ turns: 3, mass: 1, caveat: 'none', announce: false });
  });

  test('doubles: the sentence uses the player name, so a two-slot side reads the same', () => {
    const summary = summarizeTurn(analyzeTurn({
      turn: 20,
      result: { ...forcedResult({ side: 'p2', turns: 2, mass: 1, caveat: 'sampled-rolls', engineScore: -0.4, states: 6 }), score: -1 },
      played: null, playedOutcome: null, scoreBefore: -1, scoreAfter: null, playedTracking: false,
    }), names);
    expect(summary).toContain('Beta wins within 2 turns against every reply on the sampled rolls.');
  });
});

describe('inaccuracy-read', () => {
  const names: [string, string] = ['LordEnz', 'Dflo'];

  const ranked = (choice: string, label: string, worstCase: number, expected: number, ev: number, punishedBy: string | null): RankedChoice =>
    ({ choice, label, worstCase, expected, ev, punishedBy });

  /**
   * Round 77 (user report 28.10.2026, the expert pin smogtours-gen8ou-562428 t12): LordEnz's Tapu Bulu at 45% clicks Close
   * Combat into Dflo's Blacephalon, which outspeeds and takes it with Shadow Ball; Dflo switches to Weavile instead, and Close
   * Combat knocks it out on entry. The safe line is the switch to Mandibuzz. Since T249 (round 73) the regret is 0.159, an
   * inaccuracy, and the floor given up is 0.159: under the mistake band, which books its risk, and under the gamble's bound of a
   * mistake-sized floor. The read fell through every rule and the turn read as a plain shift. The numbers are the round 76
   * feedback dump's.
   */
  describe('an inaccuracy that paid off as a read (562428 t12)', () => {
    const t12 = (overrides: Partial<AnalyzeTurnParams> = {}, closeCombatFloor = 0.014) => {
      const result: EvalResult = {
        score: 0.173, interval: 0, depthCompleted: 1,
        perSide: {
          p1: [
            ranked('switch 5', '→ Mandibuzz', 0.173, 0.252, 0.173, 'Shadow Ball'),
            ranked('move closecombat', 'Close Combat', closeCombatFloor, 0.325, closeCombatFloor, 'Shadow Ball'),
          ],
          p2: [
            ranked('move shadowball', 'Shadow Ball', -0.173, 0.017, -0.173, '→ Mandibuzz'),
            ranked('switch 6', '→ Weavile', -0.621, -0.359, -0.258, 'Close Combat'),
          ],
        },
      };
      return analyzeTurn({
        turn: 12, result,
        played: { p1: { kind: 'move', name: 'Close Combat' }, p2: { kind: 'switch', name: 'Weavile' } },
        playedOutcome: 0.621, futureOutcomes: [0.615, 0.6],
        scoreBefore: 0.173, scoreAfter: 0.615,
        ...overrides,
      });
    };

    test('the inaccuracy whose punisher never came and whose outcome beat the safe floor reads as a paid-off read', () => {
      const analysis = t12();
      expect(analysis.p1.tier).toBe('inaccuracy');
      expect(analysis.p1.riskPaidOff).toBe(true);
      expect(analysis.p1.riskPayoff).toBeCloseTo(0.448, 3);
      expect(analysis.attribution).toBe('p1-read');
      const summary = summarizeTurn(analysis, names);
      expect(summary).toContain('LordEnz played Close Combat: a read that paid off, +22% over the safe switch to Mandibuzz');
      expect(summary).toContain('The floor priced in Shadow Ball; switching to Weavile came instead.');
      // The read speaks for the inaccuracy: no second sentence that calls it one.
      expect(summary).not.toContain('was an inaccuracy');
      // The credit only: the inaccuracy band keeps no risk label.
      expect(analysis.p1.riskUnpunished).toBeUndefined();
    });

    test('guards: the punisher clicked, a small payoff, a lost position, or no floor given up earn nothing', () => {
      const punished = t12({ played: { p1: { kind: 'move', name: 'Close Combat' }, p2: { kind: 'move', name: 'Shadow Ball' } }, playedOutcome: 0.014 });
      expect(punished.p1.riskPaidOff).toBeUndefined();
      expect(t12({ playedOutcome: 0.2 }).p1.riskPaidOff).toBeUndefined();
      expect(t12({ scoreBefore: -0.75 }).p1.riskPaidOff).toBeUndefined();
      // A Close Combat that kept the safe line's floor gave nothing up: no read to credit, whatever its regret.
      const noFloor = t12({}, 0.173);
      expect(noFloor.p1.riskPaidOff).toBeUndefined();
    });
  });
});

describe('luck-cards', () => {
  const ranked = (choice: string, label: string, ev: number, koOdds?: KoOddsInfo): RankedChoice =>
    ({ choice, label, worstCase: ev, expected: ev, ev, punishedBy: null, ...(koOdds ? { koOdds } : {}) });

  const playing = (played: RankedChoice | null): SideAnalysis =>
    ({ playedRaw: null, played, best: played, safe: played, regret: 0 });

  const quiet = playing(null);

  /** A hand-built turn for the card sentences: the deltas, the attribution, the sides and (optionally) the turn's rolls. */
  const turnWith = (over: Partial<TurnAnalysis>): TurnAnalysis => ({
    turn: 12, scoreBefore: 0, scoreAfter: 0.24, swing: 0.24, playedOutcome: 0, decisionDelta: 0, chanceDelta: 0.24,
    attribution: 'chance', p1: quiet, p2: quiet, playedTracking: true, ...over,
  });

  const names: [string, string] = ['BKC', 'devin'];

  describe('T22 cards: a swing without a roll in its direction is an estimate that moved with no roll behind it', () => {
    test('singles chance card (649664 t12 shape): no roll toward BKC, so no "how the turn rolled"', () => {
      const reRead = summarizeTurn(turnWith({ rolledFor: { p1: false, p2: false } }), names);
      expect(reRead).toContain('the estimate moved +12% with no roll behind it');
      expect(reRead).not.toContain('how the turn rolled');
      expect(summarizeTurn(turnWith({ rolledFor: { p1: true, p2: false } }), names)).toContain('how the turn rolled (+12%)');
      // A roll the other way does not explain a swing toward BKC.
      expect(summarizeTurn(turnWith({ rolledFor: { p1: false, p2: true } }), names)).not.toContain('how the turn rolled');
      // Without the turn's dice the card keeps its old wording.
      expect(summarizeTurn(turnWith({}), names)).toContain('how the turn rolled (+12%)');
    });

    test('doubles chance card (2663093831 t2 shape): the same rule', () => {
      const pair = playing(ranked('move heatwave, move protect', 'Heat Wave + Protect', 0.1));
      const reRead = summarizeTurn(turnWith({ p1: pair, p2: pair, chanceDelta: -0.4, swing: -0.4, scoreAfter: -0.4, rolledFor: { p1: true, p2: false } }), names);
      expect(reRead).toContain('the estimate moved −20% with no roll behind it');
      expect(reRead).not.toContain('how the turn rolled');
    });

    test('a decision turn\'s luck rider names the unrolled move when no roll went that way', () => {
      const mistake: SideAnalysis = {
        ...playing(ranked('move bulkup', 'Bulk Up', -0.1)), best: ranked('move drainpunch', 'Drain Punch', 0.25), regret: 0.35, tier: 'mistake',
      };
      const turn = (rolledFor: { p1: boolean; p2: boolean }) =>
        turnWith({ attribution: 'p1-decision', p1: mistake, chanceDelta: -0.3, swing: -0.4, scoreAfter: -0.4, rolledFor });
      expect(summarizeTurn(turn({ p1: false, p2: false }), names)).toContain('On top of that, the estimate moved −15% with no roll behind it.');
      expect(summarizeTurn(turn({ p1: false, p2: false }), names)).not.toContain('luck contributed');
      expect(summarizeTurn(turn({ p1: false, p2: true }), names)).toContain('On top of that, luck contributed −15%.');
    });

    test('a read credit\'s luck rider follows the same rule (653785 t25 shape)', () => {
      const credit: SideAnalysis = {
        ...playing(ranked('switch 4', '→ Cofagrigus', 0.2)), safe: ranked('switch 3', '→ Volcanion', 0.1),
        readCredit: { payoff: 0.31 },
      };
      // The side holds its ground (−0.05): a credit on a lost turn stays silent (T59).
      const turn = (rolledFor: { p1: boolean; p2: boolean }) =>
        turnWith({ attribution: 'quiet', p1: credit, chanceDelta: -0.15, swing: -0.05, scoreAfter: -0.05, rolledFor });
      expect(summarizeTurn(turn({ p1: false, p2: false }), names)).toContain('On top of that, the estimate moved −8% for BKC with no roll behind it.');
      expect(summarizeTurn(turn({ p1: false, p2: true }), names)).toContain('On top of that, luck contributed −8% for BKC.');
    });

    test('a shift names the unrolled part in its split', () => {
      const shift = (rolledFor: { p1: boolean; p2: boolean }) => turnWith({
        attribution: 'shift', p1: playing(ranked('move uturn', 'U-turn', 0.1)), p2: playing(ranked('move pursuit', 'Pursuit', -0.1)),
        decisionDelta: 0.23, chanceDelta: 0.12, swing: 0.35, scoreAfter: 0.35, rolledFor,
      });
      expect(summarizeTurn(shift({ p1: false, p2: false }), names)).toContain('(+12% expected, +6% with no roll behind it)');
      expect(summarizeTurn(shift({ p1: true, p2: false }), names)).toContain('(+12% expected, +6% from the rolls)');
    });
  });
});

describe('never-acted-prose', () => {
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
});

describe('report-prose-rolls', () => {
  const choice = (choiceStr: string, label: string, ev: number): RankedChoice =>
    ({ choice: choiceStr, label, worstCase: ev, expected: ev, ev, punishedBy: 'Reply' });

  const names: [string, string] = ['Alpha', 'Beta'];

  const summaryWith = (extra: Partial<EvalResult>, doubles = false) => summarizeTurn(analyzeTurn({
    turn: 21,
    result: {
      score: 0.6, interval: 0, depthCompleted: 1,
      perSide: {
        p1: [choice(doubles ? 'move 1 1, move 2 2' : 'move earthquake', doubles ? 'Earthquake + Protect' : 'Earthquake', 0.6)],
        p2: [choice(doubles ? 'move 1 1, move 1 2' : 'move roost', doubles ? 'Protect + Body Press' : 'Roost', -0.6)],
      },
      ...extra,
    },
    played: null, playedOutcome: null, scoreBefore: 0.6, scoreAfter: null, playedTracking: !doubles,
  }), names);

  const near = (odds: number) => ({ unanswered: { p1: [], p2: [], nearDecided: { side: 'p1' as const, species: 'Landorus-Therian', odds, removes: 'Excadrill' } } });

  describe('point 3: a probability under 1 never reads as certain', () => {
    test('singles near sentence (648453 t21 shape): 99.5% is a 99% roll, only 1 is a sure KO', () => {
      expect(summaryWith(near(0.995))).toContain('Landorus-Therian is one 99% roll from clearing the rest');
      expect(summaryWith(near(0.995))).not.toContain('sure KO');
      expect(summaryWith(near(1))).toContain('Landorus-Therian is one sure KO from clearing the rest');
    });

    test('doubles near sentence (912045 t11 shape): the same rule', () => {
      expect(summaryWith(near(0.995), true)).toContain('is one 99% roll from clearing the rest');
      expect(summaryWith(near(1), true)).toContain('is one sure KO from clearing the rest');
    });

    test('the forced-win open event and the sampled share stop at 99%', () => {
      const open = summaryWith({ forcedWin: {
        side: 'p1', turns: 3, mass: 0.996, caveat: 'none', engineScore: 0.6, states: 20,
        open: { side: 'p1', moveId: 'earthquake', label: 'Earthquake', odds: 0.996, kind: 'hit' },
      } });
      expect(open).toContain('if the 99% Earthquake lands.');
      const sampled = summaryWith({ forcedWin: { side: 'p1', turns: 3, mass: 0.996, caveat: 'sampled-rolls', engineScore: 0.6, states: 20 } }, true);
      expect(sampled).toContain('in 99% of the sampled rolls.');
    });

    test('the denied-early-end sentence (573756 t73 shape): a sure KO says so, 99.5% stays a roll', () => {
      const denied = { turn: 73, side: 'p2' as const, species: 'Garchomp', removes: 'Corviknight', turnsRemaining: 66 };
      expect(deniedEndSentence({ ...denied, odds: 1 }, 'p2', 'Alpha')).toContain('Garchomp stood one sure KO from clearing the rest');
      expect(deniedEndSentence({ ...denied, odds: 0.995 }, 'p2', 'Alpha')).toContain('Garchomp stood one 99% roll from clearing the rest');
      expect(deniedEndSentence({ ...denied, odds: 0.95, move: 'Fire Fang' }, 'p2', 'Alpha'))
        .toContain('Garchomp stood one 95% roll from clearing the rest, but Fire Fang missed');
    });
  });
});
