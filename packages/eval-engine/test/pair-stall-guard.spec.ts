import { describe, expect, test } from 'vitest';
import type { Battle, PokemonSet } from '@pkmn/sim';
import { loadSimMods } from '../src/forward/sim-mods';
import { planTimeFallback } from '../src/pair/guards';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 70: the pair plan sends a cell to the plain mean before anything is drawn when a move's success is rolled (spec
 * rule F1: a Protect used again after a Protect). The guard listed twelve move names: Wide Guard and Quick Guard among them,
 * which the simulator never rolls (their onTry asks only that someone acts after them), and not Mat Block, which it does
 * not roll either. A Wide Guard after a Protect fell back for nothing. The rule now comes from the Dex: a self-targeted
 * stalling move with a volatile is the Protect family, the moves whose volatile carries the stall counter's roll. Held here
 * against the simulator: every move that stops hits is played with a stall volatile on its user over eight seeds, in both
 * rule sets (Scarlet/Violet and the Champions mod).
 */

await loadSimMods('gen9championsou');

const RULES = [
  { name: 'Scarlet/Violet doubles', format: 'gen9doublescustomgame', level: 100, evs: undefined },
  { name: 'Pokémon Champions doubles', format: 'gen9championsdoublescustomgame', level: 50, evs: { hp: 32, atk: 32, def: 0, spa: 32, spd: 2, spe: 0 } },
];
const SEEDS = ['1,2,3,4', '5,6,7,8', '9,10,11,12', '13,14,15,16', '17,18,19,20', '21,22,23,24', '25,26,27,28', '29,30,31,32'];
const PROTECT_FAMILY = ['banefulbunker', 'burningbulwark', 'detect', 'endure', 'kingsshield', 'obstruct', 'protect', 'silktrap', 'spikyshield'];

describe.each(RULES)('$name: the stall guard of the pair plan reads the Dex (round 70)', rules => {
  const mon = (species: string, moves: string[]): PokemonSet => set(species, moves, { level: rules.level, ...(rules.evs ? { evs: rules.evs } : {}) });
  const board = (moveId: string, seed?: string): Battle =>
    battleOf(rules.format, [mon('Blissey', [moveId, 'splash']), mon('Blissey', ['splash'])], [mon('Pikachu', ['splash']), mon('Pikachu', ['splash'])], seed);

  /** Whether the user's move went through (the move line, no failure line of its own). */
  const succeeded = (battle: Battle): boolean =>
    battle.log.some(line => line.startsWith('|move|p1a')) && !battle.log.some(line => line.startsWith('|-fail|p1a'));

  /** Plays one turn with `moveId`, optionally with the stall counter at 27 (three Protects in a row). */
  function turn(moveId: string, seed: string, stalled: boolean): Battle {
    const battle = board(moveId, seed);
    if (stalled) for (let uses = 0; uses < 3; uses++) battle.sides[0].active[0]!.addVolatile('stall');
    battle.choose('p1', 'move 1, move 1');
    battle.choose('p2', 'move 1, move 1');
    return battle;
  }

  /** The simulator's answer: the move works on every seed without the counter and fails on some seed with it. */
  function rolledInSim(moveId: string): boolean {
    if (!SEEDS.every(seed => succeeded(turn(moveId, seed, false)))) return false;
    return SEEDS.some(seed => !succeeded(turn(moveId, seed, true)));
  }

  /** The engine's guard for the same move: does a cell with it, the user holding a stall volatile, go to the fallback. */
  function guardFires(moveId: string): boolean {
    const battle = board(moveId);
    battle.sides[0].active[0]!.addVolatile('stall');
    return planTimeFallback(battle, [[{ kind: 'move', slot: 0, moveId, loc: null }], []]) === 'stall';
  }

  const dex = board('splash').dex;
  /** Every move that sets a volatile or a side condition on its user's side: the field the stop-the-hit moves come from. */
  const candidates = dex.moves.all().filter(move => move.exists && move.gen <= 9 && !move.isMax && !move.isZ &&
    move.category === 'Status' && (move.target === 'self' || move.target === 'allySide') && !!(move.volatileStatus || move.sideCondition));

  test('the moves the simulator rolls are the nine of the Protect family, Wide Guard, Quick Guard and Mat Block are not among them', () => {
    expect(dex.currentMod).toBe(rules.format.includes('champions') ? 'champions' : 'base');
    expect(candidates.length).toBeGreaterThan(40);
    expect(candidates.filter(move => rolledInSim(move.id)).map(move => move.id).sort()).toEqual(PROTECT_FAMILY);
    for (const moveId of ['wideguard', 'quickguard', 'matblock']) expect(rolledInSim(moveId)).toBe(false);
  });

  test('the guard fires for exactly those moves', () => {
    for (const move of candidates) expect(`${move.id} ${guardFires(move.id)}`).toBe(`${move.id} ${rolledInSim(move.id)}`);
  });

  test('without a stall volatile no move trips the guard', () => {
    const battle = battleOf(rules.format, [mon('Blissey', ['protect', 'wideguard']), mon('Blissey', ['splash'])], [mon('Pikachu', ['splash']), mon('Pikachu', ['splash'])]);
    for (const moveId of ['protect', 'wideguard']) {
      expect(planTimeFallback(battle, [[{ kind: 'move', slot: 0, moveId, loc: null }], []])).toBeNull();
    }
  });
});
