import { describe, expect, test } from 'vitest';
import { analyzeTurn, type SideAnalysis, type TurnAnalysis } from '../src/analysis';
import { summarizeTurn } from '../src/summary';
import type { PlayedTurn } from '../src/played';
import type { EvalMatrix, EvalResult, KoOddsInfo, RankedChoice } from '../src/types';

/**
 * Round 70 (gate of 13.10.2026 20:26, 4a): the "True odds" note quotes reply-independent KO odds of a line ("Tera Starstorm
 * kills ~4% of the time"), priced on the board before the turn. When the opponent's actual pair stops that hit (Wide Guard turns
 * Tera Starstorm away, a Protect turns a single hit away) the note quotes a roll that never happened. VGC 2630685175 turn 7 in
 * the full answer form said it twice. The stop is read from the cell of the line against the click, which the search priced
 * from the simulator's own turn: a cell the planner finds plain (no accuracy roll and no kill range in it) holds no roll of any
 * hit, and a doubles cell lists its events with the move that makes each (`p1b:terastarstorm>p2b=hit-nokill`), so a claim whose
 * attacker slot and move have no event there never landed. A cell the search did not plan, a failed plan, and a claim the cell
 * still lists keep the note, and so does a singles cell holding a roll (its classes name no move).
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
  /** The opponent's clicked line and one more. */
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
