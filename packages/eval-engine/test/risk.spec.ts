import { describe, expect, test } from 'vitest';
import { analyzeTurn, TIER_THRESHOLDS, type TurnAnalysis, CHANCE_THRESHOLD, type SideAnalysis } from '../src/analysis';
import { walkedInto, shownAttribution, lostGround } from '../src/turn-analysis/risk';
import { summarizeTurn } from '../src/summary';
import type { PlayedTurn } from '../src/played';
import type { EvalMatrix, EvalResult, RankedChoice } from '../src/types';
import { buildGameReport } from '../src/report';

/**
 * The card says what the played row walked into when the opponent's click equals the played row's punisher and the played row's
 * worst case trails the best row's by at least a mistake band; every grade stays. VGC 2630685175 turn 7: pixelfrost's U-turn into
 * Zamazenta with Tera Starstorm (worst case -0.09, the punisher Pollen Puff with Wide Guard) against the best row's 0.65; Mstr_Hawk
 * clicked exactly that punisher, the equilibrium put no weight on it (regret 0.0005, no tier), and the card said "Both sides picked
 * reasonable options; the engine re-read the position after the turn (-21%)" without a word on Wide Guard.
 *
 * The words are the card's hindsight sentence: "The read was there for pixelfrost: against what was actually clicked (...),
 * <best response> was worth +55% more." This turn reaches it through the chance part rule (the decision part, -67%, is the larger
 * one) and the plain cell rule (the best response against the click is a plain cell with 4 visits). A turn whose chance part is the
 * larger one keeps its chance sentence and gains the same read sentence. Singles and doubles share every rule.
 */

type Cell = NonNullable<EvalMatrix['cells']>[number][number];
const SEEN: Cell = { visits: 30, verified: false };
const PLAIN_THIN: Cell = { visits: 4, verified: false, plan: 'none' };
const PLAIN: Cell = { visits: 30, verified: false, plan: 'none' };
const GUESS: Cell = { visits: 4, verified: false, plan: 'events', classes: [{ key: 'hit-nokill', weight: 0.6 }, { key: 'miss', weight: 0.4 }] };

interface Game {
  names: [string, string];
  /** The 13 own lines in ranked order: [0] the best, [PLAYED] the played one, [RESPONSE] the best answer to the click. */
  p1: { choice: string; label: string }[];
  /** The 13 opponent lines: [0] the click (and the played row's punisher), [1] another line. */
  p2: { choice: string; label: string }[];
  played: PlayedTurn;
  /** The played turn of the other column: the opponent clicked line [1]. */
  playedOther: PlayedTurn;
}

const PLAYED = 6;
const RESPONSE = 7;

const filler = (count: number, make: (index: number) => { choice: string; label: string }) => Array.from({ length: count }, (_, index) => make(index));

