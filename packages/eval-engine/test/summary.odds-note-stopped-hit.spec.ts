import { describe, expect, test } from 'vitest';
import { analyzeTurn, type SideAnalysis, type TurnAnalysis, decidedSeenKey, forcedWinSeenKey } from '../src/analysis';
import { summarizeTurn } from '../src/summary';
import type { PlayedTurn } from '../src/played';
import type { EvalMatrix, EvalResult, KoOddsInfo, RankedChoice } from '../src/types';

/**
 * The "True odds" note quotes reply-independent KO odds of a line ("Tera Starstorm kills ~4% of the time"), priced on the board before the turn. When the
 * opponent's actual pair stops that hit (Wide Guard turns Tera Starstorm away, a Protect turns a single hit away) the note must not quote a roll that never
 * happened (VGC 2630685175 turn 7 said it twice). The stop is read from the cell of the line against the click, which the search priced from the simulator's own
 * turn: a cell the planner finds plain (no accuracy roll and no kill range in it) holds no roll of any hit, and a doubles cell lists its events with the move that
 * makes each (`p1b:terastarstorm>p2b=hit-nokill`), so a claim whose attacker slot and move have no event there never landed. A cell the search did not plan, a
 * failed plan, and a claim the cell still lists keep the note, and so does a singles cell holding a roll (its classes name no move).
 */

type Cell = NonNullable<EvalMatrix['cells']>[number][number];
const PLAIN: Cell = { visits: 20, verified: false, plan: 'none' };
const SEEN: Cell = { visits: 20, verified: false };
const FAILED: Cell = { visits: 20, verified: false, plan: 'fail' };
const events = (...keys: string[]): Cell => ({
  visits: 20, verified: false, plan: 'events',
  classes: keys.map((key, index) => ({ key, weight: index === 0 ? 0.6 : 0.4 / (keys.length - 1) })),
});
/** One event of the pair plan as a class key spells it: attacker slot, move, target slot, outcome. */
const eventKey = (side: 'p1' | 'p2', slot: 'a' | 'b', move: string, targetSlot: 'a' | 'b', outcome: string): string =>
  `${side}${slot}:${move}>${side === 'p1' ? 'p2' : 'p1'}${targetSlot}=${outcome}`;

interface Line { choice: string; label: string; ev: number; koOdds?: KoOddsInfo }
const row = (line: Line): RankedChoice => ({
  choice: line.choice, label: line.label, worstCase: line.ev - 0.1, expected: line.ev, ev: line.ev, punishedBy: 'Reply', ...(line.koOdds ? { koOdds: line.koOdds } : {}),
});
const names: [string, string] = ['Alpha', 'Beta'];

type Played = PlayedTurn['p1'] | PlayedTurn['p1Slots'];
interface Scene {
  /** The own side's lines: the engine's best (rank 0) and the played one (regret 0.12, an inaccuracy). */
  best: Line;
  played: Line;
  click: Line;
  other: Line;
  ownPlayed: Played;
  clickPlayed: Played;
}

/** The scene seen from `side`: that side holds [best, played] and the other [click, other]; the cells against the click are the two given. */
function turn(scene: Scene, side: 'p1' | 'p2', bestCell: Cell, playedCell: Cell): TurnAnalysis {
  const own = [scene.best, scene.played];
  const opp = [scene.click, scene.other];
  const ownRows = side === 'p1';
  // The own line `ownIndex` against the opponent line `oppIndex`: the clicked column (0) holds the two given cells.
  const cellOf = (ownIndex: number, oppIndex: number): Cell => (oppIndex !== 0 ? SEEN : ownIndex === 0 ? bestCell : playedCell);
  const lines = (rows: boolean) => (rows ? own : opp);
  const matrix: EvalMatrix = {
    p1Labels: lines(ownRows).map(line => line.label), p2Labels: lines(!ownRows).map(line => line.label),
    p1Choices: lines(ownRows).map(line => line.choice), p2Choices: lines(!ownRows).map(line => line.choice),
    values: lines(ownRows).map(() => lines(!ownRows).map(() => 0.1)),
    mixes: { p1: lines(ownRows).map(() => 0.5), p2: lines(!ownRows).map(() => 0.5) },
    // cells[p1 row][p2 column]
    cells: ownRows ? own.map((_, i) => opp.map((__, j) => cellOf(i, j))) : opp.map((_, i) => own.map((__, j) => cellOf(j, i))),
  };
  const result: EvalResult = {
    score: 0.05, interval: 0.02, depthCompleted: 1,
    perSide: { p1: lines(ownRows).map(row), p2: lines(!ownRows).map(row) },
    matrix,
  };
  const doubles = Array.isArray(scene.ownPlayed);
  const played: PlayedTurn = doubles
    ? { p1: null, p2: null, p1Slots: (ownRows ? scene.ownPlayed : scene.clickPlayed) as PlayedTurn['p1Slots'], p2Slots: (ownRows ? scene.clickPlayed : scene.ownPlayed) as PlayedTurn['p2Slots'] }
    : { p1: (ownRows ? scene.ownPlayed : scene.clickPlayed) as PlayedTurn['p1'], p2: (ownRows ? scene.clickPlayed : scene.ownPlayed) as PlayedTurn['p2'] };
  return analyzeTurn({ turn: 7, result, played, playedOutcome: 0.05, scoreBefore: 0.05, scoreAfter: 0.1 });
}

