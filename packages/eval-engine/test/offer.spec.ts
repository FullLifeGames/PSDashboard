import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { ReplayData } from '@fulllifegames/replay-core';
import { executeBranchChoices } from '../src/branch-engine';
import { offeredOrderDice, offeredDice } from '../src/dice/offer';
import { clickWith } from './branch-dice-support';
import { reconstruct, playTurn } from './arrival-turn';
import { loadSimMods } from '../src/forward/sim-mods';

/**
 * Round 82, the user's test of 01.11.2026: gen9draft-2058494320, a branch on turn 1 in Advanced, U-turn against Chilly
 * Reception. The turn waits for P1's switch after U-turn, and the panel still asks for the turn's dice with both picks, on a
 * copy of the live battle. The copy refuses the move ("Can't move: You need a switch response"); the copy had kept the live
 * battle's `send`, so the refusal reached the live error log while Execute waited for the turn, and the turn read as refused.
 */
const replay = JSON.parse(readFileSync(new URL('../../../test/e2e/fixtures/draft-replay.json', import.meta.url), 'utf-8')) as ReplayData;
const settle = () => new Promise(resolve => setTimeout(resolve, 50));

describe('the panel asks on copies and never writes the live stream', () => {
  test('U-turn against Chilly Reception: the order question on the paused turn leaves the live log and error log as they were', { timeout: 120000 }, async () => {
    const { runtime } = await reconstruct('gen9draft-2058494320', 1, replay);
    const live = runtime.battleStream.battle!;
    const moves = (side: 0 | 1) => live.sides[side].active[0]!.getMoveRequestData().moves.map(move => move.id);
    const commands = [
      { side: 'p1' as const, command: `move ${moves(0).indexOf('uturn') + 1}` },
      { side: 'p2' as const, command: `move ${moves(1).indexOf('chillyreception') + 1}` },
    ];
    const played = await executeBranchChoices({
      streams: runtime.streams, log: runtime.log, choiceErrors: runtime.choiceErrors, commands,
      dice: { battle: live, p1Choices: [clickWith('uturn')], p2Choices: [clickWith('chillyreception')] },
    });
    expect(played.ok).toBe(true);
    expect(live.sides.map(side => side.requestState)).toEqual(['switch', '']);
    await settle();
    const errors = runtime.choiceErrors.count;
    const lines = runtime.log.length;
    // the panel's question with the picks of the turn that already ran: the copy refuses U-turn, since P1 owes a switch
    try {
      offeredOrderDice(live, battle => { for (const { side, command } of commands) battle.choose(side, command); });
    } catch {
      // a refused click ends the copy's play, as the panel's own play does
    }
    await settle();
    expect(runtime.choiceErrors.count).toBe(errors);
    expect(runtime.log.length).toBe(lines);
  });
});

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