const doubles = (): Game => {
  const named = [
    ['move woodhammer 1, move terastarstorm', 'Wood Hammer→Calyrex-Shadow + Tera Starstorm'],
    ['move uturn 1, move earthpower 1', 'U-turn→Calyrex-Shadow + Earth Power→Calyrex-Shadow'],
    ['move grassyglide 1, move terastarstorm', 'Grassy Glide→Calyrex-Shadow + Tera Starstorm'],
    ['move grassyglide 1, move earthpower 1', 'Grassy Glide→Calyrex-Shadow + Earth Power→Calyrex-Shadow'],
    ['move woodhammer 1, move earthpower 1', 'Wood Hammer→Calyrex-Shadow + Earth Power→Calyrex-Shadow'],
    ['move uturn 1, move terastarstorm', 'U-turn→Calyrex-Shadow + Tera Starstorm'],
    ['move uturn 2, move terastarstorm', 'U-turn→Zamazenta-Crowned + Tera Starstorm'],
    ['move woodhammer 1, move earthpower 2', 'Wood Hammer→Calyrex-Shadow + Earth Power→Zamazenta-Crowned'],
    ['move woodhammer 1, move protect', 'Wood Hammer→Calyrex-Shadow + Protect'],
    ['move grassyglide 1, move earthpower 2', 'Grassy Glide→Calyrex-Shadow + Earth Power→Zamazenta-Crowned'],
    ['move grassyglide 1, move meteorbeam 1', 'Grassy Glide→Calyrex-Shadow + Meteor Beam→Calyrex-Shadow'],
    ['move uturn 1, move earthpower 2', 'U-turn→Calyrex-Shadow + Earth Power→Zamazenta-Crowned'],
    ['move woodhammer 1, move meteorbeam 1', 'Wood Hammer→Calyrex-Shadow + Meteor Beam→Calyrex-Shadow'],
  ].map(([choice, label]) => ({ choice, label }));
  const opp = [
    { choice: 'move pollenpuff -2, move wideguard', label: 'Pollen Puff→Zamazenta-Crowned + Wide Guard' },
    { choice: 'move protect, move protect', label: 'Protect + Protect' },
    ...filler(11, index => ({ choice: `move taunt ${index + 1}, move protect`, label: `Taunt${index}→Rillaboom + Protect` })),
  ];
  const slots = (moves: [string, number | null][]) => moves.map(([name, targetLoc]) => ({ kind: 'move' as const, name, targetLoc }));
  const own = slots([['U-turn', 2], ['Tera Starstorm', 2]]);
  return {
    names: ['pixelfrost', 'Mstr_Hawk'], p1: named, p2: opp,
    played: { p1: null, p2: null, p1Slots: own, p2Slots: slots([['Pollen Puff', -2], ['Wide Guard', null]]) },
    playedOther: { p1: null, p2: null, p1Slots: own, p2Slots: slots([['Protect', null], ['Protect', null]]) },
  };
};

const singles = (): Game => {
  const named = [
    ['move earthquake', 'Earthquake'], ['move ironhead', 'Iron Head'], ['move outrage', 'Outrage'], ['move stoneedge', 'Stone Edge'],
    ['move dragonclaw', 'Dragon Claw'], ['move crunch', 'Crunch'], ['move uturn', 'U-turn'], ['move swordsdance', 'Swords Dance'],
    ['move recover', 'Recover'], ['move rest', 'Rest'], ['move toxic', 'Toxic'], ['move spikes', 'Spikes'], ['move roar', 'Roar'],
  ].map(([choice, label]) => ({ choice, label }));
  const opp = [
    { choice: 'move taunt', label: 'Taunt' }, { choice: 'move protect', label: 'Protect' },
    ...filler(11, index => ({ choice: `switch ${index + 2}`, label: `→ Switch${index}` })),
  ];
  return {
    names: ['Alpha', 'Beta'], p1: named, p2: opp,
    played: { p1: { kind: 'move', name: 'U-turn', tera: false }, p2: { kind: 'move', name: 'Taunt', tera: false } },
    playedOther: { p1: { kind: 'move', name: 'U-turn', tera: false }, p2: { kind: 'move', name: 'Protect', tera: false } },
  };
};

const GAMES: [string, () => Game][] = [['doubles', doubles], ['singles', singles]];

interface Options {
  /** The cell of the best response against the click, and the played row's. */
  responseCell?: Cell;
  playedCell?: Cell;
  /** The best row's worst case (the played row's is -0.0948). */
  bestWorst?: number;
  clickedOther?: boolean;
  /** scoreBefore, playedOutcome, scoreAfter. */
  scores?: [number, number, number];
  /** The played row's value against line [1] sits this far above its worst case (default: far above). */
  siblingGap?: number;
}

// The turn-7 numbers: the decision part -1.342 and the chance part -0.417 (a shift), or a chance part larger than the decision part.
const SHIFT: [number, number, number] = [0.9054284770830265, -0.4366561935931187, -0.8535168316469056];
const CHANCE: [number, number, number] = [0.9054284770830265, 0.72, -0.8535168316469056];
// The score did not move and the dice had nothing to say: a quiet turn.
const QUIET: [number, number, number] = [0.9054284770830265, 0.9, 0.9];