const summaryOf = (analysis: TurnAnalysis): string => summarizeTurn(analysis, names);

/** Singles: Alpha played Scald (kills ~43%) instead of Hydro Pump (a 80% roll into a ~50% kill range), Beta clicked Protect. */
const singles = (): Scene => ({
  best: { choice: 'move hydropump', label: 'Hydro Pump', ev: 0.30, koOdds: { accuracy: 0.8, killFraction: 0.5 } },
  played: { choice: 'move scald', label: 'Scald', ev: 0.18, koOdds: { accuracy: 1, killFraction: 0.43 } },
  click: { choice: 'move protect', label: 'Protect', ev: -0.18 },
  other: { choice: 'move recover', label: 'Recover', ev: -0.3 },
  ownPlayed: { kind: 'move', name: 'Scald', tera: false },
  clickPlayed: { kind: 'move', name: 'Protect', tera: false },
});

/** Doubles (the turn-7 shape): the own slot b used Tera Starstorm (kills ~4%) into the opponent's Wide Guard; the best line has it too. */
const doubles = (): Scene => ({
  best: {
    choice: 'move woodhammer 1, move terastarstorm', label: 'Wood Hammer→Calyrex-Shadow + Tera Starstorm', ev: 0.30,
    koOdds: { accuracy: 1, killFraction: 0.04, label: 'Tera Starstorm→Zamazenta-Crowned', attacker: { slot: 1, species: 'Terapagos-Stellar' } },
  },
  played: {
    choice: 'move uturn 2, move terastarstorm', label: 'U-turn→Zamazenta-Crowned + Tera Starstorm', ev: 0.18,
    koOdds: { accuracy: 1, killFraction: 0.04, label: 'Tera Starstorm→Zamazenta-Crowned', attacker: { slot: 1, species: 'Terapagos-Stellar' } },
  },
  click: { choice: 'move pollenpuff -2, move wideguard', label: 'Pollen Puff→Zamazenta-Crowned + Wide Guard', ev: -0.18 },
  other: { choice: 'move protect, move protect', label: 'Protect + Protect', ev: -0.3 },
  ownPlayed: [{ kind: 'move', name: 'U-turn', targetLoc: 2 }, { kind: 'move', name: 'Tera Starstorm', targetLoc: 2 }],
  clickPlayed: [{ kind: 'move', name: 'Pollen Puff', targetLoc: -2 }, { kind: 'move', name: 'Wide Guard', targetLoc: null }],
});

const SIDES = ['p1', 'p2'] as const;
const TRUE_ODDS = '(True odds:';

describe.each(SIDES)('singles, seen from %s: the note drops a claim whose hit the actual click stops', side => {
  const name = side === 'p1' ? names[0] : names[1];

  test('the premise: the clause names the inaccuracy and quotes both claims while the search says nothing about the cells', () => {
    const analysis = turn(singles(), side, SEEN, SEEN);
    expect(analysis[side].tier).toBe('inaccuracy');
    const text = summaryOf(analysis);
    expect(text).toContain(`${name}'s Scald was an inaccuracy`);
    expect(text).toContain('(True odds: Scald kills ~43% of the time; Hydro Pump is an 80% roll into a ~50% kill range.)');
  });

  test('plain cells against the click leave no note at all (red before: both claims stood)', () => {
    const analysis = turn(singles(), side, PLAIN, PLAIN);
    expect(analysis[side].hitStopped).toEqual({ played: true, best: true });
    expect(summaryOf(analysis)).not.toContain('True odds');
  });

  test('one stopped claim leaves the other', () => {
    expect(summaryOf(turn(singles(), side, SEEN, PLAIN))).toContain('(True odds: Hydro Pump is an 80% roll into a ~50% kill range.)');
    expect(summaryOf(turn(singles(), side, PLAIN, SEEN))).toContain('(True odds: Scald kills ~43% of the time.)');
  });

  test('a failed plan, an unplanned cell and a singles cell holding a roll keep the note (a singles class names no move)', () => {
    for (const cell of [FAILED, SEEN, events('hit-nokill', 'miss')]) {
      const analysis = turn(singles(), side, cell, cell);
      expect(analysis[side].hitStopped).toBeUndefined();
      expect(summaryOf(analysis)).toContain(TRUE_ODDS);
    }
  });

  test('the flag is display only: every other field of the analysis stays', () => {
    const plain = turn(singles(), side, PLAIN, PLAIN);
    const seen = turn(singles(), side, SEEN, SEEN);
    const bare = (analysis: TurnAnalysis) => ({ ...analysis, [side]: { ...analysis[side], hitStopped: undefined } });
    expect(bare(plain)).toEqual(bare(seen));
  });
});

