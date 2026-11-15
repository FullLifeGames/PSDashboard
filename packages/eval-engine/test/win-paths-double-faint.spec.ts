import { Battle, Teams, type PokemonSet } from '@pkmn/sim';
import { describe, expect, test } from 'vitest';
import { wonBy } from '../src/endgame/win-paths/luck-path';
import { luckPath } from '../src/endgame/win-paths/luck';
import { mon, REQUEST, serializedBoard, type Board } from './win-paths-support';

/**
 * Round 89 (#130), G13b (the tester's question 11): a luck path or a mistake path may end with both last bodies fainting in one turn.
 * Who wins then is the simulator's call and varies by generation and by what caused it; this file holds no rule of its own. Each row
 * plays one 1 v 1 turn on a fresh battle of a generation (every body at 1 HP, so the move that lands also takes its user down) and
 * compares what the simulator says (`battle.winner`, the order of the `|faint|` lines) with `wonBy`, the reading the win paths use.
 */
interface Cause { name: string; first: string; second: string; fromGen: number; p1Moves: string[]; p2Moves: string[]; speedFirst: 'p1' | 'p2' }
const CAUSES: Cause[] = [
  // recoil: the faster body's Double-Edge takes the foe down and its own last hit point with it
  { name: 'recoil', first: 'p1', second: 'p2', fromGen: 1, p1Moves: ['Double-Edge'], p2Moves: ['Tackle'], speedFirst: 'p1' },
  // Explosion: the user faints with the move, the foe's body falls to the same blast
  { name: 'Explosion', first: 'p1', second: 'p2', fromGen: 1, p1Moves: ['Explosion'], p2Moves: ['Tackle'], speedFirst: 'p1' },
  // Destiny Bond: the slower body takes the attacker down with it
  { name: 'Destiny Bond', first: 'p1', second: 'p2', fromGen: 2, p1Moves: ['Tackle'], p2Moves: ['Destiny Bond'], speedFirst: 'p2' },
];

function playTurn(gen: number, cause: Cause): { ended: boolean; winner: string; faints: string[]; battle: Battle } {
  const fast = (moves: string[]): PokemonSet => mon('Pikachu', moves, { evs: { spe: 252 } });
  const slow = (moves: string[]): PokemonSet => mon('Snorlax', moves, { evs: { spe: 0 }, ivs: { spe: 0 } });
  const p1 = cause.speedFirst === 'p1' ? fast(cause.p1Moves) : slow(cause.p1Moves);
  const p2 = cause.speedFirst === 'p1' ? slow(cause.p2Moves) : fast(cause.p2Moves);
  const battle = new Battle({ formatid: `gen${gen}customgame` as never, seed: [1, 2, 3, 4], p1: { name: 'A', team: Teams.pack([p1]) }, p2: { name: 'B', team: Teams.pack([p2]) } });
  if (battle.sides.some(side => side.requestState === 'teampreview')) { battle.choose('p1', 'team 1'); battle.choose('p2', 'team 1'); }
  for (const side of battle.sides) side.pokemon[0].hp = 1;
  battle.choose('p1', 'move 1');
  battle.choose('p2', 'move 1');
  const faints = battle.log.filter(line => line.startsWith('|faint|')).map(line => line.split('|')[2].slice(0, 2));
  return { ended: battle.ended, winner: battle.winner, faints, battle };
}

const gens = (from: number): number[] => Array.from({ length: 10 - from }, (_, index) => from + index);

describe('both last bodies fall in one turn: the simulator decides, by generation and by cause', () => {
  for (const cause of CAUSES) {
    for (const gen of gens(cause.fromGen)) {
      test(`gen ${gen}, ${cause.name}: the win paths read the simulator's winner and nothing else`, () => {
        const result = playTurn(gen, cause);
        expect(result.ended).toBe(true);
        expect(result.faints).toHaveLength(2);
        // what the simulator says at this generation (Showdown: a tie before generation 5, else the side whose body fell last)
        const last = result.faints[1] as 'p1' | 'p2';
        const expected = gen >= 5 ? last : null;
        expect(result.winner === '' ? null : result.winner === 'A' ? 'p1' : 'p2').toBe(expected);
        for (const side of ['p1', 'p2'] as const) expect(wonBy(result.battle, side), `${side} counts as the winner`).toBe(side === expected);
      });
    }
  }

  // the same board through the luck step: the double faint is a win in Gen 9 and none in Gen 4, as the simulator ends it
  test.each([[9, 'found'], [4, 'none']] as const)('gen %i: the luck step finds the recoil win only where the simulator gives it', async (gen, status) => {
    const board: Board = {
      format: `gen${gen}customgame`,
      p1: [mon('Pikachu', ['Double-Edge'], { evs: { spe: 252 } })],
      p2: [mon('Snorlax', ['Tackle'], { evs: { spe: 0 }, ivs: { spe: 0 } })],
      prepare: battle => { for (const side of battle.sides) side.pokemon[0].hp = 1; },
    };
    const { serialized } = await serializedBoard(board);
    expect(luckPath(serialized, REQUEST('p1')).status).toBe(status);
  }, 60_000);
});
