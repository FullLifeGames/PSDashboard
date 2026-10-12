import { describe, expect, test } from 'vitest';
import { Dex } from '@pkmn/sim';
import * as championsMod from '@pkmn/mods/champions';
import { parseReplayLogWithObservations } from '../src/protocol-parser';

/**
 * Round 69 (T188, decision 33): the tempo evidence reads the species of the log's format. Swampert-Mega is a Champions
 * species the default Dex hides, so the weather-speed check found no Swift Swim on it and kept the order of a mover that
 * Rain doubled (the round-67 census counted 23 such broken orders in Champions VGC). The mod says which Mega holds the
 * ability; no ability name is typed here. A Swift Swim holder that is a plain species stays contaminated, and the same
 * mover in clear weather still gives its order.
 */
Dex.mod('champions', championsMod as unknown as NonNullable<Parameters<typeof Dex.mod>[1]>);
const mega = Dex.dexes.champions.species.get('Swampert-Mega');
const swiftSwim = Dex.dexes.champions.species.get('Kingdra');
const FORMATS = { singles: '[Gen 9 Champions] OU', doubles: '[Gen 9 Champions] VGC 2026 Reg M-B (Bo3)' } as const;

function log(kind: 'singles' | 'doubles', first: string, weather: string): string {
  const doubles = kind === 'doubles';
  return [
    '|player|p1|Alice|', '|player|p2|Bob|', '|gen|9', `|gametype|${kind}`, `|tier|${FORMATS[kind]}`, '|start',
    `|switch|p1a: A|${first}, L50, M|100/100`, `|switch|p2a: B|Garchomp, L50, M|100/100`,
    ...(doubles ? ['|switch|p1b: C|Incineroar, L50, M|100/100', '|switch|p2b: D|Rotom-Wash, L50|100/100'] : []),
    ...(first === 'Swampert' ? ['|detailschange|p1a: A|Swampert-Mega, L50, M', '|-mega|p1a: A|Swampert|Swampertite'] : []),
    ...(weather ? [`|-weather|${weather}`] : []),
    '|turn|1',
    '|move|p1a: A|Waterfall|p2a: B', '|-damage|p2a: B|70/100',
    '|move|p2a: B|Earthquake|p1a: A', '|-damage|p1a: A|80/100',
    ...(doubles ? ['|move|p1b: C|Flare Blitz|p2b: D', '|-damage|p2b: D|60/100', '|move|p2b: D|Hydro Pump|p1b: C', '|-damage|p1b: C|60/100'] : []),
    '|turn|2',
  ].join('\n');
}
const orders = (text: string) => parseReplayLogWithObservations(text).speedOrders.map(order => `${order.firstSpecies}>${order.secondSpecies}`);

describe('the mod\'s Swift Swim Mega', () => {
  test('the mod gives Swampert-Mega Swift Swim and Kingdra the same ability', () => {
    expect(Object.values(mega.abilities)).toContain('Swift Swim');
    expect(Object.values(swiftSwim.abilities)).toContain('Swift Swim');
  });

  for (const kind of ['singles', 'doubles'] as const) {
    test(`${kind}: Swampert-Mega first in rain gives no order, in clear weather it does`, () => {
      expect(orders(log(kind, 'Swampert', 'RainDance')).filter(order => order.startsWith('Swampert-Mega'))).toEqual([]);
      expect(orders(log(kind, 'Swampert', '')).filter(order => order.startsWith('Swampert-Mega'))).toContain('Swampert-Mega>Garchomp');
    });

    test(`${kind}: a plain Swift Swim holder in rain gives no order, as before`, () => {
      expect(orders(log(kind, 'Kingdra', 'RainDance')).filter(order => order.startsWith('Kingdra'))).toEqual([]);
      expect(orders(log(kind, 'Kingdra', '')).filter(order => order.startsWith('Kingdra'))).toContain('Kingdra>Garchomp');
    });
  }
});