describe.each(SIDES)('doubles, seen from %s: a claim is stopped when its attacker slot and move have no event in the cell', side => {
  const name = side === 'p1' ? names[0] : names[1];
  const foe = side === 'p1' ? 'p2' : 'p1';

  test('the premise: both claims stand without cell facts', () => {
    const text = summaryOf(turn(doubles(), side, SEEN, SEEN));
    expect(text).toContain(`${name}'s U-turn→Zamazenta-Crowned + Tera Starstorm was an inaccuracy`);
    expect(text).toContain('(True odds: Tera Starstorm→Zamazenta-Crowned kills ~4% of the time; Tera Starstorm→Zamazenta-Crowned kills ~4% of the time.)');
  });

  test('plain cells (the Wide Guard turns Tera Starstorm away, the turn-7 cells) drop the whole note (red before: said twice)', () => {
    const analysis = turn(doubles(), side, PLAIN, PLAIN);
    expect(analysis[side].hitStopped).toEqual({ played: true, best: true });
    expect(summaryOf(analysis)).not.toContain('True odds');
  });

  test('a cell that lists other events but none of the claim\'s attacker and move drops the claim', () => {
    const others = events(eventKey(side, 'a', 'woodhammer', 'a', 'hit-nokill'), eventKey(side, 'a', 'woodhammer', 'a', 'hit-kill'));
    expect(summaryOf(turn(doubles(), side, others, others))).not.toContain('True odds');
    // The same move in the other slot is not the claim's attacker, and neither is the opponent's slot b.
    const wrongSlot = events(eventKey(side, 'a', 'terastarstorm', 'b', 'hit-nokill'), eventKey(side, 'a', 'terastarstorm', 'b', 'hit-kill'));
    expect(summaryOf(turn(doubles(), side, wrongSlot, wrongSlot))).not.toContain('True odds');
    const theirs = events(eventKey(foe, 'b', 'terastarstorm', 'b', 'hit-nokill'), eventKey(foe, 'b', 'terastarstorm', 'b', 'hit-kill'));
    expect(summaryOf(turn(doubles(), side, theirs, theirs))).not.toContain('True odds');
  });

  test('a cell that lists the claim\'s own event keeps it, whatever it lists besides', () => {
    const own = events(
      `${eventKey(side, 'b', 'terastarstorm', 'b', 'hit-nokill')}|${eventKey(side, 'a', 'woodhammer', 'a', 'hit-nokill')}`,
      `${eventKey(side, 'b', 'terastarstorm', 'b', 'hit-kill')}|${eventKey(side, 'a', 'woodhammer', 'a', 'hit-nokill')}`);
    const analysis = turn(doubles(), side, own, own);
    expect(analysis[side].hitStopped).toBeUndefined();
    expect(summaryOf(analysis)).toContain(TRUE_ODDS);
  });

  test('one claim stopped, the other kept: the note names only the claim that still stands', () => {
    const kept = events(eventKey(side, 'b', 'terastarstorm', 'b', 'hit-nokill'), eventKey(side, 'b', 'terastarstorm', 'b', 'hit-kill'));
    const text = summaryOf(turn(doubles(), side, kept, PLAIN));
    expect(text).toContain('(True odds: Tera Starstorm→Zamazenta-Crowned kills ~4% of the time.)');
    expect(text.match(/Tera Starstorm→Zamazenta-Crowned kills/g)).toHaveLength(1);
  });

  test('a failed plan or an unplanned cell keeps the note', () => {
    for (const cell of [FAILED, SEEN]) expect(summaryOf(turn(doubles(), side, cell, cell))).toContain(TRUE_ODDS);
  });
});

describe('the paid-off read quotes the click\'s odds the same way', () => {
  test('a click the opponent\'s pair stopped is not quoted as a roll that paid', () => {
    const paid: SideAnalysis = {
      playedRaw: null,
      played: row({ choice: 'move focusblast', label: 'Focus Blast', ev: 0.3, koOdds: { accuracy: 0.7, killFraction: 1 } }),
      best: row({ choice: 'move focusblast', label: 'Focus Blast', ev: 0.3 }),
      safe: row({ choice: 'move recover', label: 'Recover', ev: 0.1 }),
      regret: 0, riskPaidOff: true, riskPayoff: 0.25,
    };
    const base: TurnAnalysis = {
      turn: 9, scoreBefore: 0, scoreAfter: 0.3, swing: 0.3, playedOutcome: 0.25, decisionDelta: 0.25, chanceDelta: 0.05,
      attribution: 'p1-read', p1: paid, p2: { playedRaw: null, played: null, best: null, safe: null, regret: null }, playedTracking: true,
    };
    expect(summaryOf(base)).toContain('The click was a 70% roll to connect.');
    expect(summaryOf({ ...base, p1: { ...paid, hitStopped: { played: true } } })).not.toContain('The click was');
  });
});

