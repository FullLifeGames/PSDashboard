import { describe, expect, test } from 'vitest';
import type { DiceReport, DieReport, DieName, DieResult } from '@fulllifegames/eval-engine';
import { branchFrameLog } from '../../../src/lib/branch-log';
import { DIE_LINE, dieLines, dieText, entryDice, withDieLines, type TurnWindow } from '../../../src/lib/branch-dice-lines';
import { wordsOf } from '../../../src/lib/branch-dice';
import { diceMarksOf } from '../../../src/lib/branch-dice-marks';
import { diceBattle, setOf } from '../fixtures/dice-battle';

/**
 * Round 82 (forced dice), step A7b, decision 6a: the frame shows a display line before the event a forced die decided ("Forced: Air
 * Slash flinch, 60 %": the chance the simulator used, decision 14a) and, for a forced die without effect, a line at the end of its
 * action ("Forced burn had no effect"). The lines sit in the display of the branch log at the report's log index; the battle's own
 * log never holds them. The report's index counts the battle's log, which writes a `|split|` line and both versions of a line the
 * players see differently; the shown log has one line there.
 */
const words = wordsOf(diceBattle({ p1: [setOf('Noivern', ['airslash', 'splash'])], p2: [setOf('Snorlax', ['splash'])] }));

/** A turn that starts after two older lines; the damage line of Snorlax is a split triple in the battle's log. */
const BATTLE_LOG = [
  '|old', '|old two',
  '|move|p1a: Noivern|Air Slash|p2a: Snorlax',
  '|split|p2', '|-damage|p2a: Snorlax|60/100', '|-damage|p2a: Snorlax|60/100',
  '|move|p2a: Snorlax|Splash|p2a: Snorlax',
  '|-activate|p2a: Snorlax|move: Splash',
  '|upkeep',
  '|turn|2',
];
const SHOWN_LOG = [
  '|old', '|old two',
  '|move|p1a: Noivern|Air Slash|p2a: Snorlax',
  '|-damage|p2a: Snorlax|60/100',
  '|move|p2a: Snorlax|Splash|p2a: Snorlax',
  '|-activate|p2a: Snorlax|move: Splash',
  '|upkeep',
  '|turn|2',
];
const WINDOW: TurnWindow = { battleLog: BATTLE_LOG, battleStart: 2, shownLog: SHOWN_LOG, shownStart: 2, complete: true };

const name = (kind: DieName['kind'], extra: Partial<DieName> = {}): DieName => ({ slot: 'p1a', moveId: 'airslash', targetSlot: 'p2a', kind, ...extra });
const report = (kind: DieName['kind'], result: DieResult, rest: Partial<DieReport>, extra: Partial<DieName> = {}): DieReport =>
  ({ die: { name: name(kind, extra), result }, took: 'applied', ...rest });
const turnReport = (...forced: DieReport[]): DiceReport => ({ forced, naturalEndSeed: '1,2,3,4' });

describe('the text of a forced die', () => {
  test('a chance names its result and the chance the simulator used, as a percent', () => {
    expect(dieText(report('secondary', { happens: true }, { chance: 0.3 }, { effectId: 'flinch' }), words)).toBe('Forced: Air Slash flinch, 30 %');
    expect(dieText(report('accuracy', { happens: false }, { chance: 0.95 }), words)).toBe('Forced: Air Slash misses, 95 %');
    expect(dieText(report('crit', { happens: true }, { chance: 1 / 24 }), words)).toBe('Forced: Air Slash crit, 4.2 %');
    expect(dieText(report('secondary', { happens: true }, { chance: 0.6 }, { effectId: 'flinch' }), words)).toBe('Forced: Air Slash flinch, 60 %');
  });

  test('a die with no chance to name leaves the percent out', () => {
    expect(dieText(report('damage-roll', { step: 8 }, {}), words)).toBe('Forced: Air Slash damage roll 9');
    expect(dieText(report('hit-count', { hits: 3 }, {}), words)).toBe('Forced: Air Slash 3 hits');
    expect(dieText(report('speed-tie', { first: 'p2a' }, {}, { moveId: '', slot: 'p1a', targetSlot: 'p2a' }), words)).toBe('Forced: Speed tie, Snorlax first');
  });
});

