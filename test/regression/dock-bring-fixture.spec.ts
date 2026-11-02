import { beforeAll, describe, expect, test } from 'vitest';
import { parseReplayLog, replayBringOnly } from '@fulllifegames/replay-core';
import { loadSimMods } from '@fulllifegames/eval-engine';
import { dockReplays } from '../e2e/helpers';
import { loggedTurn } from '../e2e/dock-helpers';

/**
 * Round 84 (turn dock), step A6d: the Champions VGC scene that proves a bring-limited bench. `replayBringOnly` pins the bring
 * lists only when BOTH sides fielded all four bodies during the game, and returns null otherwise (by design, for the evaluation:
 * a pinned four against an open six overrates the open side). The first Champions fixture (2625939941) is such a game: the user's
 * side fielded three, so its bench lists the whole team. The second one (2623421463) pins both sides, so the bench of P2A lists the
 * two brought bodies and leaves the two that stayed home out.
 */
const byId = (id: string) => dockReplays.find(replay => replay.id === id)!;
const OPEN = byId('gen9championsvgc2026regma-2625939941');
const PINNED = byId('gen9championsvgc2026regma-2623421463');

beforeAll(async () => {
  await loadSimMods('gen9championsou');
});

describe('the Champions VGC fixtures and the bring lists', () => {
  test('the first fixture is not pinned: the user\'s side fielded three bodies only', () => {
    expect(replayBringOnly(OPEN, parseReplayLog(OPEN.log))).toBeNull();
  });

  test('the second fixture pins both sides to the four bodies they fielded', () => {
    const pinned = replayBringOnly(PINNED, parseReplayLog(PINNED.log));
    expect(pinned).not.toBeNull();
    expect([...pinned!.p2].sort()).toEqual(['Basculegion', 'Blastoise', 'Pelipper', 'Vivillon-Pokeball']);
    expect(pinned!.p1).toHaveLength(4);
    // P2 has six bodies in the team preview; Sneasler and Sinistcha-Masterpiece stay home, so a bench that lists them is wrong.
    const team = [...PINNED.log.matchAll(/^\|poke\|p2\|([^,|]+)/gm)].map(match => match[1]);
    expect(team).toHaveLength(6);
    expect(team.filter(name => !pinned!.p2.includes(name)).sort()).toEqual(['Sinistcha-Masterpiece', 'Sneasler']);
  });

  test('turn 1 of the second fixture: every slot moved, nobody used a gimmick, and Blastoise (P2A) Mega Evolves in turn 2', () => {
    const turn1 = loggedTurn(PINNED, 1);
    expect(turn1.map(action => action.slot).sort()).toEqual(['p1a', 'p1b', 'p2a', 'p2b']);
    expect(turn1.every(action => action.kind === 'move' && !action.tera && !action.mega)).toBe(true);
    expect(turn1.find(action => action.slot === 'p2a')).toMatchObject({ name: 'Protect' });
    expect(loggedTurn(PINNED, 2).filter(action => action.mega).map(action => action.slot)).toEqual(['p2a']);
  });
});