const choice = (choiceStr: string, label: string, worstCase: number): RankedChoice =>
  ({ choice: choiceStr, label, worstCase, expected: worstCase, ev: worstCase, punishedBy: 'Reply' });

/** A proof under the spoken mass still speaks on the card when the bar sits at least 0.1 under the proven win; a proof whose open branch wins anyway keeps the bar near the win and stays quiet. */
describe('the open event of a forced win under 0.9', () => {
  const resultWith = (score: number, forcedWin: EvalResult['forcedWin'], extra: Partial<EvalResult> = {}): EvalResult => ({
    score, interval: 0, depthCompleted: 1,
    perSide: {
      p1: [choice('move hydropump', 'Hydro Pump', score)],
      p2: [choice('move painsplit', 'Pain Split', -score)],
    },
    ...(forcedWin ? { forcedWin } : {}),
    ...extra,
  });
  const analyzeAt = (result: EvalResult, scoreBefore: number) => analyzeTurn({
    turn: 24, result, played: null, playedOutcome: null, scoreBefore, scoreAfter: null,
  });

  test('singles, 649664 t24: the 80% Hydro Pump is named when the bar sits at 0.79', () => {
    const result = resultWith(0.7875, {
      side: 'p1', turns: 5, mass: 0.8, caveat: 'barring-crit', engineScore: -0.95, states: 40,
      open: { side: 'p1', moveId: 'hydropump', label: 'Hydro Pump', odds: 0.8, kind: 'hit' },
    });
    expect(summarizeTurn(analyzeAt(result, 0.7875), names))
      .toContain('Alpha wins within 5 turns against every reply if the 80% Hydro Pump lands, barring a crit.');
  });

  test('when the open event speaks, the decided stage of the same side stays quiet on that turn', () => {
    const result = resultWith(0.7875, {
      side: 'p1', turns: 5, mass: 0.8, caveat: 'barring-crit', engineScore: -0.95, states: 40,
      open: { side: 'p1', moveId: 'hydropump', label: 'Hydro Pump', odds: 0.8, kind: 'hit' },
    }, { unanswered: { p1: [], p2: [], decided: { side: 'p1', species: 'Keldeo' } } });
    const analysis = analyzeAt(result, 0.7875);
    expect(analysis.p1.decided).toEqual({ species: 'Keldeo', announce: false });
    expect(summarizeTurn(analysis, names)).not.toContain('clears everything');
  });

  test('573756 t138: a 66% proof whose open branch still wins keeps the bar at 0.97 and hangs nothing on a 2% event', () => {
    const result = resultWith(-0.966, {
      side: 'p2', turns: 4, mass: 0.6628, caveat: 'barring-crit', engineScore: -0.967, states: 90,
      open: { side: 'p2', moveId: 'stompingtantrum', label: 'Stomping Tantrum', odds: 0.0208, kind: 'kill' },
    });
    const summary = summarizeTurn(analyzeAt(result, -0.966), names);
    expect(summary).not.toContain('against every reply');
    expect(summary).not.toContain('2%');
  });

  test('doubles, sampled rolls: the share of the sampled rolls is named once, and no crit is mentioned', () => {
    const result = resultWith(0.7, { side: 'p1', turns: 2, mass: 0.8, caveat: 'sampled-rolls', engineScore: 0.4, states: 30 }, {
      perSide: {
        p1: [choice('move heatwave, move protect', 'Heat Wave + Protect', 0.7)],
        p2: [choice('move protect, move earthpower 1', 'Protect + Earth Power→Chi-Yu', -0.7)],
      },
    });
    const summary = summarizeTurn(analyzeAt(result, 0.7), names);
    expect(summary).toContain('Alpha wins within 2 turns against every reply in 80% of the sampled rolls.');
    expect(summary).not.toContain('crit');
  });

  test('the same 0.1 gap holds for sampled rolls: a bar at 0.95 keeps an 80% proof quiet', () => {
    const result = resultWith(0.95, { side: 'p1', turns: 2, mass: 0.8, caveat: 'sampled-rolls', engineScore: 0.9, states: 30 });
    expect(summarizeTurn(analyzeAt(result, 0.95), names)).not.toContain('against every reply');
  });

  test('a coin-flip proof at exactly 0.5 never speaks, whatever the bar', () => {
    const result = resultWith(0.3, {
      side: 'p1', turns: 3, mass: 0.5, caveat: 'barring-crit', engineScore: 0.3, states: 20,
      open: { side: 'p1', moveId: 'hydropump', label: 'Hydro Pump', odds: 0.5, kind: 'hit' },
    });
    expect(summarizeTurn(analyzeAt(result, 0.3), names)).not.toContain('against every reply');
  });
});