function turnOf(make: () => Game, options: Options = {}): { analysis: TurnAnalysis; names: [string, string] } {
  const game = make();
  const evs = [0.7117, 0.7116, 0.7115, 0.7115, 0.7114, 0.7113, 0.7113, 0.6997, 0.6993, 0.55, 0.2410, 0.2406, 0.1408];
  const worstOf = (index: number): number => (index === 0 ? options.bestWorst ?? 0.6514 : index === PLAYED ? -0.0948465147774409 : evs[index] - 0.05);
  const p1Rows: RankedChoice[] = game.p1.map((line, index) => ({
    choice: line.choice, label: line.label, ev: evs[index], expected: evs[index], worstCase: worstOf(index),
    punishedBy: index === PLAYED ? game.p2[0].label : game.p2[1].label,
  }));
  const p2Rows: RankedChoice[] = game.p2.map((line, index) => ({
    choice: line.choice, label: line.label, ev: -0.995 - 0.0005 * index, expected: -0.995, worstCase: -1, punishedBy: game.p1[RESPONSE].label,
  }));
  // The click column: the best response beats the played row by 1.0948 (+55%); the other column by 0.6.
  const values = game.p1.map((_, i) => game.p2.map((__, j) => {
    if (j === 0) return i === RESPONSE ? 1.0 : i === PLAYED ? -0.0948465147774409 : i === 0 ? 0.6514 : 0.5;
    if (j === 1) return i === RESPONSE ? 0.9 : i === PLAYED ? (options.siblingGap === undefined ? 0.3 : -0.0948465147774409 + options.siblingGap) : 0.5;
    return 0.5;
  }));
  const cells = game.p1.map((_, i) => game.p2.map((__, j) => {
    if (j === 0 && i === RESPONSE) return options.responseCell ?? PLAIN_THIN;
    if (j === 0 && i === PLAYED) return options.playedCell ?? PLAIN;
    return SEEN;
  }));
  const result: EvalResult = {
    score: 0.9, interval: 0.02, depthCompleted: 1,
    perSide: { p1: p1Rows, p2: p2Rows },
    matrix: {
      p1Labels: game.p1.map(line => line.label), p2Labels: game.p2.map(line => line.label),
      p1Choices: game.p1.map(line => line.choice), p2Choices: game.p2.map(line => line.choice),
      values, mixes: { p1: game.p1.map(() => 1 / 13), p2: game.p2.map(() => 1 / 13) }, cells,
    },
  };
  const [scoreBefore, playedOutcome, scoreAfter] = options.scores ?? SHIFT;
  const analysis = analyzeTurn({
    turn: 7, result, played: options.clickedOther ? game.playedOther : game.played, playedOutcome, scoreBefore, scoreAfter,
    faintedFraction: 0.375, faintedFractionAfter: 0.375, actives: { p1: null, p2: null, gen: 9 },
  });
  return { analysis, names: game.names };
}

const READ = 'The read was there for';

describe('the turn-7 card (doubles): the shift sentences name what the played row walked into', () => {
  test('the full card, word for word (red before: "Both sides picked reasonable options; the engine re-read the position after the turn (−21%).")', () => {
    const { analysis, names } = turnOf(doubles);
    expect(analysis.p1.tier).toBeUndefined();
    expect(analysis.p1.regret!).toBeLessThan(0.001);
    expect(analysis.attribution).toBe('shift');
    expect(summarizeTurn(analysis, names)).toBe(
      'The estimate moved from 90% to 11% for pixelfrost. ' +
      'A genuinely open turn rather than a drift: 9 of 13 options for pixelfrost and 13 of 13 for Mstr_Hawk sat within an inaccuracy of best, ' +
      'so the turn hinged on out-predicting the opponent (−67% expected, −21% with no roll behind it). ' +
      'The read was there for pixelfrost: against what was actually clicked (Pollen Puff→Zamazenta-Crowned + Wide Guard), ' +
      'Wood Hammer→Calyrex-Shadow + Earth Power→Zamazenta-Crowned was worth +55% more.');
  });
});

