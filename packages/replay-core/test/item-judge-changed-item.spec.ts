import { describe, expect, test } from 'vitest';
import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import { judgeable } from '../src/team/item-damage-shared';

/**
 * Round 73 (T210, group 5): the item judge's hit walk (inference/hits.ts) read a Pokémon's item at the damage line. A weakening
 * berry or a gem ends inside the move, before the damage line, so the client showed no item and a used-up mark and the judge
 * skipped the hit, although the hit counted the item. The walk now reads the item before the first `-enditem` of the move (the
 * idiom of protocol/item-reading.ts), so the hit records the item it counted. An item taken before the move (Knock Off) is still a
 * changed item, and the hit stays skipped. Real simulator battles, singles and doubles.
 */

type Format = 'singles' | 'doubles';

const mon = (species: string, item: string, ability: string, moves: string[]): PokemonSet => ({
  name: species, species, item, ability, moves, nature: 'Hardy', gender: '', level: 100,
  evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
});

function play(format: Format, p1: PokemonSet[], p2: PokemonSet[], turns: [string, string][]): string {
  const doubles = format === 'doubles';
  const battle = new Battle({
    formatid: toID(`gen9${doubles ? 'doubles' : ''}customgame`) as never, seed: [1, 2, 3, 4],
    p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) },
  });
  battle.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
  battle.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
  for (const [first, second] of turns) {
    expect(battle.choose('p1', first)).toBe(true);
    expect(battle.choose('p2', second)).toBe(true);
  }
  const lines = battle.log;
  return lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
}

const hitsOf = (log: string, species: string) => inferOpponentTeam(log, 'p2').pokemon.find(entry => entry.species === species)!.hits ?? [];
const idle = (doubles: boolean) => (doubles ? 'move splash, move splash' : 'move splash');
const strike = (doubles: boolean, move: string) => (doubles ? `move ${move} 1, move splash` : `move ${move}`);

describe('an item that ends inside the move is the item the hit counted (T210 group 5)', () => {
  for (const format of ['singles', 'doubles'] as const) {
    const doubles = format === 'doubles';
    const partner = [mon('Chansey', '', 'Natural Cure', ['Splash'])];

    test(`${format}: a Chilan Berry halves a Normal hit and the hit records the berry on the defender`, () => {
      const log = play(format, [mon('Blissey', 'Chilan Berry', 'Natural Cure', ['Splash']), ...(doubles ? partner : [])], [mon('Snorlax', '', 'Immunity', ['Body Slam', 'Splash']), ...(doubles ? partner : [])], [[idle(doubles), strike(doubles, 'bodyslam')]]);
      expect(log).toMatch(/\|-enditem\|p1a: Blissey\|Chilan Berry\|\[weaken\]/);
      const [only] = hitsOf(log, 'Snorlax');
      expect(only).toBeDefined();
      expect(only.defender).toMatchObject({ held: 'chilanberry', itemChanged: false });
    });

    test(`${format}: a gem ends inside the move and the hit records it on the attacker, which the judge can use`, () => {
      const log = play(format, [mon('Blissey', '', 'Natural Cure', ['Splash']), ...(doubles ? partner : [])], [mon('Snorlax', 'Normal Gem', 'Immunity', ['Body Slam', 'Splash']), ...(doubles ? partner : [])], [[idle(doubles), strike(doubles, 'bodyslam')]]);
      expect(log).toMatch(/\|-enditem\|p2a: Snorlax\|Normal Gem\|\[from\] gem/);
      const [only] = hitsOf(log, 'Snorlax');
      expect(only.attacker).toMatchObject({ held: 'normalgem', itemChanged: false });
      expect(only.attacker.itemChanged).toBe(false);
      expect(typeof judgeable(only)).toBe('boolean');
    });

    test(`${format}: an item knocked off before the move stays a changed item`, () => {
      const log = play(format, [mon('Blissey', '', 'Natural Cure', ['Knock Off', 'Splash']), ...(doubles ? partner : [])], [mon('Snorlax', 'Leftovers', 'Immunity', ['Body Slam', 'Splash']), ...(doubles ? partner : [])],
        [[strike(doubles, 'knockoff'), idle(doubles)], [idle(doubles), strike(doubles, 'bodyslam')]]);
      const hits = hitsOf(log, 'Snorlax');
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.at(-1)!.attacker.itemChanged).toBe(true);
    });
  }
});
