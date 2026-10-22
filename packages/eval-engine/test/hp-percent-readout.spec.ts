import { describe, expect, test } from 'vitest';
import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { shownPercent, type HpDisplayBody } from '../src/branch/pokemon-info';
import { loadSimMods } from '../src/forward/sim-mods';

/**
 * Round 74, step R: the percent the branch shows for a body is the percent the replay's log shows for it, which is
 * the simulator's own display (getHealth on the 100 scale): Gen 7 and later round it up, Champions down, and a
 * Gen 6 game without the HP Percentage Mod would show pixels or (a custom game) the exact HP. Since round 69 (T161)
 * the rebuild sets a body to the middle of the HPs that show a percent, and the readers' `Math.round(hp / maxhp * 100)`
 * read one point under the log for such a body (Gastrodon 398 of 426: the log shows 94, the readers 93).
 * The sweep holds shownPercent to getHealth at every maximum HP from 50 to 700 and every HP, in every format family
 * the corpus plays, in each display mode the battle can be built with (singles, doubles and VGC read one rule).
 */
await loadSimMods('gen9championsou');

const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const garchomp: PokemonSet = {
  name: 'Garchomp', species: 'Garchomp', item: '', ability: 'No Ability', moves: ['Splash'], nature: 'Hardy', evs, ivs, level: 50,
};

const FORMATS = [
  { label: 'singles', format: 'gen9ou' },
  { label: 'doubles and VGC', format: 'gen9doublesou' },
  { label: 'Champions singles', format: 'gen9championsou' },
  { label: 'Champions doubles and VGC', format: 'gen9championsdoublescustomgame' },
  { label: 'Gen 6 with the HP Percentage Mod', format: 'gen6ou' },
  { label: 'Gen 6 without it', format: 'gen6customgame' },
  { label: 'Gen 4', format: 'gen4ou' },
];

/** The display modes a battle can be built with: the format's own, exact HP (a custom game), percent forced, pixels. */
const MODES: { label: string; exact: boolean; percentages: boolean | null }[] = [
  { label: 'the format\'s own', exact: false, percentages: null },
  { label: 'exact HP', exact: true, percentages: false },
  { label: 'percentages', exact: false, percentages: true },
  { label: 'no percentages', exact: false, percentages: false },
];

function battleOf(format: string): Battle {
  return new Battle({
    formatid: toID(format), seed: [1, 2, 3, 4],
    p1: { name: 'Alpha', team: Teams.pack([garchomp]) }, p2: { name: 'Beta', team: Teams.pack([garchomp]) },
  });
}

/** The reference: the simulator's display on the 100 scale for this HP, asked in percent mode; 0 where it shows a faint. */
function logPercent(battle: Battle, body: HpDisplayBody, hp: number): number {
  const saved = { exact: battle.reportExactHP, percentages: battle.reportPercentages, hp: body.hp };
  battle.reportExactHP = false;
  battle.reportPercentages = true;
  body.hp = hp;
  const read = /^(\d+)\/100/.exec(body.getHealth().shared);
  battle.reportExactHP = saved.exact;
  battle.reportPercentages = saved.percentages;
  body.hp = saved.hp;
  return read ? Number(read[1]) : 0;
}

describe('the branch readouts show the percent of the simulator display', () => {
  for (const shape of FORMATS) {
    test(`shownPercent equals getHealth at every HP of every maximum HP from 50 to 700 (${shape.label})`, () => {
      const battle = battleOf(shape.format);
      const body = battle.sides[0].pokemon[0] as unknown as HpDisplayBody;
      let checked = 0;
      for (const mode of MODES) {
        for (let maxhp = 50; maxhp <= 700; maxhp += maxhp < 120 ? 1 : 7) {
          body.maxhp = maxhp;
          for (let hp = 0; hp <= maxhp; hp++) {
            const expected = logPercent(battle, body, hp);
            battle.reportExactHP = mode.exact;
            if (mode.percentages !== null) battle.reportPercentages = mode.percentages;
            body.hp = hp;
            expect(shownPercent(body), `${shape.format} ${mode.label} ${hp}/${maxhp}`).toBe(expected);
            checked++;
          }
        }
      }
      expect(checked).toBeGreaterThan(100_000);
    });
  }

  test('the body keeps its HP and its display mode afterwards', () => {
    const battle = battleOf('gen6customgame');
    const body = battle.sides[0].pokemon[0] as unknown as HpDisplayBody;
    battle.reportExactHP = true;
    battle.reportPercentages = false;
    body.hp = 77;
    shownPercent(body);
    expect({ hp: body.hp, exact: battle.reportExactHP, percentages: battle.reportPercentages }).toEqual({ hp: 77, exact: true, percentages: false });
  });

  test('the old rounding reads under the log: Gastrodon at 398 of 426 shows 94, the rounding 93', () => {
    const battle = battleOf('gen9ou');
    const body = battle.sides[0].pokemon[0] as unknown as HpDisplayBody;
    body.maxhp = 426;
    body.hp = 398;
    expect(Math.round(398 / 426 * 100)).toBe(93);
    expect(shownPercent(body)).toBe(94);
  });
});
