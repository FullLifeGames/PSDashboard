import { describe, expect, test } from 'vitest';
import { rulesDex } from '@fulllifegames/replay-core';
import { playedSetupMove, type SideAnalysis } from '../src/analysis';
import { setupMoveClicked } from '../src/turn-analysis/played-match';

/**
 * Setup-move detection (moved out of eval-analysis.spec.ts in round 75, T160). The setup moves are the Dex's of the game's
 * generation and mod (setupMoveClicked); the side record carries the one the side clicked (`setupMove`, set by analyzeTurn from
 * the board context), and playedSetupMove reads it. Singles and doubles shapes of the played actions.
 */
const side = (over: Partial<SideAnalysis>): SideAnalysis =>
  ({ playedRaw: null, played: null, best: null, regret: null, ...over });
const dex = rulesDex(9);

describe('setup-move detection', () => {
  test('singles: the played move is recognized by name', () => {
    expect(setupMoveClicked(side({ playedRaw: { kind: 'move', name: 'Swords Dance' } }), dex)).toBe('Swords Dance');
    expect(setupMoveClicked(side({ playedRaw: { kind: 'move', name: 'Ice Beam' } }), dex)).toBeNull();
    // A switch to a Pokémon nicknamed after a setup move is not a setup move.
    expect(setupMoveClicked(side({ playedRaw: { kind: 'switch', name: 'Curse' } }), dex)).toBeNull();
    expect(setupMoveClicked(side({}), dex)).toBeNull();
  });

  test('doubles: any slot clicking a setup move counts', () => {
    expect(setupMoveClicked(side({ playedSlots: [null, { kind: 'move', name: 'Dragon Dance' }] }), dex)).toBe('Dragon Dance');
    expect(setupMoveClicked(side({ playedSlots: [{ kind: 'move', name: 'Protect' }, { kind: 'move', name: 'Fake Out' }] }), dex)).toBeNull();
  });

  test('the record names the clicked setup move, and none without one', () => {
    expect(playedSetupMove(side({ setupMove: 'Swords Dance' }))).toBe('Swords Dance');
    expect(playedSetupMove(side({}))).toBeNull();
  });
});
