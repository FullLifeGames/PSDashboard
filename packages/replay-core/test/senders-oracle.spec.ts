import { describe, expect, test } from 'vitest';
import type { Battle } from '@pkmn/sim';
import { SENDERS } from '../src/inference/item-triggers';
import { ALL_VIEWS, battleIn, mon, type SimView } from './sim-views';

const HANDLERS = ['onAfterMoveSecondary', 'onAfterBoost'];

const realItems = (view: SimView) => view.dex.items.all().filter(item => item.exists && item.isNonstandard !== 'Future');

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

describe('SENDERS is held to the simulator', () => {
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
