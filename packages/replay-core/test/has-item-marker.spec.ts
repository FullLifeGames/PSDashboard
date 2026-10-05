import { test, expect, describe } from 'vitest';
import { inferOpponentTeam } from '../src/opponent-inferrer';

/**
 * The team preview's "item" flag ("(has item)") says only that a Pokémon
 * holds something. An item the log then shows is a fact and must replace
 * the flag (round 63, lane G's finding at golden 655336 turn 5: Trick hands
 * Latias's Choice Scarf to Bisharp, the build gave Latias Colbur Berry and
 * Bisharp Black Glasses).
 */
const trickLog = [
  '|player|p1|Alice|', '|player|p2|Bob|', '|gen|6', '|tier|[Gen 6] OU',
  '|poke|p1|Bisharp, F|item', '|poke|p1|Clefable, F|item', '|poke|p2|Latias, F|item', '|poke|p2|Heatran, M|item',
  '|start', '|switch|p1a: Bisharp|Bisharp, F|100/100', '|switch|p2a: Latias|Latias, F|100/100', '|turn|1',
  '|', '|move|p2a: Latias|Trick|p1a: Bisharp',
  '|-activate|p2a: Latias|move: Trick|[of] p1a: Bisharp',
  '|-item|p1a: Bisharp|Choice Scarf|[from] move: Trick',
  '|-item|p2a: Latias|Life Orb|[from] move: Trick',
  '|move|p1a: Bisharp|Knock Off|p2a: Latias', '|-supereffective|p2a: Latias', '|-damage|p2a: Latias|0 fnt',
  '|-enditem|p2a: Latias|Life Orb|[from] move: Knock Off|[of] p1a: Bisharp', '|faint|p2a: Latias', '|turn|2',
].join('\n');

const itemOf = (log: string, side: 'p1' | 'p2', species: string) =>
  inferOpponentTeam(log, side).pokemon.find(mon => mon.species === species)?.item;

describe('a shown item replaces the preview flag (has item)', () => {
  test('the Trick giver is credited with the item it handed over, on both sides (655336 t5)', () => {
    expect(itemOf(trickLog, 'p2', 'Latias')).toMatchObject({ value: 'Choice Scarf', source: 'revealed' });
    expect(itemOf(trickLog, 'p1', 'Bisharp')).toMatchObject({ value: 'Life Orb', source: 'revealed' });
  });

  test('an item knocked off a flagged holder is its set item', () => {
    const log = [
      '|player|p1|Alice|', '|player|p2|Bob|', '|gen|6', '|tier|[Gen 6] OU',
      '|poke|p1|Bisharp, F|item', '|poke|p2|Heatran, M|item',
      '|start', '|switch|p1a: Bisharp|Bisharp, F|100/100', '|switch|p2a: Heatran|Heatran, M|100/100', '|turn|1',
      '|', '|move|p1a: Bisharp|Knock Off|p2a: Heatran', '|-resisted|p2a: Heatran', '|-damage|p2a: Heatran|90/100',
      '|-enditem|p2a: Heatran|Leftovers|[from] move: Knock Off|[of] p1a: Bisharp', '|turn|2',
    ].join('\n');
    expect(itemOf(log, 'p2', 'Heatran')).toMatchObject({ value: 'Leftovers (consumed)', source: 'revealed' });
  });
});
