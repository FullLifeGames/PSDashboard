import { describe, expect, test } from 'vitest';
import type { Battle } from '@pkmn/sim';
import { SENDERS } from '../src/inference/item-triggers';
import { ALL_VIEWS, battleIn, mon, oracleTagAbove, type SimView } from './sim-views';

/**
 * Round 72 (T235), plan row 18: `SENDERS` in inference/item-triggers.ts names the items whose `|-enditem|` line means the item sent
 * a Pokémon out of the field (it spent the switch the other triggers would need, so the watch doubts the window). The Dex has six
 * items with an `onAfterMoveSecondary` or `onAfterBoost` handler (Adrenaline Orb, Eject Button, Eject Pack, Kee Berry, Maranga
 * Berry, Red Card); the handler does not say it switches, so this spec plays each one in every view the corpus plays: a damaging
 * hit (Tackle) and a stat drop (Growl) on a holder with a Pokémon on the bench (three on a side, so doubles has one too), and keeps the items after whose use a Pokémon
 * left or waits to leave the field (the holder's `switchFlag`, or the attacker dragged out by `|drag|`). They are the list.
 */

const SPEC = 'packages/replay-core/test/senders-oracle.spec.ts';

const HANDLERS = ['onAfterMoveSecondary', 'onAfterBoost'];

const realItems = (view: SimView) => view.dex.items.all().filter(item => item.exists && item.isNonstandard !== 'Future');

/** Whether the item, held by the foe of a Tackle or Growl user, ended with a switch pending or a drag. */
function sends(view: SimView, item: string, move: string, filler: string): boolean {
  const battle: Battle = battleIn(view,
    [mon('Machamp', [move, filler]), mon('Blissey', [filler]), mon('Blissey', [filler])],
    [mon('Snorlax', [filler], { item }), mon('Blissey', [filler]), mon('Blissey', [filler])]);
  battle.choose('p1', view.doubles ? `move 1${move === 'tackle' ? ' 1' : ''}, move 1` : 'move 1');
  battle.choose('p2', view.doubles ? 'move 1, move 1' : 'move 1');
  const consumed = battle.log.some(line => /^\|-enditem\|p2a/.test(line));
  const dragged = battle.log.some(line => /^\|drag\|p1/.test(line));
  const waiting = battle.sides.some(side => side.active.some(pokemon => pokemon?.switchFlag));
  return consumed && (dragged || waiting);
}

describe('SENDERS is held to the simulator (round 72)', () => {
  test('the list carries its oracle tag', () => {
    expect(oracleTagAbove('packages/replay-core/src/inference/item-triggers.ts', 'const SENDERS', SPEC)).toBe(true);
  });

  describe.each(ALL_VIEWS)('$name', view => {
    test('the items that send a Pokémon out are the listed ones', () => {
      const candidates = realItems(view)
        .filter(item => HANDLERS.some(handler => (item as unknown as Record<string, unknown>)[handler]))
        .map(item => item.id);
      if (view.dex.gen >= 5) expect(candidates.length).toBeGreaterThan(0);
      const filler = view.dex.moves.get('splash').exists ? 'splash' : 'harden';
      const senders = candidates.filter(id => ['tackle', 'growl'].some(move => sends(view, id, move, filler))).sort();
      expect(senders).toEqual([...SENDERS].filter(id => candidates.includes(id)).sort());
    });
  });
});
