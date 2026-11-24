import { describe, expect, test } from 'vitest';
import { checkedRolls, drawTurn } from './calc-roll-oracle';
import { doubles, IDLE, IDLE_ALONE, SCENES, SCREENS } from './forced-spread-scenes';

// A screen is 2732/4096 in Doubles, 2048/4096 in Singles: neither prices a lone foe's spread hit (kill table null).

describe('the kill table of a forced spread behind a screen (doubles)', () => {
  for (const scene of SCENES) {
    for (const screen of SCREENS) {
      test(`${scene.title}, lone foe behind ${screen}: no table, never a wrong one`, () => {
        const checked = checkedRolls(drawTurn(doubles(scene, screen, true), scene.choice, IDLE_ALONE));
        expect(checked).toHaveLength(1);
        for (const { table, holds } of checked) expect(table === null || holds, 'a table the simulator does not play').toBe(true);
        expect(checked[0].table).toBeNull();
      });
    }

    test(`${scene.title}: without a screen the table stays the simulator's`, () => {
      const checked = checkedRolls(drawTurn(doubles(scene, null, true), scene.choice, IDLE_ALONE));
      expect(checked).toHaveLength(1);
      expect(checked[0].table).not.toBeNull();
      expect(checked.every(entry => entry.holds)).toBe(true);
    });

    test(`${scene.title}: two foes behind a screen spread, and the table is the simulator's`, () => {
      const checked = checkedRolls(drawTurn(doubles(scene, 'lightscreen', false), scene.choice, IDLE));
      expect(checked).toHaveLength(2);
      expect(checked.every(entry => entry.table !== null && entry.holds)).toBe(true);
    });
  }
});