describe('predictive-read', () => {
  const choice = (choiceStr: string, label: string, ev: number): RankedChoice =>
    ({ choice: choiceStr, label, worstCase: ev, expected: ev, ev, punishedBy: 'Reply' });

  const names: [string, string] = ['Alpha', 'Beta'];

  describe('the predictive read before the click', () => {
    // The Flying-switch shape: Beta's Earthquake is the obvious click into
    // Alpha's staying Scald; → Noivern crushes it and loses to Ice Beam.
    const predictive = (options: {
      values?: number[][]; mixes?: { p1: number[]; p2: number[] }; p1First?: 'scald' | 'noivern';
      p1Labels?: string[]; p2Labels?: string[]; p1Choices?: string[]; p2Choices?: string[];
    } = {}): EvalResult => {
      const p1Labels = options.p1Labels ?? ['Scald', '→ Noivern'];
      const p2Labels = options.p2Labels ?? ['Earthquake', 'Ice Beam'];
      const p1Choices = options.p1Choices ?? ['move scald', 'switch 3'];
      const p2Choices = options.p2Choices ?? ['move earthquake', 'move icebeam'];
      const p1Rows = [choice(p1Choices[0], p1Labels[0], -0.14), choice(p1Choices[1], p1Labels[1], -0.15)];
      return {
        score: -0.14, interval: 0.05, depthCompleted: 1,
        perSide: {
          p1: options.p1First === 'noivern' ? [p1Rows[1], p1Rows[0]] : p1Rows,
          p2: [choice(p2Choices[0], p2Labels[0], 0.14), choice(p2Choices[1], p2Labels[1], 0.13)],
        },
        matrix: {
          p1Labels, p2Labels, p1Choices, p2Choices,
          values: options.values ?? [[-0.40, -0.02], [0.60, -0.50]],
          mixes: options.mixes ?? { p1: [0.743, 0.257], p2: [0.324, 0.676] },
        },
      };
    };
    // Alpha splits evenly between moves and switches (Beta's model of Alpha
    // stays unsure); Beta mostly attacks.
    const tendencies = { p1: { attackRate: 0.5, switchRate: 0.5, repeatBias: 0 }, p2: { attackRate: 0.8, switchRate: 0.2, repeatBias: 0 } };
    const analyze = (result: EvalResult, extra: Partial<Parameters<typeof analyzeTurn>[0]> = {}) => analyzeTurn({
      turn: 7, result, tendencies,
      played: { p1: { kind: 'move', name: 'Scald', tera: false }, p2: { kind: 'move', name: 'Ice Beam', tera: false } },
      playedOutcome: -0.02, scoreBefore: -0.14, scoreAfter: -0.1,
      ...extra,
    });

    test('a confident model and a mistake-sized gain over the recommendation speak the sentence', () => {
      const analysis = analyze(predictive());
      expect(analysis.p1.predictiveRead).toMatchObject({ expect: 'Earthquake', response: '→ Noivern', over: 'Scald' });
      expect(analysis.p1.predictiveRead!.confidence).toBeCloseTo(0.67, 2);
      expect(analysis.p1.predictiveRead!.gain).toBeCloseTo(1.0, 8);
      expect(analysis.p2.predictiveRead).toBeUndefined();
      expect(summarizeTurn(analysis, names)).toContain(
        'If Alpha expects Earthquake (67% on the opponent model), switching to Noivern is the move: +50% over Scald against it.');
    });

    test('the sentence stands without played actions', () => {
      const analysis = analyze(predictive(), { played: null, playedOutcome: null, playedTracking: false });
      expect(summarizeTurn(analysis, names)).toContain('If Alpha expects Earthquake');
    });

    test('a model below the sentence confidence stays silent even where the turn card shows a read', () => {
      // Earthquake at 0.58: above READ_CONFIDENCE (0.55), below the sentence's 0.6.
      const analysis = analyze(predictive({ values: [[-0.20, -0.02], [0.60, -0.50]], mixes: { p1: [0.859, 0.141], p2: [0.375, 0.625] } }));
      expect(analysis.p1.predictiveRead).toBeUndefined();
      expect(summarizeTurn(analysis, names)).not.toContain('If Alpha expects');
    });

    test('a gain under the mistake band stays silent', () => {
      const analysis = analyze(predictive({ values: [[-0.40, -0.02], [-0.25, -0.50]] }));
      expect(analysis.p1.predictiveRead).toBeUndefined();
    });

    test('a response that already is the recommendation stays silent', () => {
      const analysis = analyze(predictive({ p1First: 'noivern' }));
      expect(analysis.p1.predictiveRead).toBeUndefined();
    });

    test('the displayed recommendation counts: a null-swapped alternative is no news', () => {
      // Will-O-Wisp is mechanically null into Heatran; the co-optimal Shadow
      // Ball displays in its place and is also the answer to Earth Power.
      const result = predictive({
        p1Labels: ['Will-O-Wisp', 'Shadow Ball'], p1Choices: ['move willowisp', 'move shadowball'],
        p2Labels: ['Earth Power', 'Stealth Rock'], p2Choices: ['move earthpower', 'move stealthrock'],
      });
      const analysis = analyze(result, {
        played: { p1: { kind: 'move', name: 'Will-O-Wisp', tera: false }, p2: { kind: 'move', name: 'Stealth Rock', tera: false } },
        actives: { p1: 'Gengar', p2: 'Heatran', gen: 8 },
      });
      expect(analysis.p1.bestNull?.alternative?.label).toBe('Shadow Ball');
      expect(analysis.p1.predictiveRead).toBeUndefined();
    });

    test('a doubles matrix speaks the sentence over its pair rows', () => {
      // The model's status-quo reference reads a pair by its first slot: a
      // pair that opens with a switch is the switch-out it discounts.
      const analysis = analyze(predictive({
        p1Labels: ['Fake Out + Moonblast', '→ Noivern + Tailwind'], p1Choices: ['move fakeout 1, move moonblast 1', 'switch 3, move tailwind'],
        p2Labels: ['Rock Slide + Knock Off', 'Protect + Trick Room'], p2Choices: ['move rockslide, move knockoff 1', 'move protect, move trickroom'],
      }), { played: null, playedOutcome: null });
      expect(summarizeTurn(analysis, names)).toContain(
        'If Alpha expects Rock Slide + Knock Off (67% on the opponent model), switching to Noivern and playing Tailwind is the move: +50% over Fake Out + Moonblast against it.');
    });

    test('a doubles matrix of move pairs alone leaves the model unsure, and the sentence silent', () => {
      const analysis = analyze(predictive({
        p1Labels: ['Fake Out + Moonblast', 'Protect + Tailwind'], p1Choices: ['move fakeout 1, move moonblast 1', 'move protect, move tailwind'],
        p2Labels: ['Rock Slide + Knock Off', 'Protect + Trick Room'], p2Choices: ['move rockslide, move knockoff 1', 'move protect, move trickroom'],
      }), { played: null, playedOutcome: null });
      expect(analysis.p1.predictiveRead).toBeUndefined();
    });

    test('without tendencies the signal stays out', () => {
      const analysis = analyzeTurn({
        turn: 7, result: predictive(), played: null, playedOutcome: null, scoreBefore: -0.14, scoreAfter: -0.1,
      });
      expect(analysis.p1.predictiveRead).toBeUndefined();
    });
  });

  describe('the hindsight read and the likeliest click', () => {
    // A wide board on both sides, a shift without a culprit.
    const wide: EvalResult = {
      score: 0.0, interval: 0.3, depthCompleted: 1,
      perSide: {
        p1: [
          choice('move ironhead', 'Iron Head', 0.1), choice('move earthpower', 'Earth Power', 0.1),
          choice('move recover', 'Recover', 0.09), choice('move toxic', 'Toxic', 0.05), choice('switch 2', '→ Heatran', 0.02),
        ],
        p2: [
          choice('move surf', 'Surf', 0.05), choice('move icebeam', 'Ice Beam', 0.04),
          choice('move roost', 'Roost', 0.0), choice('switch 3', '→ Mandibuzz', -0.02),
        ],
      },
      matrix: {
        p1Labels: ['Iron Head', 'Earth Power', 'Recover', 'Toxic', '→ Heatran'],
        p2Labels: ['Surf', 'Ice Beam', 'Roost', '→ Mandibuzz'],
        p1Choices: ['move ironhead', 'move earthpower', 'move recover', 'move toxic', 'switch 2'],
        p2Choices: ['move surf', 'move icebeam', 'move roost', 'switch 3'],
        values: [
          [0.30, 0.10, 0.12, -0.05],
          [0.32, 0.11, 0.10, 0.08],
          [0.20, 0.09, 0.05, 0.02],
          [0.15, 0.05, 0.08, 0.01],
          [0.10, 0.02, 0.03, 0.00],
        ],
        mixes: { p1: [0.5, 0.5, 0, 0, 0], p2: [0.6, 0.2, 0.1, 0.1] },
      },
    };
    const tendencies = { p1: { attackRate: 0.9, switchRate: 0.1, repeatBias: 0 }, p2: { attackRate: 0.9, switchRate: 0.1, repeatBias: 0 } };
    const clicked = (p1Move: string, withTendencies: boolean) => analyzeTurn({
      turn: 10, result: wide, ...(withTendencies ? { tendencies } : {}),
      played: { p1: { kind: 'move', name: p1Move, tera: false }, p2: { kind: 'move', name: 'Surf', tera: false } },
      playedOutcome: 0.12, scoreBefore: 0.0, scoreAfter: 0.25,
    });

    test('a click the opponent model favoured reads as findable', () => {
      // Beta's model over Alpha's rows favours Earth Power (0.33), and Earth Power came.
      const analysis = clicked('Earth Power', true);
      expect(analysis.p2.hindsightRead?.likeliest).toBeCloseTo(0.33, 1);
      expect(summarizeTurn(analysis, names)).toContain(
        'The read was there for Beta: Earth Power was the likeliest click on the opponent model (33%), ' +
        'and against it switching to Mandibuzz was worth +12% more.');
    });

    test('any other click keeps the hindsight wording', () => {
      const analysis = clicked('Iron Head', true);
      expect(analysis.p2.hindsightRead?.likeliest).toBeUndefined();
      expect(summarizeTurn(analysis, names)).toContain('against the Iron Head actually clicked');
    });

    test('without tendencies the model stays out', () => {
      expect(clicked('Earth Power', false).p2.hindsightRead?.likeliest).toBeUndefined();
    });
  });
});