describe.each(GAMES)('%s: the trigger', (_name, make) => {
  test('the click equals the punisher and the worst case trails by a band: walked into', () => {
    const { analysis } = turnOf(make);
    expect(analysis.p1.played!.punishedBy).toBe(analysis.p2.played!.label);
    expect(analysis.p1.best!.worstCase - analysis.p1.played!.worstCase).toBeGreaterThanOrEqual(TIER_THRESHOLDS.mistake);
    expect(walkedInto(analysis.p1, analysis.p2)).toBe(true);
    expect(walkedInto(analysis.p2, analysis.p1)).toBe(false);
  });

  test('a click that is not the punisher, or a trail under a band, is not a walk into it', () => {
    expect(walkedInto(turnOf(make, { clickedOther: true }).analysis.p1, turnOf(make, { clickedOther: true }).analysis.p2)).toBe(false);
    const close = turnOf(make, { bestWorst: -0.0948465147774409 + TIER_THRESHOLDS.mistake - 0.01 }).analysis;
    expect(walkedInto(close.p1, close.p2)).toBe(false);
    const edge = turnOf(make, { bestWorst: -0.0948465147774409 + TIER_THRESHOLDS.mistake + 0.01 }).analysis;
    expect(walkedInto(edge.p1, edge.p2)).toBe(true);
  });

  // The click is a sibling of the punisher when the played row's value against it lies within one inaccuracy of its worst case.
  test('a click that ties the punisher within an inaccuracy is a walk into it, one band further out is not (red before: only the exact label)', () => {
    const tied = turnOf(make, { clickedOther: true, siblingGap: TIER_THRESHOLDS.inaccuracy - 0.02 }).analysis;
    expect(tied.p1.played!.punishedBy).not.toBe(tied.p2.played!.label);
    expect(walkedInto(tied.p1, tied.p2)).toBe(true);
    const far = turnOf(make, { clickedOther: true, siblingGap: TIER_THRESHOLDS.inaccuracy + 0.02 }).analysis;
    expect(walkedInto(far.p1, far.p2)).toBe(false);
    expect(walkedInto(tied.p2, tied.p1)).toBe(false);
  });

  test('a tied click still needs the band the worst case trails the best line by', () => {
    const close = turnOf(make, { clickedOther: true, siblingGap: 0.03, bestWorst: -0.0948465147774409 + TIER_THRESHOLDS.mistake - 0.01 }).analysis;
    expect(walkedInto(close.p1, close.p2)).toBe(false);
  });

  test('a side without a played line, a best line or a click is not a walk into anything', () => {
    const { analysis } = turnOf(make);
    expect(walkedInto({ ...analysis.p1, played: null }, analysis.p2)).toBe(false);
    expect(walkedInto({ ...analysis.p1, best: null }, analysis.p2)).toBe(false);
    expect(walkedInto(analysis.p1, { ...analysis.p2, played: null })).toBe(false);
  });
});

describe.each(GAMES)('%s: the card of a turn the decision part carried (a shift)', (_name, make) => {
  test('the shift card quotes the read against the click, the plain cell standing with 4 visits', () => {
    const { analysis, names } = turnOf(make);
    expect(analysis.attribution).toBe('shift');
    expect(analysis.p1.hindsightRead?.thin).toBeUndefined();
    const text = summarizeTurn(analysis, names);
    expect(text).toContain(`${READ} ${names[0]}: against`);
    expect(text).toContain('was worth +55% more.');
    expect(text).toContain(`${make().p1[RESPONSE].label} was worth`);
  });

  test('every grade stays: tier, regret, best and safe lines do not move with the words', () => {
    const { analysis } = turnOf(make);
    expect(analysis.p1.tier).toBeUndefined();
    expect(analysis.p2.tier).toBeUndefined();
    expect(analysis.p1.regret!).toBeCloseTo(0, 3);
    expect(analysis.p1.best!.label).toBe(make().p1[0].label);
  });
});

