import { beforeEach, describe, expect, test } from 'vitest';
import type { Battle, Pokemon } from '@pkmn/sim';
import { hitReader, playedHit, resetHitMemo, type HitCost } from '../src/score/contact';
import { loadSimMods } from '../src/forward/sim-mods';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 89 (#149, step A8): the hit-cost memo of score/contact.ts keyed the bodies by their names and a few numbers, and
 * the played hit reads more: the Substitute's HP the hit runs into, the count Supreme Overlord keeps, the gender Rivalry
 * compares, the stat Protosynthesis and Quark Drive lift, the turns a foe has stood for Stakeout, the Speed and evasion
 * stages Gyro Ball and Power Trip read, the faint of the turn before (Retaliate), the weight (Heavy Slam) and the
 * happiness (Return). The memo lives in every worker and the app keeps it across turns, so a hit's answer came from
 * whichever board reached the notebook first (D-A43: 124 Substitute hits in five games).
 *
 * One row is two boards that differ in one piece of state, in singles and doubles of Scarlet/Violet and of the Champions
 * mod (a row whose species or move the Champions Dex lacks is counted and named, never dropped silently). Each reading is
 * compared with the hit played without a memo, whichever board came first, and a clear of the memo between the boards
 * changes nothing. A row has teeth when the two fresh plays differ.
 */

await loadSimMods('gen9championscustomgame');

type Tweak = (battle: Battle) => void;
type Body = Pokemon & Record<string, unknown>;
const attackerOf = (battle: Battle): Body => battle.sides[0].active[0]! as Body;
const defenderOf = (battle: Battle): Body => battle.sides[1].active[0]! as Body;

const volatile = (who: (battle: Battle) => Pokemon, id: string, state: Record<string, unknown>): Tweak => battle => {
  who(battle).addVolatile(id);
  Object.assign(who(battle).volatiles[id] ?? {}, state);
};

interface Row {
  name: string;
  attacker: [species: string, ability: string, item?: string];
  defender: [species: string, ability?: string];
  move: string;
  first: Tweak;
  second: Tweak;
}

const FLAME_BODY: Row['defender'] = ['Talonflame', 'Flame Body'];

const ROWS: Row[] = [
  { name: 'Substitute HP 200 against 10', attacker: ['Rillaboom', 'Grassy Surge'], defender: ['Dragonite'], move: 'woodhammer',
    first: volatile(defenderOf, 'substitute', { hp: 200 }), second: volatile(defenderOf, 'substitute', { hp: 10 }) },
  { name: 'Supreme Overlord fallen 0 against 5', attacker: ['Kingambit', 'Supreme Overlord'], defender: ['Dragonite'], move: 'woodhammer',
    first: battle => { (attackerOf(battle).abilityState as { fallen: number }).fallen = 0; },
    second: battle => { (attackerOf(battle).abilityState as { fallen: number }).fallen = 5; } },
  { name: 'Rivalry, the same gender against the other', attacker: ['Nidoking', 'Rivalry'], defender: ['Nidoqueen'], move: 'woodhammer',
    first: battle => { attackerOf(battle).gender = 'M'; defenderOf(battle).gender = 'M'; },
    second: battle => { attackerOf(battle).gender = 'M'; defenderOf(battle).gender = 'F'; } },
  { name: 'Protosynthesis on Attack against Speed', attacker: ['Roaring Moon', 'Protosynthesis', 'Booster Energy'], defender: ['Dragonite'], move: 'woodhammer',
    first: volatile(attackerOf, 'protosynthesis', { bestStat: 'atk' }), second: volatile(attackerOf, 'protosynthesis', { bestStat: 'spe' }) },
  { name: 'Quark Drive on Attack against Special Defense', attacker: ['Iron Hands', 'Quark Drive', 'Booster Energy'], defender: ['Dragonite'], move: 'woodhammer',
    first: volatile(attackerOf, 'quarkdrive', { bestStat: 'atk' }), second: volatile(attackerOf, 'quarkdrive', { bestStat: 'spd' }) },
  { name: 'Stakeout against a foe that stood 0 and 3 turns', attacker: ['Houndstone', 'Stakeout'], defender: ['Dragonite'], move: 'woodhammer',
    first: battle => { defenderOf(battle).activeTurns = 0; }, second: battle => { defenderOf(battle).activeTurns = 3; } },
  { name: 'Gyro Ball at Speed stage 0 and -6 into Flame Body', attacker: ['Ferrothorn', 'Iron Barbs'], defender: FLAME_BODY, move: 'gyroball',
    first: battle => { attackerOf(battle).boosts.spe = 0; }, second: battle => { attackerOf(battle).boosts.spe = -6; } },
  { name: 'Power Trip at evasion stage 0 and +3 into Flame Body', attacker: ['Grimmsnarl', 'Prankster'], defender: FLAME_BODY, move: 'powertrip',
    first: battle => { attackerOf(battle).boosts.evasion = 0; }, second: battle => { attackerOf(battle).boosts.evasion = 3; } },
  { name: 'Retaliate with and without a faint last turn, into Flame Body', attacker: ['Snorlax', 'Thick Fat'], defender: FLAME_BODY, move: 'retaliate',
    first: battle => { battle.sides[0].faintedLastTurn = null; },
    second: battle => { battle.sides[0].faintedLastTurn = battle.sides[0].pokemon[1] ?? battle.sides[0].pokemon[0]; } },
  { name: 'Heavy Slam at two weights, into Flame Body', attacker: ['Snorlax', 'Thick Fat'], defender: FLAME_BODY, move: 'heavyslam',
    first: battle => { attackerOf(battle).weighthg = 1000; }, second: battle => { attackerOf(battle).weighthg = 3000; } },
  { name: 'Return at happiness 255 and 50, into Flame Body', attacker: ['Snorlax', 'Thick Fat'], defender: FLAME_BODY, move: 'return',
    first: battle => { attackerOf(battle).happiness = 255; }, second: battle => { attackerOf(battle).happiness = 50; } },
];

const FORMATS = [
  ['Scarlet/Violet singles', 'gen9customgame'], ['Scarlet/Violet doubles', 'gen9doublescustomgame'],
  ['Champions singles', 'gen9championscustomgame'], ['Champions doubles', 'gen9championsdoublescustomgame'],
] as const;

/** The board of a row in a format, or null where the format's Dex lacks a species or the move. */
function boardOf(format: string, row: Row, tweak: Tweak): Battle | null {
  const [species, ability, item] = row.attacker;
  const [foe, foeAbility] = row.defender;
  const p1 = [set(species, [row.move, 'splash'], { ability, ...(item ? { item } : {}) }), set('Clefable', ['splash'])];
  const p2 = [set(foe, ['splash'], foeAbility ? { ability: foeAbility } : {})];
  if (/doubles/.test(format)) p2.push(set('Snorlax', ['splash']));
  try {
    const battle = battleOf(format, p1, p2);
    if (!battle.dex.moves.get(row.move).exists) return null;
    tweak(battle);
    return battle;
  } catch {
    return null;
  }
}

const fresh = (battle: Battle, move: string): HitCost => playedHit(battle, attackerOf(battle), defenderOf(battle), move);
const read = (battle: Battle, move: string): HitCost => hitReader(battle)(attackerOf(battle), defenderOf(battle), move);

beforeEach(() => resetHitMemo());

describe.each(FORMATS)('the hit memo reads the state of the hit (%s)', (_name, format) => {
  const noTeeth: string[] = [];

  test.each(ROWS.map(row => [row.name, row] as const))('%s: each reading is the hit of its own board, in both orders and across a clear', (_row, row) => {
    const boards = [boardOf(format, row, row.first), boardOf(format, row, row.second)];
    if (!boards[0] || !boards[1]) {
      expect(boards[0] === null && boards[1] === null).toBe(true);
      return;
    }
    const expected = boards.map(battle => fresh(battle!, row.move));
    // Teeth: the two boards differ in the played hit (counted below where a format's rules give the same hit twice).
    if (JSON.stringify(expected[0]) === JSON.stringify(expected[1])) noTeeth.push(row.name);
    const wrong: string[] = [];
    for (const order of [[0, 1], [1, 0]]) {
      for (const cleared of [false, true]) {
        resetHitMemo();
        order.forEach((index, step) => {
          if (cleared && step === 1) resetHitMemo();
          if (JSON.stringify(read(boards[index]!, row.move)) !== JSON.stringify(expected[index])) wrong.push(`${order.join('>')}${cleared ? ' cleared' : ''}: board ${index}`);
        });
      }
    }
    expect(wrong).toEqual([]);
  });

  test('every row builds in Scarlet/Violet, the Champions rows a Dex lacks are named, and at most one row per format reads the same twice', () => {
    // Champions' Heavy Slam at level 50 rounds both weights to the same hit; Scarlet/Violet has teeth in every row.
    expect(noTeeth.filter(name => !name.startsWith('Heavy Slam'))).toEqual([]);
    if (format.startsWith('gen9custom') || format.startsWith('gen9doublescustom')) expect(noTeeth).toEqual([]);
    const lacking = ROWS.filter(row => boardOf(format, row, row.first) === null).map(row => row.name);
    if (format.startsWith('gen9custom') || format.startsWith('gen9doublescustom')) expect(lacking).toEqual([]);
    else expect(lacking.length).toBeLessThan(ROWS.length);
  });
});
