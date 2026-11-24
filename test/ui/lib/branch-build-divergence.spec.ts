import { describe, expect, test } from 'vitest';
import { divergenceNoticeFor } from '../../../src/lib/branch-build';

describe('divergenceNoticeFor', () => {
  const ended = { ended: true, winner: 'Alice', turn: 9 };

  test('a rebuild with no variation turns that ended is a divergence', () => {
    expect(divergenceNoticeFor(ended, 7)).toMatch(/already ended \(Alice won the simulated line\)/);
    expect(divergenceNoticeFor(ended, 7, 0)).toMatch(/already ended/);
  });

  test('a variation that ended the game by itself raises no notice', () => {
    expect(divergenceNoticeFor(ended, 7, 3)).toBeNull();
    expect(divergenceNoticeFor({ ended: true, winner: null, turn: 8 }, 7, 1)).toBeNull();
  });

  test('a rebuild that wedged before the branch turn keeps its notice, a live battle at the turn has none', () => {
    expect(divergenceNoticeFor({ ended: false, turn: 5 }, 7)).toMatch(/wedged at turn 5 on the way to turn 7/);
    expect(divergenceNoticeFor({ ended: false, turn: 7 }, 7, 2)).toBeNull();
    expect(divergenceNoticeFor(null, 7)).toBeNull();
  });
});