describe.each(GAMES)('%s: the card of a turn the chance part carried', (_name, make) => {
  test('the chance sentence stays and the side that walked into its punisher gets the read after it (red before: no read)', () => {
    const { analysis, names } = turnOf(make, { scores: CHANCE });
    expect(analysis.attribution).toBe('chance');
    const text = summarizeTurn(analysis, names);
    expect(text).toContain('Both sides picked reasonable options; the estimate moved');
    expect(text).toContain('with no roll behind it');
    expect(text).toContain(`${READ} ${names[0]}: against`);
    expect(text.indexOf(READ)).toBeGreaterThan(text.indexOf('Both sides picked reasonable options'));
  });

  test('no read sentence when the click was not the punisher (the read of a clicked column that did not punish stays a shift matter)', () => {
    const { analysis, names } = turnOf(make, { scores: CHANCE, clickedOther: true });
    expect(analysis.attribution).toBe('chance');
    expect(summarizeTurn(analysis, names)).not.toContain(READ);
  });

  test('a click that ties the punisher gets the read after the chance sentence (red before: no read)', () => {
    const { analysis, names } = turnOf(make, { scores: CHANCE, clickedOther: true, siblingGap: 0.05 });
    expect(analysis.attribution).toBe('chance');
    const text = summarizeTurn(analysis, names);
    expect(text).toContain(`${READ} ${names[0]}: against`);
    expect(text.indexOf(READ)).toBeGreaterThan(text.indexOf('Both sides picked reasonable options'));
    const far = turnOf(make, { scores: CHANCE, clickedOther: true, siblingGap: 0.25 });
    expect(summarizeTurn(far.analysis, far.names)).not.toContain(READ);
  });

  test('no read sentence when the worst case trails by less than a band', () => {
    const { analysis, names } = turnOf(make, { scores: CHANCE, bestWorst: 0.0 });
    expect(walkedInto(analysis.p1, analysis.p2)).toBe(false);
    expect(summarizeTurn(analysis, names)).not.toContain(READ);
  });

  test('no read sentence when its cell is a guess (the thin gate holds here too)', () => {
    const { analysis, names } = turnOf(make, { scores: CHANCE, responseCell: GUESS });
    expect(analysis.p1.hindsightRead?.thin).toBe(true);
    expect(summarizeTurn(analysis, names)).not.toContain(READ);
  });

  test('a game resolving toward its decided side keeps its own sentence and gains no read', () => {
    const { analysis, names } = turnOf(make, { scores: CHANCE });
    const resolving: TurnAnalysis = { ...analysis, p2: { ...analysis.p2, decided: { species: 'Calyrex', announce: false } }, chanceDelta: -1, swing: -1 };
    const text = summarizeTurn(resolving, names);
    expect(text).toContain('the decided game resolving toward');
    expect(text).not.toContain(READ);
  });
});

describe.each(GAMES)('%s: the card of a quiet turn', (_name, make) => {
  test('the side that walked into its punisher keeps the read it showed on a chance card (red before: the quiet sentence alone)', () => {
    const { analysis, names } = turnOf(make, { scores: QUIET });
    expect(analysis.attribution).toBe('quiet');
    const text = summarizeTurn(analysis, names);
    // The walked read stands beside the sentence, so the card says "Neither side made a mistake." and never "A quiet turn.".
    expect(text).toContain('Neither side made a mistake.');
    expect(text).not.toContain('quiet');
    expect(text).toContain(`${READ} ${names[0]}: against`);
    expect(text).toContain('was worth +55% more.');
    expect(text.indexOf(READ)).toBeGreaterThan(text.indexOf('Neither side made a mistake.'));
  });

  test('no read when the click was no punisher, the cell is a guess, or the worst case trails by less than a band', () => {
    const other = turnOf(make, { scores: QUIET, clickedOther: true });
    expect(summarizeTurn(other.analysis, other.names)).not.toContain(READ);
    const guess = turnOf(make, { scores: QUIET, responseCell: GUESS });
    expect(guess.analysis.p1.hindsightRead?.thin).toBe(true);
    expect(summarizeTurn(guess.analysis, guess.names)).not.toContain(READ);
    const near = turnOf(make, { scores: QUIET, bestWorst: 0.0 });
    expect(summarizeTurn(near.analysis, near.names)).not.toContain(READ);
  });
});

