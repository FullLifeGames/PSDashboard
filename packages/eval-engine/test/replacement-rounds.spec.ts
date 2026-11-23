import { describe, expect, test } from 'vitest';
import { replacementRounds } from '../src/replacement-rounds';
import { createRootPosition, legalChoices } from '../src/forward-model';
import { reconstructWithPoints } from './replacement-points';

/**
 * Round 79 (T290): the protocol's request rounds on scripted logs: singles, doubles with one and two slots, both sides at once,
 * a replacement that falls to an entry hazard, and the lines that are no replacement (a pivot, the last body of a side).
 */

const log = (...lines: string[]) => lines.join('\n');

describe('replacementRounds', () => {
  test('singles: a faint and the switch that answers it is one round of the block\'s turn', () => {
    const rounds = replacementRounds(log(
      '|turn|3', '|move|p1a: A|Tackle|p2a: B', '|faint|p2a: B', '|', '|upkeep', '|switch|p2a: C|Toxapex, F|100/100', '|turn|4',
    ));
    expect(rounds).toEqual([{ turn: 3, ordinal: 0, slots: { p1: [], p2: [0] }, species: { p1: [], p2: ['Toxapex'] } }]);
  });

  test('doubles: two fainted slots of a side are one round with two slots, one slot of two is one slot', () => {
    const two = replacementRounds(log(
      '|turn|5', '|faint|p1a: A', '|faint|p1b: B', '|upkeep', '|switch|p1b: D|Rotom-Wash|100/100', '|switch|p1a: C|Garchomp, M|100/100', '|turn|6',
    ));
    expect(two).toHaveLength(1);
    expect(two[0].slots).toEqual({ p1: [0, 1], p2: [] });
    expect(two[0].species.p1).toEqual(['Rotom-Wash', 'Garchomp']);
    const one = replacementRounds(log('|turn|5', '|faint|p2b: B', '|upkeep', '|switch|p2b: D|Ting-Lu|100/100', '|turn|6'));
    expect(one[0].slots).toEqual({ p1: [], p2: [1] });
  });

  test('both sides at once share one round', () => {
    const rounds = replacementRounds(log(
      '|turn|2', '|faint|p1a: A', '|faint|p2a: B', '|upkeep', '|switch|p1a: C|Corviknight|100/100', '|switch|p2a: D|Clefable|100/100', '|turn|3',
    ));
    expect(rounds).toHaveLength(1);
    expect(rounds[0].slots).toEqual({ p1: [0], p2: [0] });
  });

  test('a replacement that faints on entry opens the next round of the block', () => {
    const rounds = replacementRounds(log(
      '|turn|8', '|faint|p1a: A', '|upkeep', '|switch|p1a: B|Charizard|100/100', '|-damage|p1a: B|0 fnt|[from] Stealth Rock', '|faint|p1a: B',
      '|', '|switch|p1a: C|Magnezone|100/100', '|turn|9',
    ));
    expect(rounds.map(round => [round.turn, round.ordinal, round.species.p1])).toEqual([[8, 0, ['Charizard']], [8, 1, ['Magnezone']]]);
  });

  test('the second round waits for the other side\'s answer of the first', () => {
    const rounds = replacementRounds(log(
      '|turn|8', '|faint|p1a: A', '|faint|p2a: X', '|upkeep',
      '|switch|p1a: B|Charizard|100/100', '|faint|p1a: B', '|switch|p2a: Y|Toxapex|100/100', '|switch|p1a: C|Magnezone|100/100', '|turn|9',
    ));
    expect(rounds.map(round => [round.ordinal, round.slots.p1, round.slots.p2])).toEqual([[0, [0], [0]], [1, [0], []]]);
  });

  test('a pivot\'s switch, a plain switch and the last body of a side are no round', () => {
    expect(replacementRounds(log(
      '|turn|4', '|switch|p1a: B|Rotom|100/100', '|move|p2a: C|U-turn|p1a: B', '|switch|p2a: D|Zapdos|100/100|[from] U-turn', '|turn|5',
    ))).toEqual([]);
    expect(replacementRounds(log('|turn|9', '|faint|p2a: X', '|win|P1'))).toEqual([]);
    // A faint left over from the block before does not answer the next block's plain switch.
    expect(replacementRounds(log('|turn|9', '|faint|p2a: X', '|turn|10', '|switch|p2a: Y|Zapdos|100/100'))).toEqual([]);
  });

  test('carriage returns do not change the reading', () => {
    const lines = ['|turn|3', '|faint|p2a: B', '|upkeep', '|switch|p2a: C|Toxapex, F|100/100', '|turn|4'];
    expect(replacementRounds(lines.join('\r\n'))).toEqual(replacementRounds(lines.join('\n')));
  });
});