describe('T18 point 6: the read clause names the click with a verb that fits the odds', () => {
  /** A gamble that paid off (Hydro Pump gave up a mistake-sized floor and landed), with the given odds on the click. */
  const paidRead = (koOdds: KoOddsInfo): string => {
    const tied: EvalResult = {
      score: -0.05, interval: 0.02, depthCompleted: 1,
      perSide: {
        p1: [choice('move ironhead', 'Iron Head', -0.05)],
        p2: [
          { ...choice('move recover', 'Recover', 0.04), ev: 0.05, punishedBy: 'Iron Head' },
          { ...choice('move hydropump', 'Hydro Pump', -0.39), ev: 0.047, punishedBy: 'Earth Power', koOdds },
        ],
      },
    };
    return summarizeTurn(analyzeTurn({
      turn: 50,
      result: tied,
      played: { p1: { kind: 'move', name: 'Iron Head', tera: false }, p2: { kind: 'move', name: 'Hydro Pump', tera: false } },
      playedOutcome: -0.19,
      scoreBefore: -0.05,
      scoreAfter: -0.14,
    }), names);
  };

  test('singles: a sure hit into a kill range reads "kills ~43% of the time", never "was kills"', () => {
    const summary = paidRead({ accuracy: 1, killFraction: 0.43 });
    expect(summary).toContain('a read that paid off');
    expect(summary).toContain('The click kills ~43% of the time.');
    expect(summary).not.toContain('was kills');
  });

  test('doubles: a labelled click names its slot move with the same verb', () => {
    const summary = paidRead({ accuracy: 1, killFraction: 0.43, label: 'Hydro Pump→Chi-Yu' });
    expect(summary).toContain('Hydro Pump→Chi-Yu kills ~43% of the time.');
    expect(summary).not.toContain('was kills');
  });

  test('the roll shapes keep their copula', () => {
    expect(paidRead({ accuracy: 0.8, killFraction: 1 })).toContain('The click was an 80% roll to connect.');
    expect(paidRead({ accuracy: 0.9, killFraction: 0.5 })).toContain('The click was a 90% roll into a ~50% kill range.');
  });
});

