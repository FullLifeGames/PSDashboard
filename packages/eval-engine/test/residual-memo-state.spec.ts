import { beforeEach, describe, expect, test } from 'vitest';
import type { Battle, Pokemon } from '@pkmn/sim';
import { residualReader, resetResidualMemo } from '../src/score/residuals';
import { loadSimMods } from '../src/forward/sim-mods';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 89 (#149, step A8): the end-of-turn memo of score/residuals.ts answers one reading for every board that shares its
 * signature, and the played end of turn reads more than the signature holds: a move pending in a slot (Future Sight
 * lands when the battle's turn reaches the turn it was set for, and the slot's conditions were not in the signature), a
 * Wish, the source of a Leech Seed (which active heals). The probe of A8p saw it on real boards: two misses of 23,393 hits
 * where a Future Sight lands within the three played turns on one board and not on the other.
 *
 * Each row is two boards that differ in one piece of state, read in both orders against the reading of its own board
 * played without a memo, in singles and doubles of Scarlet/Violet and of the Champions mod. A row has teeth when the two
 * fresh readings differ; the controls (a toxic stage, a Wish whose heal the reading leaves out) stay right.
 */

await loadSimMods('gen9championscustomgame');

type Tweak = (battle: Battle) => void;
const mine = (battle: Battle, slot = 0): Pokemon => battle.sides[0].active[slot]!;
const foe = (battle: Battle, slot = 0): Pokemon => battle.sides[1].active[slot]!;
const none: Tweak = () => {};

interface Row { name: string; first: Tweak; second: Tweak; doublesOnly?: boolean }

const futureSight: Tweak = battle => {
  const target = foe(battle);
  const source = mine(battle);
  battle.sides[1].addSlotCondition(target, 'futuremove', source);
  Object.assign(battle.sides[1].slotConditions[target.position].futuremove, {
    duration: 1, move: 'futuresight', source,
    moveData: { id: 'futuresight', name: 'Future Sight', accuracy: 100, basePower: 120, category: 'Special', priority: 0, flags: { futuremove: 1 }, ignoreImmunity: false, effectType: 'Move', type: 'Psychic' },
  });
};

const toxic = (stage: number): Tweak => battle => {
  mine(battle).setStatus('tox');
  mine(battle).statusState.stage = stage;
};

const ROWS: Row[] = [
  { name: 'a Future Sight pending in the foe slot against none', first: none, second: futureSight },
  { name: 'a Wish in the own slot against none (control)', first: none, second: battle => { battle.sides[0].addSlotCondition(mine(battle), 'Wish', mine(battle)); } },
  { name: 'a Leech Seed from the first slot against the second', doublesOnly: true,
    first: battle => { foe(battle).addVolatile('leechseed', mine(battle, 0)); }, second: battle => { foe(battle).addVolatile('leechseed', mine(battle, 1)); } },
  { name: 'a Leech Seed against none', first: none, second: battle => { foe(battle).addVolatile('leechseed', mine(battle, 0)); } },
  { name: 'a toxic stage 1 against 6 (control)', first: toxic(1), second: toxic(6) },
];

const FORMATS = [
  ['Scarlet/Violet singles', 'gen9customgame'], ['Scarlet/Violet doubles', 'gen9doublescustomgame'],
  ['Champions singles', 'gen9championscustomgame'], ['Champions doubles', 'gen9championsdoublescustomgame'],
] as const;

function boardOf(format: string, tweak: Tweak): Battle {
  const doubles = /doubles/.test(format);
  const battle = battleOf(
    format,
    [set('Rillaboom', ['woodhammer', 'splash'], { ability: 'Grassy Surge' }), set('Clefable', ['splash'])],
    [set('Dragonite', ['splash']), ...(doubles ? [set('Snorlax', ['splash'])] : [])],
  );
  tweak(battle);
  return battle;
}

const slots = (battle: Battle): (Pokemon | null)[] => battle.sides.flatMap(side => side.active.map(pokemon => pokemon ?? null));
const reading = (battle: Battle): string => {
  const reader = residualReader(battle);
  return JSON.stringify(slots(battle).map(pokemon => (pokemon ? reader(pokemon) ?? null : null)));
};
const fresh = (battle: Battle): string => {
  resetResidualMemo();
  return reading(battle);
};

beforeEach(() => resetResidualMemo());

describe.each(FORMATS)('the end-of-turn memo reads the state of the board (%s)', (_name, format) => {
  const doubles = /doubles/.test(format);
  const toothless: string[] = [];

  test.each(ROWS.filter(row => doubles || !row.doublesOnly).map(row => [row.name, row] as const))('%s: each reading is the reading of its own board, in both orders', (_row, row) => {
    const boards = [boardOf(format, row.first), boardOf(format, row.second)];
    const expected = boards.map(fresh);
    if (expected[0] === expected[1]) toothless.push(row.name);
    const wrong: string[] = [];
    for (const order of [[0, 1], [1, 0]]) {
      resetResidualMemo();
      for (const index of order) if (reading(boards[index]) !== expected[index]) wrong.push(`${order.join('>')}: board ${index}`);
    }
    expect(wrong).toEqual([]);
  });

  test('the Future Sight and Leech Seed rows have teeth', () => {
    expect(toothless.filter(name => /Future Sight|Leech Seed/.test(name))).toEqual([]);
  });
});
