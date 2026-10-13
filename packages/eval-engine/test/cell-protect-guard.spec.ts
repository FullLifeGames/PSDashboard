import { describe, expect, test } from 'vitest';
import type { Battle, PokemonSet } from '@pkmn/sim';
import { planCellEvents } from '../src/cell-blend';
import { loadSimMods } from '../src/forward/sim-mods';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 70: the singles planner keeps a cell out of the analytic blend when a move changes what a hit means (the
 * outcome classes assume the foe's move lands or misses; a Protect turns it away). The guard was a list of thirteen
 * move names (PROTECT_MOVE_IDS), with Max Guard in and Mat Block out. The rule now comes from the Dex and the
 * simulator: a move stops hits when it is a stalling move (`move.stallingMove`) or a side protector (`shieldsSide`,
 * the Wide Guard fix of the hints). Held here against the simulator: every status move that sets a volatile or a side
 * condition on its user's side is played in a singles turn against probe hits, in both rule sets (Scarlet/Violet and
 * the Champions mod).
 *
 * The hits are the damaging ones (Tackle, Surf, Aqua Jet at a 1-HP body, lethal and accurate) and Crafty Shield's
 * class, a status hit (Spore). Other moves turn a status hit away through their own effect (Magic Coat, Safeguard,
 * Shed Tail and Substitute); the rule does not read them, and this sweep does not claim them.
 */

await loadSimMods('gen9championsou');

/** The thirteen names of PROTECT_MOVE_IDS until round 69. */
const NAMES_UNTIL_ROUND_69 = [
  'banefulbunker', 'burningbulwark', 'craftyshield', 'detect', 'endure', 'kingsshield', 'maxguard', 'obstruct', 'protect', 'quickguard',
  'silktrap', 'spikyshield', 'wideguard',
];
const SEEDS = ['1,2,3,4', '5,6,7,8', '9,10,11,12', '13,14,15,16', '17,18,19,20', '21,22,23,24', '25,26,27,28', '29,30,31,32'];
const DAMAGING_PROBES = ['tackle', 'surf', 'aquajet'];

const RULES = [
  { name: 'Scarlet/Violet singles', format: 'gen9customgame', level: 100, evs: undefined },
  { name: 'Pokémon Champions singles', format: 'gen9championscustomgame', level: 50, evs: { hp: 32, atk: 32, def: 0, spa: 32, spd: 2, spe: 0 } },
];

describe.each(RULES)('$name: the protect guard of the cell planner reads the Dex (round 70)', rules => {
  const mon = (species: string, moves: string[]): PokemonSet => set(species, moves, { level: rules.level, ...(rules.evs ? { evs: rules.evs } : {}) });
  /** p1's Blissey (the faster body, so its move comes first) holds `moveId`; p2's Shuckle holds the probe. */
  const board = (moveId: string, probe: string, seed: string): Battle =>
    battleOf(rules.format, [mon('Blissey', [moveId, 'splash']), mon('Blissey', ['splash'])], [mon('Shuckle', [probe, 'splash']), mon('Shuckle', ['splash'])], seed);

  /** Whether p1's body comes through the probe untouched: alive at 1 HP (a damaging probe), awake (Spore). */
  function untouched(moveId: string, probe: string, seed: string): boolean {
    const battle = board(moveId, probe, seed);
    const body = battle.sides[0].active[0]!;
    if (probe !== 'spore') body.sethp(1);
    battle.choose('p1', 'move 1');
    battle.choose('p2', 'move 1');
    return probe === 'spore' ? body.status !== 'slp' : !body.fainted;
  }
  /** The simulator's answer: the move turns the probe's hit away on every seed, where the same turn with Splash lets it land on every seed. */
  const turnsAway = (moveId: string, probe: string): boolean =>
    SEEDS.every(seed => untouched(moveId, probe, seed) && !untouched('splash', probe, seed));

  const dex = board('splash', 'tackle', SEEDS[0]).dex;
  /** Every move that sets a volatile or a side condition on its user's side: the field the stop-the-hit moves come from. */
  const candidates = dex.moves.all().filter(move => move.exists && move.gen <= 9 && !move.isMax && !move.isZ &&
    move.category === 'Status' && (move.target === 'self' || move.target === 'allySide') && !!(move.volatileStatus || move.sideCondition));
  const stopsDamage = (moveId: string): boolean => DAMAGING_PROBES.some(probe => turnsAway(moveId, probe));

  /** The planner's answer for a cell of the move against a Rock Slide (an accuracy roll, so the cell plans events when the guard stays out), from both seats. */
  function plan(moveId: string): string {
    const battle = battleOf(rules.format, [mon('Blissey', [moveId, 'rockslide']), mon('Blissey', ['splash'])], [mon('Shuckle', ['rockslide', moveId]), mon('Shuckle', ['splash'])]);
    return `${planCellEvents(battle, `move ${moveId}`, 'move rockslide').kind}/${planCellEvents(battle, 'move rockslide', `move ${moveId}`).kind}`;
  }
  const guardFires = (moveId: string): boolean => plan(moveId) === 'fail/fail';

  test('the simulator turns damaging hits away for the Protect family, Endure, Quick Guard, Wide Guard and Mat Block', () => {
    expect(dex.currentMod).toBe(rules.format.includes('champions') ? 'champions' : 'base');
    expect(candidates.length).toBeGreaterThan(40);
    expect(candidates.filter(move => stopsDamage(move.id)).map(move => move.id).sort()).toEqual([
      'banefulbunker', 'burningbulwark', 'detect', 'endure', 'kingsshield', 'matblock', 'obstruct', 'protect', 'quickguard', 'silktrap', 'spikyshield', 'wideguard',
    ]);
    // Crafty Shield stops no damage but turns a status hit away.
    expect(stopsDamage('craftyshield')).toBe(false);
    expect(turnsAway('craftyshield', 'spore')).toBe(true);
  });

  test('the guard fires for exactly the moves that turn a hit away', () => {
    for (const move of candidates) {
      const stops = stopsDamage(move.id) || move.id === 'craftyshield';
      expect(`${move.id} ${plan(move.id)}`).toBe(`${move.id} ${stops ? 'fail/fail' : 'events/events'}`);
    }
  });

  test('against the thirteen names of round 69 the rule gains Mat Block and loses nothing', () => {
    const statusMoves = dex.moves.all().filter(move => move.exists && move.category === 'Status');
    const read = statusMoves.filter(move => guardFires(move.id)).map(move => move.id).sort();
    expect(read.filter(id => !NAMES_UNTIL_ROUND_69.includes(id))).toEqual(['matblock']);
    expect(NAMES_UNTIL_ROUND_69.filter(id => !read.includes(id))).toEqual([]);
  });

  test('the guard reads the move the choice names, with a Tera click or a target after it', () => {
    const battle = board('splash', 'rockslide', SEEDS[0]);
    for (const choice of ['move protect', 'move protect terastallize', 'move matblock 1']) {
      expect(planCellEvents(battle, choice, 'move rockslide').kind, choice).toBe('fail');
    }
    expect(planCellEvents(battle, 'move splash', 'move rockslide').kind).toBe('events');
  });
});