describe('attribution-chance-larger', () => {
  const row = (choice: string, label: string, ev: number): RankedChoice => ({ choice, label, worstCase: ev, expected: ev, ev, punishedBy: 'Reply' });
  const names: [string, string] = ['Alpha', 'Beta'];

  interface Shape {
    result: EvalResult;
    played: PlayedTurn;
  }

  /** Both sides play the one option they have, which is the engine's best: no culprit can exist, only the movement is left to read. */
  const singles = (): Shape => ({
    result: {
      score: 0.1, interval: 0.02, depthCompleted: 1,
      perSide: { p1: [row('move dracometeor', 'Draco Meteor', 0.2)], p2: [row('switch 3', '→ Dragapult', -0.05)] },
    },
    played: { p1: { kind: 'move', name: 'Draco Meteor', tera: false }, p2: { kind: 'switch', name: 'Dragapult', species: 'Dragapult' } },
  });

  const doubles = (): Shape => ({
    result: {
      score: 0.1, interval: 0.02, depthCompleted: 1,
      perSide: {
        p1: [row('move uturn 2, move terastarstorm', 'U-turn→Zamazenta-Crowned + Tera Starstorm', 0.2)],
        p2: [row('move pollenpuff -2, move wideguard', 'Pollen Puff→Zamazenta-Crowned + Wide Guard', -0.05)],
      },
    },
    played: {
      p1: null, p2: null,
      p1Slots: [{ kind: 'move', name: 'U-turn', targetLoc: 2 }, { kind: 'move', name: 'Tera Starstorm', targetLoc: 2 }],
      p2Slots: [{ kind: 'move', name: 'Pollen Puff', targetLoc: -2 }, { kind: 'move', name: 'Wide Guard', targetLoc: -2 }],
    },
  });

  const SHAPES: [string, () => Shape][] = [['singles', singles], ['doubles', doubles]];

  /** The decision part is playedOutcome - scoreBefore, the chance part scoreAfter - playedOutcome. */
  const turnOf = (make: () => Shape, scoreBefore: number, playedOutcome: number, scoreAfter: number): TurnAnalysis => {
    const { result, played } = make();
    return analyzeTurn({ turn: 7, result, played, playedOutcome, scoreBefore, scoreAfter });
  };

  describe.each(SHAPES)('%s: the chance part must be the larger part of the swing', (_name, make) => {
    test('a residual past the band that is not the larger part leaves the turn a shift (2630685175 t7 shape, red before: chance)', () => {
      const analysis = turnOf(make, 0.9, -0.44, -0.85);
      expect(analysis.decisionDelta).toBeCloseTo(-1.34, 10);
      expect(analysis.chanceDelta).toBeCloseTo(-0.41, 10);
      expect(Math.abs(analysis.chanceDelta!)).toBeGreaterThanOrEqual(CHANCE_THRESHOLD);
      expect(analysis.p1.tier).toBeUndefined();
      expect(analysis.p2.tier).toBeUndefined();
      expect(analysis.attribution).toBe('shift');
    });

    test('a chance part larger than the decision part stays a chance swing', () => {
      expect(turnOf(make, 0.1, 0.15, -0.4).attribution).toBe('chance');
      expect(turnOf(make, 0.25, 0.25, -0.25).attribution).toBe('chance');
    });

    test('the chance part must be the larger one, not an equal one: a tie is a shift (the swing is a band)', () => {
      const analysis = turnOf(make, 0.25, 0.5, 0.75);
      expect(analysis.decisionDelta).toBe(0.25);
      expect(analysis.chanceDelta).toBe(0.25);
      expect(analysis.attribution).toBe('shift');
    });

    test('a residual under the band is no chance swing whatever the decision part is (unchanged)', () => {
      // Decision part +0.2, chance part +0.15, swing +0.35: a shift. Both parts small: quiet.
      expect(turnOf(make, 0.25, 0.5, 0.65).attribution).toBe('shift');
      expect(turnOf(make, 0.25, 0.3, 0.4).attribution).toBe('quiet');
    });

    test('parts that cancel to a quiet swing make a quiet turn, however large each is', () => {
      const analysis = turnOf(make, 0.5, 0.125, 0.4375);
      expect(analysis.decisionDelta).toBe(-0.375);
      expect(analysis.chanceDelta).toBe(0.3125);
      expect(Math.abs(analysis.swing!)).toBeLessThan(CHANCE_THRESHOLD);
      expect(analysis.attribution).toBe('quiet');
    });

    test('a shift whose parts pull opposite ways does not claim they pushed the same way (red before: the frame said so)', () => {
      // Decision part -0.75, chance part +0.25: the choices cost more than the engine's re-read gave back.
      const opposite = turnOf(make, 0.5, -0.25, 0.0);
      expect(opposite.decisionDelta).toBe(-0.75);
      expect(opposite.chanceDelta).toBe(0.25);
      expect(opposite.attribution).toBe('shift');
      const card = summarizeTurn(opposite, names);
      expect(card).toContain('No single mistake stands out');
      expect(card).not.toContain('pushed the same way');
      const same = turnOf(make, 0.5, -0.25, -0.5);
      expect(same.attribution).toBe('shift');
      expect(summarizeTurn(same, names)).toContain('pushed the same way');
    });
  });

  describe('the shown attribution of a read that lost ground applies the same rule', () => {
    const played = row('move earthquake', 'Earthquake', 0.2);
    const side = (): SideAnalysis => ({ playedRaw: null, played, best: played, safe: played, regret: 0 });
    const turn = (over: Partial<TurnAnalysis>): TurnAnalysis => ({
      turn: 10, scoreBefore: 0, scoreAfter: 0, swing: 0, playedOutcome: 0, decisionDelta: 0, chanceDelta: 0,
      attribution: 'p2-read', p1: side(), p2: { ...side(), riskPaidOff: true }, playedTracking: true, ...over,
    });

    test('a residual that is not the larger part shows a shift, a larger one the chance swing', () => {
      expect(shownAttribution(turn({ swing: 0.3, decisionDelta: -0.19, chanceDelta: 0.49 }))).toBe('chance');
      expect(shownAttribution(turn({ swing: 0.3, decisionDelta: 0.7, chanceDelta: -0.4 }))).toBe('shift');
    });

    test('a turn without a decision part keeps the reading of the residual alone', () => {
      expect(shownAttribution(turn({ swing: 0.3, decisionDelta: null, chanceDelta: 0.49 }))).toBe('chance');
    });
  });
});

