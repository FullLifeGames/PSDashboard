import { describe, expect, test } from 'vitest';
import { buildGameReport } from '../src/report';
import { buildScene, GAMES, READERS, type Scene } from './read-against-click-builder';

/**
 * Round 89 (user ruling B6a): a read counts as paid off only when the played line beat the safe line in the opponent's clicked
 * column, a fair comparison of two cells of one matrix. Before, the payoff was held against the safe line's worst case, a floor
 * that no reply need reach. The scenes are the corpus turns that moved: 648453 t8 (a gamble, cells 0.189 and 0.190), 2663093831
 * t8 (a mistake whose payoff came three turns later, 0.072 against 0.327) and t6 (an inaccuracy risk, 0.325 against 0.454).
 * Singles and doubles share the rule, and either side can be the reader.
 */

const scene = (overrides: Partial<Scene> & Pick<Scene, 'kind' | 'playedCell' | 'safeCell'>, reader: Scene['reader']): Scene => ({ reader, ...overrides });

describe.each(GAMES)('%s', (_game, make) => {
  describe.each(READERS)('read by %s', reader => {
    const build = (overrides: Partial<Scene> & Pick<Scene, 'kind' | 'playedCell' | 'safeCell'>) => buildScene(make, scene(overrides, reader));
    const other = reader === 'p1' ? 'p2' : 'p1';

    test('a gamble whose played cell trails the safe cell by a point is no read (648453 t8; red before: riskPaidOff true, p2-read)', () => {
      const { analysis } = build({ kind: 'gamble', playedCell: 0.189, safeCell: 0.19 });
      const side = analysis[reader];
      expect(side.riskPayoff).toBeGreaterThanOrEqual(0.08);
      expect(side.riskPaidOff).toBeUndefined();
      expect(side.safeAgainstClick).toEqual({ against: analysis[other].played!.label, playedValue: 0.189, safeValue: 0.19 });
      expect(analysis.attribution).toBe('quiet');
    });

    test('a gamble whose played cell beats the safe cell is a read and carries both cells', () => {
      const { analysis } = build({ kind: 'gamble', playedCell: 0.3, safeCell: 0.19 });
      const side = analysis[reader];
      expect(side.riskPaidOff).toBe(true);
      expect(side.safeAgainstClick).toEqual({ against: analysis[other].played!.label, playedValue: 0.3, safeValue: 0.19 });
      expect(analysis.attribution).toBe(`${reader}-read`);
    });

    test('a mistake paid three turns later against a safe cell that read better is the reader\'s decision (2663093831 t8)', () => {
      const { analysis } = build({ kind: 'mistake', playedCell: 0.072, safeCell: 0.327, window: true });
      const side = analysis[reader];
      expect(side.tier).toBe('mistake');
      expect(side.riskPayoffTurn).toBe(2);
      expect(side.riskPaidOff).toBeUndefined();
      expect(side.riskUnpunished).toBe(true);
      expect(side.safeAgainstClick).toEqual({ against: analysis[other].played!.label, playedValue: 0.072, safeValue: 0.327 });
      expect(analysis.attribution).toBe(`${reader}-decision`);
    });

    test('that mistake lists as a misplay with riskUnpunished, no read, and its regret in the decision total', () => {
      const { analysis, names } = build({ kind: 'mistake', playedCell: 0.072, safeCell: 0.327, window: true });
      const report = buildGameReport([analysis], names, null);
      expect(report.reads.filter(read => read.side === reader)).toEqual([]);
      const misplays = report.misplays.filter(misplay => misplay.side === reader);
      expect(misplays).toHaveLength(1);
      expect(misplays[0]).toMatchObject({ turn: 8, side: reader, riskUnpunished: true });
      expect(report.decisionTotals[reader]).toBeCloseTo(analysis[reader].regret!, 9);
    });

    test('the same mistake with a played cell that beats the safe cell stays a read and an excused regret', () => {
      const { analysis, names } = build({ kind: 'mistake', playedCell: 0.4, safeCell: 0.327, window: true });
      expect(analysis[reader].riskPaidOff).toBe(true);
      expect(analysis.attribution).toBe(`${reader}-read`);
      const report = buildGameReport([analysis], names, null);
      expect(report.reads.filter(read => read.side === reader)).toHaveLength(1);
      expect(report.decisionTotals[reader]).toBe(0);
    });

    test('an inaccuracy risk against a safe cell that read better earns no credit and shows no read (2663093831 t6)', () => {
      const { analysis } = build({ kind: 'inaccuracy', playedCell: 0.325, safeCell: 0.454 });
      const side = analysis[reader];
      expect(side.tier).toBe('inaccuracy');
      expect(side.riskPaidOff).toBeUndefined();
      expect(side.riskUnpunished).toBeUndefined();
      expect(side.safeAgainstClick).toMatchObject({ playedValue: 0.325, safeValue: 0.454 });
      expect(analysis.attribution).toBe('quiet');
    });

    test('an inaccuracy risk that beat the safe cell keeps its credit', () => {
      const { analysis } = build({ kind: 'inaccuracy', playedCell: 0.454, safeCell: 0.325 });
      expect(analysis[reader].riskPaidOff).toBe(true);
      expect(analysis.attribution).toBe(`${reader}-read`);
    });

    test('a gap of 0.005 fails and a gap of 0.01 passes', () => {
      expect(build({ kind: 'gamble', playedCell: 0.205, safeCell: 0.2 }).analysis[reader].riskPaidOff).toBeUndefined();
      expect(build({ kind: 'gamble', playedCell: 0.21, safeCell: 0.2 }).analysis[reader].riskPaidOff).toBe(true);
      expect(build({ kind: 'gamble', playedCell: 0.2, safeCell: 0.2 }).analysis[reader].riskPaidOff).toBeUndefined();
    });

    test('a side that lost ground with a failing read keeps no credit either (2663093831 t1)', () => {
      const { analysis } = build({ kind: 'inaccuracy', playedCell: 0.325, safeCell: 0.454, lostGround: 0.15 });
      expect(analysis[reader].riskPaidOff).toBeUndefined();
      expect(analysis[reader].safeAgainstClick).toBeDefined();
      expect(analysis.attribution).not.toBe(`${reader}-read`);
    });

    test('fail open: a result without a matrix keeps today\'s rule and writes no field', () => {
      const { analysis } = build({ kind: 'gamble', playedCell: 0.189, safeCell: 0.19, noMatrix: true });
      expect(analysis[reader].riskPaidOff).toBe(true);
      expect(analysis[reader].safeAgainstClick).toBeUndefined();
      expect(analysis.attribution).toBe(`${reader}-read`);
    });
  });
});

describe('doubles: a hidden slot of the opponent\'s click', () => {
  const doubles = GAMES[1][1];
  test.each(READERS)('read by %s: no clicked column, so today\'s credit stays and no field is written', reader => {
    const { analysis } = buildScene(doubles, { kind: 'gamble', reader, playedCell: 0.189, safeCell: 0.19, hiddenClick: true });
    expect(analysis[reader].riskPaidOff).toBe(true);
    expect(analysis[reader].safeAgainstClick).toBeUndefined();
  });
});
