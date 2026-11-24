import { describe, expect, test } from 'vitest';
import { ATTACKER_PUNISH_ITEMS } from '../src/inference/client-facts';
import { toId } from '../src/ids';
import { arg, fromEffect, readLine } from '../src/inference/log-line';
import { ALL_VIEWS, battleIn, mon, type SimView } from './sim-views';

// The Dex marks nine items with an onDamagingHit handler (Absorbent Bulb, Air Balloon, Cell Battery, Jaboca Berry, Luminous Moss, Rocky
// Helmet, Rowap Berry, Snowball, Weakness Policy) and the handler does not say whom it hurts. Each is played in every view the corpus
// plays (a contact move and a special move without contact, alone and with a partner in doubles); the `|-damage|` lines against the
// attacker with `[from] item:` name the items that punish, which is the list of ATTACKER_PUNISH_ITEMS (Rocky Helmet from Generation 5,
// the two berries from Generation 4, so Generations 1 to 3 have none).

const realItems = (view: SimView) => view.dex.items.all().filter(item => item.exists && item.isNonstandard !== 'Future');

function punishing(view: SimView, candidates: string[]): string[] {
  const found = new Set<string>();
  for (const id of candidates) {
    for (const move of ['tackle', 'swift']) {
      const battle = battleIn(view,
        [mon(move === 'tackle' ? 'Machamp' : 'Alakazam', [move, 'splash']), mon('Blissey', ['splash'])],
        [mon('Snorlax', ['splash'], { item: id }), mon('Snorlax', ['splash'])]);
      battle.choose('p1', view.doubles ? `move 1${move === 'tackle' ? ' 1' : ''}, move 1` : 'move 1');
      battle.choose('p2', view.doubles ? 'move 1, move 1' : 'move 1');
      for (const raw of battle.log) {
        const line = readLine(raw);
        if (line.cmd !== '-damage' || !arg(line, 1).startsWith('p1')) continue;
        const from = fromEffect(line);
        if (from.type === 'item' && toId(from.name) === id) found.add(id);
      }
    }
  }
  return [...found].sort();
}

describe('ATTACKER_PUNISH_ITEMS is held to the simulator (round 72)', () => {
  describe.each(ALL_VIEWS)('$name', view => {
    test('the items that hurt the attacker are the listed ones', () => {
      const candidates = realItems(view)
        .filter(item => (item as unknown as { onDamagingHit?: unknown }).onDamagingHit)
        .map(item => item.id);
      if (view.dex.gen >= 4) expect(candidates.length).toBeGreaterThan(0);
      const expected = [...ATTACKER_PUNISH_ITEMS].filter(id => realItems(view).some(item => item.id === id)).sort();
      expect(punishing(view, candidates)).toEqual(expected);
    });
  });
});
