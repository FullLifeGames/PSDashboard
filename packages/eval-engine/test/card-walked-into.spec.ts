import { describe, expect, test } from 'vitest';
import { analyzeTurn, TIER_THRESHOLDS, type TurnAnalysis } from '../src/analysis';
import { walkedInto } from '../src/turn-analysis/risk';
import { summarizeTurn } from '../src/summary';
import type { PlayedTurn } from '../src/played';
import type { EvalMatrix, EvalResult, RankedChoice } from '../src/types';

/**
 * Round 70 (gate of 13.10.2026 20:26, 1a, words only): when the opponent's actual click equals the played row's punisher and
 * the played row's worst case trails the best row's worst case by at least a mistake band, the card says what the played row
 * walked into; every grade stays. VGC 2630685175 turn 7: pixelfrost's U-turn into Zamazenta with Tera Starstorm (worst case
 * -0.09, the punisher Pollen Puff with Wide Guard) against the best row's 0.65; Mstr_Hawk clicked exactly that punisher, the
 * equilibrium put no weight on it (regret 0.0005, no tier), and the card said "Both sides picked reasonable options; the engine
 * re-read the position after the turn (-21%)" without a word on Wide Guard.
 *
 * The words are the shift sentences the card already has: the open-turn split and the hindsight read, "The read was there for
 * pixelfrost: against what was actually clicked (...), <best response> was worth +55% more." They reach this turn through the
 * chance part rule (the decision part, -67%, is the larger one) and the plain cell rule (the best response against the click
 * is a plain cell with 4 visits). A turn whose chance part is the larger one keeps its chance sentence and gains the same read
 * sentence for the side that walked into its punisher. Singles and doubles share every rule.
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
  /** The opponent clicked line [1] instead of the punisher. */
  clickedOther?: boolean;
  /** scoreBefore, playedOutcome, scoreAfter. */
  scores?: [number, number, number];
  /** Round 76 (T233): the played row's value against line [1] sits this far above its worst case (default: far above). */
  siblingGap?: number;
}

// The turn-7 numbers: the decision part -1.342 and the chance part -0.417 (a shift), or a chance part larger than the decision part.
const SHIFT: [number, number, number] = [0.9054284770830265, -0.4366561935931187, -0.8535168316469056];
const CHANCE: [number, number, number] = [0.9054284770830265, 0.72, -0.8535168316469056];
// Round 76 (T233): the score did not move and the dice had nothing to say: a quiet turn.
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
    // The opponent's side did not: the click it met was not its punisher.
    expect(walkedInto(analysis.p2, analysis.p1)).toBe(false);
  });

  test('a click that is not the punisher, or a trail under a band, is not a walk into it', () => {
    expect(walkedInto(turnOf(make, { clickedOther: true }).analysis.p1, turnOf(make, { clickedOther: true }).analysis.p2)).toBe(false);
    const close = turnOf(make, { bestWorst: -0.0948465147774409 + TIER_THRESHOLDS.mistake - 0.01 }).analysis;
    expect(walkedInto(close.p1, close.p2)).toBe(false);
    const edge = turnOf(make, { bestWorst: -0.0948465147774409 + TIER_THRESHOLDS.mistake + 0.01 }).analysis;
    expect(walkedInto(edge.p1, edge.p2)).toBe(true);
  });

  // Round 76 (T233): the click is a sibling of the punisher when the played row's value against it lies within one inaccuracy of its worst case.
  test('a click that ties the punisher within an inaccuracy is a walk into it, one band further out is not (red before: only the exact label)', () => {
    const tied = turnOf(make, { clickedOther: true, siblingGap: TIER_THRESHOLDS.inaccuracy - 0.02 }).analysis;
    expect(tied.p1.played!.punishedBy).not.toBe(tied.p2.played!.label);
    expect(walkedInto(tied.p1, tied.p2)).toBe(true);
    const far = turnOf(make, { clickedOther: true, siblingGap: TIER_THRESHOLDS.inaccuracy + 0.02 }).analysis;
    expect(walkedInto(far.p1, far.p2)).toBe(false);
    // The opponent's side did not walk into anything.
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

  test('a click that ties the punisher gets the read after the chance sentence (round 76, T233; red before: no read)', () => {
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

describe.each(GAMES)('%s: the card of a quiet turn (round 76, T233)', (_name, make) => {
  test('the side that walked into its punisher keeps the read it showed on a chance card (red before: "A quiet turn." alone)', () => {
    const { analysis, names } = turnOf(make, { scores: QUIET });
    expect(analysis.attribution).toBe('quiet');
    const text = summarizeTurn(analysis, names);
    expect(text).toContain('A quiet turn.');
    expect(text).toContain(`${READ} ${names[0]}: against`);
    expect(text).toContain('was worth +55% more.');
    expect(text.indexOf(READ)).toBeGreaterThan(text.indexOf('A quiet turn.'));
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
