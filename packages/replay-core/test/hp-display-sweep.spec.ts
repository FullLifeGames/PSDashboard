import { describe, expect, test } from 'vitest';
import { Battle, Dex, type PokemonSet } from '@pkmn/sim';
import * as championsMod from '@pkmn/mods/champions';
import { registerChampionsDex } from '../src/rules-dex';
import { formOf, hpBoundsOf, shownOf, type HpForm } from '../src/hp-display';

/**
 * Round 89 (#75, ruling 27.4): the sweep that holds `hp-display.ts` to the simulator. The simulator prints a body's HP in the form its battle
 * names (`getHealth`: Scarlet/Violet round a percentage up, the Champions mod rounds it down, a format without the HP Percentage Mod before
 * Generation 7 prints 48ths). Each battle below is a real @pkmn/sim battle: the sweep sets the one body's HP and maximum HP to every pair of a
 * range of maximum HP and reads what `getHealth().shared` prints. Three things must hold for every maximum HP: `shownOf` is the printed number,
 * `formOf` names the form the battle prints (by the text's maximum, as the log shows it), and `hpBoundsOf` returns exactly the lowest and the
 * highest HP that print the same number (the HP the solver may read behind a shown text), and null for a number no HP prints.
 */

if (!Dex.formats.get('gen9championscustomgame').exists) registerChampionsDex(championsMod as never, championsMod.Formats as never);

interface World { name: string; formatid: string; form: HpForm; champions: boolean }
const WORLDS: World[] = [
  { name: 'Scarlet/Violet OU (percentage rounded up)', formatid: 'gen9ou', form: 'percent-up', champions: false },
  { name: 'Scarlet/Violet VGC (Generation 7 and later print a percentage without the rule)', formatid: 'gen9vgc2025regi', form: 'percent-up', champions: false },
  { name: 'Generation 6 OU (the HP Percentage Mod)', formatid: 'gen6ou', form: 'percent-up', champions: false },
  { name: 'Champions OU (percentage rounded down)', formatid: 'gen9championsou', form: 'percent-down', champions: true },
  { name: 'Generation 6 VGC 2016 (48ths rounded down)', formatid: 'gen6vgc2016', form: 'pixels', champions: false },
  { name: 'Generation 5 GBU singles (48ths rounded down)', formatid: 'gen5gbusingles', form: 'pixels', champions: false },
];

const set = (species: string): PokemonSet => ({ name: species, species, ability: 'No Ability', item: '', moves: ['splash'], level: 50, evs: { hp: 4 } }) as PokemonSet;

function bodyOf(world: World) {
  const battle = new Battle({ formatid: world.formatid as never, seed: [1, 2, 3, 4], p1: { name: 'p1', team: [set('Pikachu')] }, p2: { name: 'p2', team: [set('Eevee')] } });
  return battle.p1.pokemon[0];
}

/** What the simulator prints for the body at this HP: the text of the shared log line (`75/100`, `24/48g`). */
function printed(body: ReturnType<typeof bodyOf>, hp: number, maxhp: number): { hp: number; maxhp: number } {
  body.hp = hp;
  body.maxhp = maxhp;
  const text = body.getHealth().shared;
  const match = /^(\d+)\/(\d+)/.exec(text);
  if (!match) throw new Error(`no HP text: ${text}`);
  return { hp: Number(match[1]), maxhp: Number(match[2]) };
}

/** The maximum HP the sweep plays: every one up to 130 (past the percentage scale), then the real stats of a level 50 and a level 100 body. */
const MAXES = [...Array.from({ length: 130 }, (_, i) => i + 1), 143, 155, 160, 186, 191, 200, 207, 222, 255, 271, 294, 310, 341, 404, 482, 524, 599, 714];

describe('hp-display against the simulator', () => {
  for (const world of WORLDS) {
    test(`${world.name}: the form, the printed number and the bounds of every HP of ${MAXES.length} maximum HPs`, () => {
      const body = bodyOf(world);
      let rows = 0;
      for (const max of MAXES) {
        const byShown = new Map<number, number[]>();
        for (let hp = 1; hp <= max; hp += 1) {
          const text = printed(body, hp, max);
          expect(formOf(text.maxhp, world.champions), `${world.name}: the form of ${hp}/${max}`).toBe(world.form);
          expect(shownOf(world.form, hp, max), `${world.name}: ${hp}/${max} prints ${text.hp}`).toBe(text.hp);
          byShown.set(text.hp, [...(byShown.get(text.hp) ?? []), hp]);
          rows += 1;
        }
        for (const [shown, hps] of byShown) {
          const scale = world.form === 'pixels' ? 48 : 100;
          const bounds = hpBoundsOf({ hp: shown, maxhp: scale }, max, world.champions);
          expect(bounds, `${world.name}: shown ${shown}/${scale} of a body with ${max} HP`).toEqual({ lowest: Math.min(...hps), highest: Math.max(...hps) });
        }
        // A number no HP of this body prints reads as no bound.
        for (let shown = 1; shown <= (world.form === 'pixels' ? 48 : 100); shown += 1) {
          if (byShown.has(shown)) continue;
          expect(hpBoundsOf({ hp: shown, maxhp: world.form === 'pixels' ? 48 : 100 }, max, world.champions), `${world.name}: shown ${shown} of ${max} HP`).toBeNull();
        }
      }
      expect(rows).toBeGreaterThan(9000);
    }, 120_000);
  }

  test('a Custom Game prints the exact HP, and the form reads it as it stands', () => {
    const body = bodyOf({ name: 'Custom Game', formatid: 'gen9customgame', form: 'exact', champions: false });
    for (const [hp, max] of [[139, 186], [1, 186], [186, 186], [70, 404]]) {
      expect(printed(body, hp, max)).toEqual({ hp, maxhp: max });
      expect(shownOf('exact', hp, max)).toBe(hp);
      expect(hpBoundsOf({ hp, maxhp: max }, max, false)).toEqual({ lowest: hp, highest: hp });
    }
  });

  test('a full body prints 100 and nothing below full does, in every form', () => {
    for (const world of WORLDS) {
      const body = bodyOf(world);
      const scale = world.form === 'pixels' ? 48 : 100;
      for (const max of [1, 2, 3, 50, 186, 714]) {
        expect(printed(body, max, max).hp).toBe(scale);
        if (max > 1) expect(printed(body, max - 1, max).hp).toBeLessThan(scale);
        expect(hpBoundsOf({ hp: scale, maxhp: scale }, max, world.champions)).toEqual({ lowest: max, highest: max });
      }
    }
  });

  test('an exact text pins the HP, and keeps its ratio on a body of another maximum HP', () => {
    expect(formOf(186, false)).toBe('exact');
    expect(formOf(186, true)).toBe('exact');
    expect(shownOf('exact', 139, 186)).toBe(139);
    expect(hpBoundsOf({ hp: 139, maxhp: 186 }, 186, false)).toEqual({ lowest: 139, highest: 139 });
    expect(hpBoundsOf({ hp: 93, maxhp: 186 }, 200, false)).toEqual({ lowest: 100, highest: 100 });
  });

  test('the text of the Palafin scene: a shown 75 of a body with 186 HP is 138 or 139 HP in Scarlet/Violet, 140 to 141 in the Champions mod', () => {
    expect(hpBoundsOf({ hp: 75, maxhp: 100 }, 186, false)).toEqual({ lowest: 138, highest: 139 });
    expect(hpBoundsOf({ hp: 75, maxhp: 100 }, 186, true)).toEqual({ lowest: 140, highest: 141 });
  });
});