describe('onReplacement: the hook at the open request', () => {
  test('doubles: every point is an open request, read twice with the same bytes', { timeout: 240000 }, async () => {
    const run = await reconstructWithPoints('gen9doublesou-2694811367');
    const rounds = replacementRounds(run.replay.log);
    expect(rounds.length).toBeGreaterThan(0);
    expect(run.points.length).toBeGreaterThan(0);
    for (const { point, serialized, serializedAgain } of run.points) {
      // Read-only: reading it twice gives the same bytes, and the request is still open when the hook fires.
      expect(serializedAgain).toBe(serialized);
      // The serialized battle is the open request: a side with forced slots lists switches, a waiting side the wait sentinel.
      const root = createRootPosition(serialized);
      for (const side of ['p1', 'p2'] as const) {
        const choices = legalChoices(root, side).map(option => option.choice);
        if (point.forced[side].length === 0) expect(choices).toEqual(['wait']);
        else expect(choices.every(choice => choice.split(', ').some(part => part.startsWith('switch') || part === 'pass'))).toBe(true);
      }
    }
  });

  test('singles: the point names the knockout turn, the slot and the species the replay sent in', { timeout: 240000 }, async () => {
    const run = await reconstructWithPoints('gen9ou-2658662321');
    const rounds = replacementRounds(run.replay.log);
    expect(rounds.length).toBeGreaterThan(0);
    const first = run.points[0].point;
    expect(first.turn).toBe(rounds[0].turn);
    expect(first.ordinal).toBe(0);
    const side = first.forced.p1.length > 0 ? 'p1' : 'p2';
    expect(first.forced[side]).toEqual([0]);
    expect(first.played[side]).toEqual(rounds[0].species[side]);
  });

  // The scenes test/e2e/replacement-note.spec.ts reads on the cards of the turns after them.
  test('the e2e scenes: Toxapex on turn 6 of the OU game, Flamigo and Sylveon together on turn 2 of the doubles game', { timeout: 480000 }, async () => {
    const singles = await reconstructWithPoints('gen9ou-2658662321');
    const species = singles.points.map(({ point }) => [point.turn, point.ordinal, ...point.played.p1, ...point.played.p2]);
    expect(species).toEqual([[6, 0, 'Toxapex'], [11, 0, 'Walking Wake']]);
    const doubles = await reconstructWithPoints('gen9doublesou-2694811367');
    const first = doubles.points[0].point;
    expect([first.turn, first.forced.p2, first.played.p2]).toEqual([2, [0, 1], ['Flamigo', 'Sylveon']]);
  });

  test('a knockout the simulator does not reproduce is a gap with its cause in the alignment: the default e2e replay', { timeout: 240000 }, async () => {
    const run = await reconstructWithPoints('replay');
    expect(run.points).toEqual([]);
    expect(run.runtime.haxAlignment.find(entry => entry.turn === 3)?.actual.faintMismatches).toBeGreaterThan(0);
  });

  test.each(['gen9doublesou-2694811367', 'gen9ou-2658662321'])('%s: the hook changes no position', { timeout: 480000 }, async fixture => {
    const withHook = await reconstructWithPoints(fixture);
    const without = await reconstructWithPoints(fixture, { hook: false });
    expect(withHook.points.length).toBeGreaterThan(0);
    expect(without.points.length).toBe(0);
    expect([...withHook.positions.keys()]).toEqual([...without.positions.keys()]);
    for (const [turn, serialized] of without.positions) expect(withHook.positions.get(turn)).toBe(serialized);
    expect(withHook.final).toBe(without.final);
    expect(withHook.runtime.log).toEqual(without.runtime.log);
  });
});
