import { describe, expect, test } from 'vitest';
import { loadSimMods } from '../src/forward/sim-mods';
import { offeredDice } from '../src/dice/offer';
import { playTurn, reconstruct } from './arrival-turn';
import { clickWith } from './branch-dice-support';

// Round 82 (forced dice), step A7e: the draft league replay at turn 56 (the e2e of `test/e2e/branch.spec.ts`). The p2 lead (Ghost Shadow) holds Choice
// Specs there; the offer read its moves without the move in flight and the Choice item's `choicelock` threw "Battle.activeMove is
// null". The first turn of a branch asks the same offer for the log's dice (`loggedOptions`), so Execute failed with that message.
// `dice-held-sweep.spec.ts` holds the class (every item and ability that reads the move in flight, both game types).
await loadSimMods('gen9championsou');

describe('draft replay turn 56, a Choice item on the field', () => {
  test('offeredDice answers for every move of both bodies', { timeout: 300000 }, async () => {
    const { runtime } = await reconstruct('draft-replay', 56);
    const battle = runtime.battleStream.battle!;
    expect(battle.sides[1].active[0]!.item).toBe('choicespecs');
    for (const slot of ['p1a', 'p2a']) {
      const body = battle.sides[slot[1] === '1' ? 0 : 1].active[0]!;
      for (const move of body.getMoveRequestData().moves) {
        expect(() => offeredDice(battle, slot, { kind: 'move', moveId: move.id, moveName: move.id }), `${slot} ${move.id}`).not.toThrow();
      }
    }
  });

  test('the first turn executes: the join of the log asks the offer and plays the turn', { timeout: 300000 }, async () => {
    const { replay, runtime } = await reconstruct('draft-replay', 56);
    const played = await playTurn(runtime, replay.log, 56, { p1: 'move 1', p2: 'move 1' }, { p1: [clickWith('icebeam')], p2: [clickWith('dracometeor')] });
    // Ghost Shadow is faster and its Draco Meteor takes the p1 lead out first: the turn played, with the choice-locked move
    expect(played.lines.some(line => line.startsWith('|move|p2a: Ghost Shadow|Draco Meteor|'))).toBe(true);
  });
});