describe('the lines of a turn', () => {
  test('a die that took effect gets one line, before the lines of its event', () => {
    const lines = dieLines(turnReport(report('accuracy', { happens: false }, { chance: 0.95, logIndex: 3 })), WINDOW, words);
    expect(lines).toEqual([{ at: 3, text: 'Forced: Air Slash misses, 95 %' }]);
  });

  test('the index of the battle\'s log counts the split lines the shown log does not have', () => {
    // index 6 is after the damage triple (three lines in the battle's log, one in the shown log)
    const lines = dieLines(turnReport(report('secondary', { happens: true }, { chance: 0.3, logIndex: 6 }, { effectId: 'flinch' })), WINDOW, words);
    expect(lines).toEqual([{ at: 4, text: 'Forced: Air Slash flinch, 30 %' }]);
  });

  test('a die that drew and had no effect adds a line at the end of its action, with the report\'s reason', () => {
    const lines = dieLines(turnReport(report('secondary', { happens: true }, { chance: 1, logIndex: 3, took: 'blocked', reason: 'the target already has a status' }, { effectId: 'brn' })), WINDOW, words);
    expect(lines).toEqual([
      { at: 3, text: 'Forced: Air Slash burn, 100 %' },
      { at: 4, text: 'Forced burn had no effect: the target already has a status' },
    ]);
  });

  test('a die the draw cannot answer gets the no-effect line alone: it decided nothing', () => {
    const lines = dieLines(turnReport(report('accuracy', { happens: false }, { chance: 1, logIndex: 3, took: 'no-chance', reason: 'the draw has no way to give this answer' })), WINDOW, words);
    expect(lines).toEqual([{ at: 4, text: 'Forced miss had no effect: the draw has no way to give this answer' }]);
  });

  test('a die the simulator never drew says so at the end of the turn, once the turn is complete', () => {
    const never = report('secondary', { happens: true }, { took: 'no-draw', reason: 'Air Slash drew no secondary this turn' }, { effectId: 'brn' });
    expect(dieLines(turnReport(never), WINDOW, words)).toEqual([{ at: 6, text: 'Forced burn had no effect: Air Slash drew no secondary this turn' }]);
    // a turn that paused for a switch has more to play: the die may still be drawn in the rest of it
    expect(dieLines(turnReport(never), { ...WINDOW, complete: false }, words)).toEqual([]);
  });

  test('a die drawn before this part of a paused turn has its lines from the part that drew it', () => {
    const earlier = report('accuracy', { happens: false }, { chance: 0.95, logIndex: 1 });
    expect(dieLines(turnReport(earlier), WINDOW, words)).toEqual([]);
  });

  test('a turn without a forced die has no line', () => {
    expect(dieLines(turnReport(), WINDOW, words)).toEqual([]);
  });
});

describe('the dice part of a history entry', () => {
  const never = report('secondary', { happens: true }, { took: 'no-draw', reason: 'Air Slash drew no secondary this turn' }, { effectId: 'brn' });
  const start = { battleStart: 2, shownStart: 2, words };
  const battle = { log: BATTLE_LOG } as never;
  // Round 82, step A7c: the entry carries the marks of its report (the history row and the share link read them)
  const marksOf = (report: DiceReport) => diceMarksOf(report, words);

  test('a turn with no forced die leaves the entry as it was', () => {
    expect(entryDice(undefined, start, battle, SHOWN_LOG, false)).toEqual({});
    expect(entryDice(turnReport(), start, battle, SHOWN_LOG, false)).toEqual({ diceReport: turnReport(), diceMarks: marksOf(turnReport()) });
  });

  test('a turn that waits for a replacement after its actions ended is complete: the end-of-turn faint comes after the last action', () => {
    expect(entryDice(turnReport(never), start, battle, SHOWN_LOG, true)).toEqual({
      diceReport: turnReport(never),
      diceMarks: marksOf(turnReport(never)),
      dieLines: [{ at: 6, text: 'Forced burn had no effect: Air Slash drew no secondary this turn' }],
    });
  });

  test('a turn that paused for a switch in the middle has more to play: a die not drawn yet stays quiet', () => {
    const midTurn = SHOWN_LOG.slice(0, 5);
    expect(entryDice(turnReport(never), start, battle, midTurn, true)).toEqual({ diceReport: turnReport(never), diceMarks: marksOf(turnReport(never)) });
    // once the rest of the turn is played the same die gets its line
    expect(entryDice(turnReport(never), start, battle, SHOWN_LOG, false)).toEqual({
      diceReport: turnReport(never),
      diceMarks: marksOf(turnReport(never)),
      dieLines: [{ at: 6, text: 'Forced burn had no effect: Air Slash drew no secondary this turn' }],
    });
  });
});

describe('the shown log with the lines in it', () => {
  const lines = [{ at: 3, text: 'Forced: Air Slash misses, 95 %' }, { at: 4, text: 'Forced burn had no effect' }, { at: 4, text: 'Forced crit had no effect' }];

  test('puts each line before the line at its index, keeping the order of lines with one index', () => {
    const shown = withDieLines(SHOWN_LOG, lines);
    expect(shown).toEqual([
      '|old', '|old two',
      '|move|p1a: Noivern|Air Slash|p2a: Snorlax',
      `${DIE_LINE}Forced: Air Slash misses, 95 %`,
      '|-damage|p2a: Snorlax|60/100',
      `${DIE_LINE}Forced burn had no effect`,
      `${DIE_LINE}Forced crit had no effect`,
      '|move|p2a: Snorlax|Splash|p2a: Snorlax',
      '|-activate|p2a: Snorlax|move: Splash',
      '|upkeep',
      '|turn|2',
    ]);
  });

  test('a line at the end of the log goes last', () => {
    expect(withDieLines(['|a', '|b'], [{ at: 2, text: 'Forced x' }])).toEqual(['|a', '|b', `${DIE_LINE}Forced x`]);
  });

  test('no lines leave the log as it is', () => {
    expect(withDieLines(SHOWN_LOG, [])).toBe(SHOWN_LOG);
  });

  test('the frame log keeps the lines (the replay client renders a message line) and still drops what the embed must not show', () => {
    const frame = branchFrameLog([...SHOWN_LOG, '|c|chat'], lines);
    expect(frame.split('\n')).toContain(`${DIE_LINE}Forced: Air Slash misses, 95 %`);
    expect(frame).not.toContain('|c|');
    expect(branchFrameLog(SHOWN_LOG)).toBe(SHOWN_LOG.join('\n'));
  });

  test('the line is a message line, which the replay client prints as it is', () => {
    expect(DIE_LINE).toBe('|-message|');
  });
});
