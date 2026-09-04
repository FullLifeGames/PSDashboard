import { test, expect } from '@playwright/test';
import { ENDGAME_FIXTURES } from './endgame-fixtures';
import { endgameScope } from '../packages/eval-engine/src/endgame/solver';

test.describe('synthetic endgames (round 34)', () => {
  test('every fixture builds a live battle inside the solver scope with a unique name', () => {
    const names = new Set<string>();
    for (const fixture of ENDGAME_FIXTURES) {
      expect(names.has(fixture.name), fixture.name).toBe(false);
      names.add(fixture.name);
      const battle = fixture.build();
      expect(battle.ended, fixture.name).toBe(false);
      expect(battle.gameType, fixture.name).toBe(fixture.gameType);
      expect(endgameScope(battle), fixture.name).toBe(true);
    }
    expect(ENDGAME_FIXTURES.filter(f => f.gameType === 'doubles').length).toBeGreaterThanOrEqual(6);
    expect(ENDGAME_FIXTURES.length).toBeGreaterThanOrEqual(24);
  });
});