describe('T18 point 1: the near sentence waits for a quarter of the bodies to fall', () => {
  const nearResult = (side: 'p1' | 'p2', species: string, odds: number, removes: string, score: number, doubles = false): EvalResult => ({
    score, interval: 0, depthCompleted: 1,
    perSide: doubles
      ? {
        p1: [choice('move heatwave, move protect', 'Heat Wave + Protect', score)],
        p2: [choice('move protect, move precipiceblades', 'Protect + Precipice Blades', -score)],
      }
      : { p1: [choice('move hydropump', 'Hydro Pump', score)], p2: [choice('move fakeout', 'Fake Out', -score)] },
    unanswered: { p1: [], p2: [], nearDecided: { side, species, odds, removes } },
  });
  const at = (result: EvalResult, faintedFraction?: number | null) => analyzeTurn({
    turn: 3, result, played: null, playedOutcome: null, scoreBefore: result.score, scoreAfter: result.score,
    ...(faintedFraction !== undefined ? { faintedFraction } : {}),
  });

  test('singles, 649664 t3: full teams keep the 90% roll quiet; at a quarter fallen it speaks', () => {
    const result = nearResult('p2', 'Medicham-Mega', 0.9, 'Keldeo', -0.11);
    const early = at(result, 0);
    expect(early.p2.nearDecided).toEqual({ species: 'Medicham-Mega', odds: 0.9, removes: 'Keldeo', announce: false });
    expect(summarizeTurn(early, names)).not.toContain('from clearing the rest');
    expect(summarizeTurn(at(result, 0.25), names))
      .toContain('Medicham-Mega is one 90% roll from clearing the rest; removing Keldeo leaves no answer behind.');
    // Without a known share the gate stays off.
    expect(at(result).p2.nearDecided?.announce).toBe(true);
  });

  test('doubles, 2629703929 t2: a sure KO on full teams stays quiet, and later reads as a sure KO, not a 100% roll', () => {
    const result = nearResult('p1', 'Chi-Yu', 1, 'Groudon', 0.67, true);
    expect(summarizeTurn(at(result, 0), names)).not.toContain('from clearing the rest');
    const later = summarizeTurn(at(result, 0.5), names);
    expect(later).toContain('Chi-Yu is one sure KO from clearing the rest; removing Groudon leaves no answer behind.');
    expect(later).not.toContain('100% roll');
  });

  test('573756 t73 keeps its pinned 95% roll at 0.42 fallen', () => {
    const result = nearResult('p2', 'Garchomp', 0.95, 'Corviknight', -0.6);
    expect(summarizeTurn(at(result, 0.4167), names)).toContain('is one 95% roll from clearing the rest');
  });
});

