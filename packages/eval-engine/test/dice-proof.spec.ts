import { describe, expect, test } from 'vitest';
import { loadSimMods } from '../src/forward/sim-mods';
import { learnHitCount } from '../src/dice/learn';
import { offeredDice, offeredOrderDice } from '../src/dice/offer';
import { naturalTurn } from '../src/dice/play';
import { readsStartRoll } from '../src/dice/start-roll';
import { probeCheck } from '../src/dice/status-probe';
import type { ForcedDie } from '../src/dice/types';
import { playClicks, standing, type Mode } from './dice-fixtures';
import { moverBoard, moverClicks, moversOf, tieBoard, tieClicks } from './dice-order-support';
import { CHECKS } from './dice-status-support';
import { dexOfRules, SWEEP_CASES, sweepBoard, sweepClicks } from './dice-sweep-support';

// Round 82 (forced dice), step A4: AGENTS.md asks that a stand-in which calls a Dex handler proves the live battle unchanged. Five
// functions of the module ask the simulator a question on a copy of the battle: `offeredDice` (the move's own `ModifyMove` and the
// `ModifySecondaries` event), `probeCheck` (a condition's `BeforeMove` handler), `offeredOrderDice` (the natural turn), `readsStartRoll`
// (the action speed with the roll flipped) and `learnHitCount` (forced turns on copies). Each row reads the `standing` of the battle
// (`fingerprint` over every body, plus the turn, the roll, the queue and the move in flight) before and after the question, in every
// rule set and game type, for each kind of question.
await loadSimMods('gen9championsou');

const NEEDS_AIM = new Set(['normal', 'any', 'adjacentFoe']);
const choiceOf = (moveId: string, target: string, mode: Mode) => ({
  kind: 'move' as const, moveId, moveName: moveId, ...(mode === 'doubles' && NEEDS_AIM.has(target) ? { targetLoc: 1 } : {}),
});

/** A plain hit, a spread move, a move with a secondary, a multi-hit move: one of each kind of die the offer reads before the move runs. */
const OFFER_MOVES = ['tackle', 'rockslide', 'thunderbolt', 'furyattack'];

describe.each(SWEEP_CASES)('the questions leave the battle as it was: $name', ({ rules, mode }) => {
  const dex = dexOfRules(rules);

  test.each(OFFER_MOVES)('offeredDice for %s', moveId => {
    const move = dex.moves.get(moveId);
    if (!move.exists || move.gen > dex.gen) return;
    const board = sweepBoard(rules, moveId, mode);
    const before = standing(board);
    const offers = offeredDice(board, 'p1a', choiceOf(moveId, move.target, mode));
    expect(offers.length, `${moveId} offers dice`).toBeGreaterThan(0);
    expect(standing(board)).toBe(before);
  });

  describe.each(CHECKS.filter(check => rules.generation >= check.from).map(check => [check.id, check] as const))('the check %s', (_id, check) => {
    test('probeCheck and the offer', () => {
      const board = sweepBoard(rules, 'tackle', mode);
      check.start(board);
      const before = standing(board);
      const probe = probeCheck(board, 'p1a', check.id, 'tackle');
      expect(probe, 'the check draws a chance').not.toBeNull();
      expect(standing(board), 'after probeCheck').toBe(before);
      const offers = offeredDice(board, 'p1a', choiceOf('tackle', 'normal', mode));
      expect(offers.some(offer => offer.name.kind === 'status-check'), 'the check is offered').toBe(true);
      expect(standing(board), 'after the offer').toBe(before);
    });
  });

  test('offeredOrderDice on a tied board', () => {
    const board = tieBoard(rules, mode, '1,2,3,4');
    const before = standing(board);
    const offers = offeredOrderDice(board, battle => playClicks(battle, tieClicks(mode)));
    expect(offers.some(offer => offer.name.kind === 'speed-tie'), 'a tie is offered').toBe(true);
    expect(standing(board)).toBe(before);
  });

  test.each([...moversOf(rules).map(mover => [mover.id, mover] as const), ['nobody', null] as const])('readsStartRoll and the first-mover offer with %s', (_id, mover) => {
    const board = moverBoard(rules, mode, mover, '1,2,3,4');
    const before = standing(board);
    readsStartRoll(board, 'p1a');
    expect(standing(board), 'after readsStartRoll').toBe(before);
    offeredOrderDice(board, battle => playClicks(battle, moverClicks(mode)));
    expect(standing(board), 'after the order offer').toBe(before);
  });

  test('learnHitCount plays on copies', () => {
    const move = dex.moves.get('furyattack');
    const board = sweepBoard(rules, 'furyattack', mode);
    const clicks = sweepClicks(mode, move.target);
    const play = (battle: Parameters<typeof playClicks>[0]) => playClicks(battle, clicks);
    const die: ForcedDie & { result: { hits: number } } = { name: { slot: 'p1a', moveId: 'furyattack', kind: 'hit-count' }, result: { hits: 4 } };
    // the accuracy is forced to hit, so the count is drawn whatever the seed gives
    const hit: ForcedDie = { name: { slot: 'p1a', moveId: 'furyattack', targetSlot: 'p2a', kind: 'accuracy' }, result: { happens: true } };
    const before = standing(board);
    const script = learnHitCount({ live: board, forced: [hit, die], record: naturalTurn(board, play).record, play, fork: prng => prng.clone(), die });
    expect(script, 'a count of four is reachable').not.toBeNull();
    expect(standing(board)).toBe(before);
  });
});
