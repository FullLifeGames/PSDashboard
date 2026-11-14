import { describe, expect, test } from 'vitest';
import { createRootPosition } from '../src/forward-model';
import { oneTurnMatrix, solveEndgame } from '../src/endgame/solver';
import { FirstChoice } from '../src/endgame/win-paths/first-choice';
import { WinMeter } from '../src/endgame/win-paths/budget';
import { mon, serializedBoard, type Board } from './win-paths-support';

/**
 * Round 89 (#130, D1): the engine's first choice past the root is the best row of the one-turn matrix. The matrix is the solver at one
 * turn (`solveEndgame` with `turns: 1`), so its value must equal the solver's; the first choice takes the damaging move over a Splash,
 * for both sides, singles and doubles, and a position is priced once.
 */
const SINGLES: Board = {
  format: 'gen9customgame',
  p1: [mon('Snorlax', ['Splash', 'Seismic Toss'])],
  p2: [mon('Pikachu', ['Splash', 'Seismic Toss'])],
};
const DOUBLES: Board = {
  format: 'gen9doublescustomgame',
  p1: [mon('Snorlax', ['Splash', 'Seismic Toss']), mon('Pidgeot', ['Splash'])],
  p2: [mon('Pikachu', ['Splash', 'Seismic Toss']), mon('Pidgeot', ['Splash'])],
};

describe.each([['singles', SINGLES], ['doubles', DOUBLES]] as const)('the first choice, %s', (name, board) => {
  test('the one-turn matrix has the value of the solver at one turn', async () => {
    const { serialized } = await serializedBoard(board);
    const matrix = oneTurnMatrix(createRootPosition(serialized, 'standard'))!;
    expect(matrix.cells).toBe(matrix.p1.length * matrix.p2.length);
    // the solver reads an endgame only (three bodies or fewer): the doubles board has four, so there the matrix stands on its own
    const solved = solveEndgame(serialized, { turns: 1 }, 'standard');
    if (solved.scope) expect(matrix.value).toBeCloseTo(solved.value, 9);
    else expect(Math.abs(matrix.value)).toBeLessThanOrEqual(1);
    expect(solved.scope).toBe(name === 'singles');
  }, 60_000);

  test('both sides take the damaging move, and a position is priced once', async () => {
    const { serialized } = await serializedBoard(board);
    const position = createRootPosition(serialized, 'standard');
    const meter = new WinMeter();
    const first = new FirstChoice(meter, { tera: false });
    const choice = first.at(position)!;
    expect(choice.p1.label).toContain('Seismic Toss');
    expect(choice.p2.label).toContain('Seismic Toss');
    const spent = meter.cells;
    expect(spent).toBeGreaterThan(0);
    expect(first.at(position)).toBe(choice);
    expect(meter.cells).toBe(spent);
    expect(choice.ranked.p1[0].option).toBe(choice.p1);
    expect(choice.ranked.p1[0].value).toBeGreaterThanOrEqual(choice.ranked.p1[1].value);
  }, 60_000);
});