const ranked = (choice: string, label: string, ev: number): RankedChoice =>
  ({ choice, label, worstCase: ev, expected: ev, ev, punishedBy: null });

const sideOf = (extra: Partial<SideAnalysis> = {}): SideAnalysis => {
  const line = ranked('move earthquake', 'Earthquake', 0.2);
  return { playedRaw: null, played: line, best: line, safe: line, regret: 0, ...extra };
};

const paid = (label: string, extra: Partial<SideAnalysis> = {}): SideAnalysis => sideOf({
  played: ranked('move hydropump', label, 0.3), safe: ranked('move scald', 'Scald', 0.1), riskPaidOff: true, riskPayoff: 0.2, ...extra,
});

const turn = (over: Partial<TurnAnalysis>): TurnAnalysis => ({
  turn: 10, scoreBefore: 0, scoreAfter: 0, swing: 0, playedOutcome: 0, decisionDelta: 0, chanceDelta: 0,
  attribution: 'quiet', p1: sideOf(), p2: sideOf(), playedTracking: true, ...over,
});

const names: [string, string] = ['BKC', '3d'];

describe('the shared predicate', () => {
  test('a side lost ground when its own estimate fell by at least 0.1 across the turn', () => {
    expect(lostGround({ swing: -0.3 }, 'p1')).toBe(true);
    expect(lostGround({ swing: -0.3 }, 'p2')).toBe(false);
    expect(lostGround({ swing: 0.3 }, 'p2')).toBe(true);
    expect(lostGround({ swing: -0.1 }, 'p1')).toBe(true);
    expect(lostGround({ swing: -0.05 }, 'p1')).toBe(false);
    expect(lostGround({ swing: null }, 'p1')).toBe(false);
  });

  test('a read whose side lost ground leaves the shown attribution; both-read keeps the other side', () => {
    expect(shownAttribution(turn({ attribution: 'p2-read', p2: paid('Hydro Pump'), swing: 0.3, chanceDelta: 0.49 }))).toBe('chance');
    expect(shownAttribution(turn({ attribution: 'p2-read', p2: paid('Hydro Pump'), swing: 0.3, chanceDelta: 0.1 }))).toBe('shift');
    expect(shownAttribution(turn({ attribution: 'both-read', p1: paid('Scald'), p2: paid('Hydro Pump'), swing: 0.3 }))).toBe('p1-read');
    expect(shownAttribution(turn({ attribution: 'p1-read', p1: paid('Scald'), swing: 0.05 }))).toBe('p1-read');
    expect(shownAttribution(turn({ attribution: 'p1-decision' }))).toBe('p1-decision');
  });
});

