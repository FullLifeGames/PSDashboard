import { describe, expect, test } from 'vitest';
import { Dex } from '@pkmn/sim';
import * as champions from '@pkmn/mods/champions';
import { choiceItems, hazardConditions, terrainConditions, umbrellaWeathers, SCREENS, screenFlags, isScreen } from '../src/dex-facts/index';

/**
 * Round 72 (T235): four hand lists of name literals now come from the Dex through the facts table. The lists below are the old
 * ones, copied from the code before the change; the sweep derives each from every view the corpus plays (Generations 1 to 9
 * and the Champions mod) and requires the hand list, so a Dex that grows a fifth terrain or a second Choice item fails here
 * with its id.
 */

Dex.mod('champions', champions as unknown as NonNullable<Parameters<typeof Dex.mod>[1]>);

const VIEWS: { name: string; dex: typeof Dex }[] = [
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(gen => ({ name: `Gen ${gen}`, dex: Dex.forGen(gen) })),
  { name: 'Champions', dex: Dex.mod('champions') },
];

const OLD_CHOICE = ['choiceband', 'choicespecs', 'choicescarf'];
const OLD_HAZARDS = ['stealthrock', 'spikes', 'toxicspikes', 'stickyweb'];
const OLD_TERRAINS = ['electricterrain', 'grassyterrain', 'mistyterrain', 'psychicterrain'];
const OLD_UMBRELLA = ['sunnyday', 'raindance', 'desolateland', 'primordialsea'];
const OLD_SCREENS = ['reflect', 'lightscreen', 'auroraveil'];

const sorted = (ids: Iterable<string>) => [...ids].sort();

describe.each(VIEWS)('$name: the derived lists equal the hand lists', ({ dex }) => {
  test('Choice items (isChoice)', () => expect(sorted(choiceItems(dex))).toEqual(sorted(OLD_CHOICE)));
  test('entry hazards (a foe-side move whose condition acts on a switch-in)', () => expect(sorted(hazardConditions(dex))).toEqual(sorted(OLD_HAZARDS)));
  test('terrains (the terrain a move sets)', () => expect(sorted(terrainConditions(dex))).toEqual(sorted(OLD_TERRAINS)));
  test('weathers the Utility Umbrella removes (a weather that changes damage)', () => expect(sorted(umbrellaWeathers(dex))).toEqual(sorted(OLD_UMBRELLA)));
  test('a second ask returns the memoized set', () => expect(choiceItems(dex)).toBe(choiceItems(dex)));
});

describe('screens: one constant', () => {
  test('SCREENS is the old list, in its order', () => expect([...SCREENS]).toEqual(OLD_SCREENS));
  test('isScreen tells a screen from any other side condition', () => {
    expect(OLD_SCREENS.every(isScreen)).toBe(true);
    expect(['tailwind', 'safeguard', 'stealthrock', ''].some(isScreen)).toBe(false);
  });
  test('screenFlags sets the calculator flag of each screen and no other', () => {
    expect(screenFlags([])).toEqual({ isReflect: false, isLightScreen: false, isAuroraVeil: false });
    expect(screenFlags(['reflect', 'tailwind'])).toEqual({ isReflect: true, isLightScreen: false, isAuroraVeil: false });
    expect(screenFlags(new Set(['lightscreen', 'auroraveil']))).toEqual({ isReflect: false, isLightScreen: true, isAuroraVeil: true });
  });
});