describe('T18 point 2: a side is called practically decided once, and never after its proof', () => {
  const decidedResult = (side: 'p1' | 'p2', species: string, score: number, near?: { species: string; removes: string }): EvalResult => ({
    score, interval: 0, depthCompleted: 1,
    perSide: { p1: [choice('move a', 'A', score)], p2: [choice('move b', 'B', -score)] },
    unanswered: {
      p1: [], p2: [], decided: { side, species },
      ...(near ? { nearDecided: { side, species: near.species, odds: 1, removes: near.removes } } : {}),
    },
  });
  const at = (result: EvalResult, decidedSeen: Set<string>) => analyzeTurn({
    turn: 13, result, played: null, playedOutcome: null, scoreBefore: result.score, scoreAfter: result.score, decidedSeen,
  });

  test('the decided key is the side alone; the near key keeps species and target', () => {
    expect(decidedSeenKey('p2', { species: 'Volcanion' })).toBe(decidedSeenKey('p2', { species: 'Ting-Lu' }));
    expect(decidedSeenKey('p2', { species: 'Volcanion' })).not.toBe(decidedSeenKey('p1', { species: 'Volcanion' }));
    expect(decidedSeenKey('p2', { species: 'Keldeo', removes: 'Weavile' }))
      .not.toBe(decidedSeenKey('p2', { species: 'Keldeo', removes: 'Volcanion' }));
  });

  test('doubles, 2663093831: after Volcanion was called the sweeper, Ting-Lu the next turn stays quiet', () => {
    const spoken = new Set([decidedSeenKey('p2', { species: 'Volcanion' })]);
    const analysis = at(decidedResult('p2', 'Ting-Lu', -0.9), spoken);
    expect(analysis.p2.decided).toEqual({ species: 'Ting-Lu', announce: false });
    expect(summarizeTurn(analysis, names)).not.toContain('practically decided');
  });

  test('singles, 648453 t36 and t37: once the proof has spoken for a side, its decided and near stages stay quiet', () => {
    const proven = new Set([forcedWinSeenKey('p2')]);
    const t36 = at(decidedResult('p2', 'Lopunny-Mega', -1), proven);
    expect(t36.p2.decided?.announce).toBe(false);
    const t37 = at(decidedResult('p2', 'Lopunny-Mega', -0.85, { species: 'Ferrothorn', removes: 'Tornadus-Therian' }), proven);
    expect(t37.p2.nearDecided?.announce).toBe(false);
    expect(summarizeTurn(t37, names)).not.toContain('from clearing the rest');
    expect(at(decidedResult('p1', 'Keldeo', 0.9), proven).p1.decided?.announce).toBe(true);
  });
});

describe('T18 point 3: "practically decided" stays quiet when the turn itself undid it', () => {
  const decidedTurn = (side: 'p1' | 'p2', species: string, scoreBefore: number, scoreAfter: number | null, doubles = false) =>
    analyzeTurn({
      turn: 23,
      result: {
        score: scoreBefore, interval: 0, depthCompleted: 1,
        perSide: doubles
          ? {
            p1: [choice('move astralbarrage, move bodypress 1', 'Astral Barrage + Body Press→Terapagos-Stellar', scoreBefore)],
            p2: [choice('move behemothbash 1, move protect', 'Behemoth Bash→Calyrex-Shadow + Protect', -scoreBefore)],
          }
          : { p1: [choice('move hydropump', 'Hydro Pump', scoreBefore)], p2: [choice('move highjumpkick', 'High Jump Kick', -scoreBefore)] },
        unanswered: { p1: [], p2: [], decided: { side, species } },
      },
      played: null, playedOutcome: null, scoreBefore, scoreAfter,
    });

  test('singles, 649664 t23: 16% to 81% for BKC, so Medicham-Mega clearing everything is not said', () => {
    const analysis = decidedTurn('p2', 'Medicham-Mega', -0.89, 0.79);
    expect(analysis.p2.decided).toEqual({ species: 'Medicham-Mega', announce: false });
    expect(summarizeTurn(analysis, names)).not.toContain('practically decided');
  });

  test('doubles, 2630685175 t8: the decided side flips on the card, so the sentence stays quiet', () => {
    expect(decidedTurn('p2', 'Zamazenta-Crowned', -0.9, 0.86, true).p2.decided?.announce).toBe(false);
  });

  test('573756 t124: an after-score under the decided line (0.39 toward p2) is no practically decided game', () => {
    expect(decidedTurn('p2', 'Zapdos-Galar', -0.76, -0.39).p2.decided?.announce).toBe(false);
  });

  test('a turn that holds the line, or the last turn without an after-score, still speaks', () => {
    expect(summarizeTurn(decidedTurn('p2', 'Zapdos-Galar', -0.89, -0.97), names)).toContain('practically decided');
    expect(decidedTurn('p1', 'Keldeo', 0.79, null).p1.decided?.announce).toBe(true);
  });
});