describe('the card stays silent on a lost-ground read', () => {
  test('singles (653785 t10 shape): Hydro Pump paid off on the cell, 3d lost 0.298, so no praise; the attribution field stays', () => {
    const analysis = turn({ attribution: 'p2-read', p2: paid('Hydro Pump'), swing: 0.298, decisionDelta: -0.193, chanceDelta: 0.491, scoreAfter: 0.298 });
    const summary = summarizeTurn(analysis, names);
    expect(summary).not.toContain('a read that paid off');
    expect(summary).toContain('Both sides picked reasonable options');
    expect(analysis.attribution).toBe('p2-read');
  });

  test('doubles (2663093831 t1 shape): a window read at a small loss keeps its praise', () => {
    const shed = paid('Protect + Shed Tail', { played: ranked('move protect, move shedtail', 'Protect + Shed Tail', 0.3), riskPayoffTurn: 3 });
    const summary = summarizeTurn(turn({ attribution: 'p1-read', p1: shed, swing: -0.041, chanceDelta: 0.236 }), names);
    expect(summary).toContain('a read that paid off 3 turns later');
  });

  test('doubles (912045 t9 shape): a paid-off pair whose side lost 0.544 is not praised', () => {
    const pair = paid('Hyper Voice + Life Dew', { played: ranked('move hypervoice, move lifedew', 'Hyper Voice + Life Dew', 0.3) });
    const summary = summarizeTurn(turn({ attribution: 'p1-read', p1: pair, swing: -0.544, decisionDelta: 0.143, chanceDelta: -0.687 }), names);
    expect(summary).not.toContain('a read that paid off');
    expect(summary).toContain('Both sides picked reasonable options');
  });

  test('a read credit stays silent on a lost turn (653785 t25 shape) and speaks at a small loss (2629703929 t7 shape)', () => {
    const credit = sideOf({ played: ranked('switch 4', '→ Cofagrigus', 0.2), safe: ranked('switch 3', '→ Volcanion', 0.1), readCredit: { payoff: 0.31 } });
    expect(summarizeTurn(turn({ attribution: 'chance', p1: credit, swing: -0.481, chanceDelta: -0.783 }), names))
      .not.toContain('a read the engine gave no weight');
    expect(summarizeTurn(turn({ attribution: 'quiet', p1: credit, swing: -0.02, chanceDelta: -0.04 }), names))
      .toContain('a read the engine gave no weight');
  });
});

describe('the report lists and credits only reads whose turn held', () => {
  test('562428 shape: the lost-ground Stone Edge leaves the read list and the reads sentence, Close Combat stays; totals unchanged', () => {
    const read = (label: string, payoff: number, regret: number) =>
      paid(label, { played: ranked(`move ${label.toLowerCase().replace(' ', '')}`, label, 0.3), riskPayoff: payoff, regret });
    const analyses = [
      turn({ turn: 1, scoreBefore: 0, scoreAfter: 0.05, swing: 0.05 }),
      turn({ turn: 2, scoreBefore: 0.05, scoreAfter: -0.065, swing: -0.115, attribution: 'p1-read', p1: read('Stone Edge', 0.222, 0.1) }),
      turn({ turn: 3, scoreBefore: -0.065, scoreAfter: 0.33, swing: 0.395, attribution: 'p1-read', p1: read('Close Combat', 0.408, 0.1) }),
      turn({ turn: 4, scoreBefore: 0.33, scoreAfter: 0.7, swing: 0.37 }),
      turn({ turn: 5, scoreBefore: 0.7, scoreAfter: 0.9, swing: 0.2 }),
    ];
    const report = buildGameReport(analyses, ['LordEnz', 'Dflo'], 'p1');
    expect(report.reads.map(entry => entry.turn)).toEqual([3]);
    expect(report.summary).toContain('LordEnz won it on reads: Close Combat on turn 3');
    expect(report.summary).not.toContain('Stone Edge');
    expect(report.decisionTotals.p1).toBe(0);
  });
});
