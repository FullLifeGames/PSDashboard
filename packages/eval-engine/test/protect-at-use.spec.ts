import { describe, expect, test } from 'vitest';
import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { Field, calculate } from '@smogon/calc';
import { calcGenerationFor } from '@fulllifegames/replay-core';
import { bodyOf, calcPokemon } from '../src/calc/body';
import * as moveModule from '../src/calc/move';
import { calcMove } from '../src/calc/move';
import { loadSimMods } from '../src/forward/sim-mods';

/**
 * Round 68 (T186, decision 4): Protect as the simulator plays it. A move that ignores Protect in the simulator (Unseen
 * Fist on a contact move in the base mods, which delete the move's protect flag in onModifyMove) must reach the
 * calculator without isProtected, and a move that keeps the flag and still lands (Piercing Drill, the Champions mod's
 * Unseen Fist: onHitProtect, a quarter) with it. Calc 0.12 prices every Unseen Fist hit at a quarter, so the engine
 * decides isProtected from the move as the simulator carries it after the attacker's ModifyMove: the engine's
 * `protectBlocks(gen, moveName, attacker)` in calc/move.ts (true: the Protect check applies, the calc decides the rest).
 * Checker: real battles, singles and doubles, base mods and the Champions mod; the simulator's HP loss of the Protecting
 * target must lie in the calculator's range for the field the engine builds (one point of rounding allowed for the
 * quarter hits).
 */
const FORMATS = ['gen9customgame', 'gen9doublescustomgame', 'gen9championscustomgame', 'gen9championsdoublescustomgame'] as const;
type Format = typeof FORMATS[number];

const CASES = [
  { label: 'Unseen Fist on a contact move', attacker: 'Urshifu', ability: 'Unseen Fist', move: 'Close Combat', moveId: 'closecombat' },
  { label: 'Unseen Fist on a move without contact', attacker: 'Urshifu', ability: 'Unseen Fist', move: 'Aura Sphere', moveId: 'aurasphere' },
  { label: 'Piercing Drill on a contact move', attacker: 'Excadrill', ability: 'Piercing Drill', move: 'Close Combat', moveId: 'closecombat' },
] as const;

function setOf(species: string, moves: string[], ability: string, champions: boolean): PokemonSet {
  const high = champions ? 32 : 252;
  return {
    name: species, species, item: '', ability, moves, nature: 'Hardy', gender: '', level: 50,
    evs: { hp: high, atk: high, def: 0, spa: high, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  };
}

interface Hit { loss: number; range: [number, number] | null; blocks: boolean | undefined }

function play(format: Format, scene: typeof CASES[number]): Hit {
  const champions = format.includes('champions');
  const doubles = format.includes('doubles');
  const p1 = [setOf(scene.attacker, [scene.move, 'Splash'], scene.ability, champions), ...(doubles ? [setOf('Corviknight', ['Splash'], 'Pressure', champions)] : [])];
  const p2 = [setOf('Amoonguss', ['Protect', 'Splash'], 'Regenerator', champions), ...(doubles ? [setOf('Blissey', ['Splash'], 'Natural Cure', champions)] : [])];
  const battle = new Battle({ formatid: toID(format) as never, seed: '1,2,3,4', p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) } });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
  }
  const [attacker, target] = [battle.sides[0].active[0], battle.sides[1].active[0]];
  const gen = calcGenerationFor(9, battle.dex.currentMod);
  const atkBody = bodyOf(battle, attacker);
  const defBody = bodyOf(battle, target);
  const protectBlocks = (moveModule as unknown as { protectBlocks?: (g: unknown, name: string, body: unknown) => boolean }).protectBlocks;
  const blocks = protectBlocks?.(gen, scene.move, atkBody);
  const before = target.hp;
  battle.choose('p1', doubles ? `move ${scene.moveId} 1, move splash` : `move ${scene.moveId}`);
  battle.choose('p2', doubles ? 'move protect, move splash' : 'move protect');
  const loss = before - target.hp;
  if (blocks === undefined) return { loss, range: null, blocks };
  const field = new Field({ gameType: doubles ? 'Doubles' : 'Singles', defenderSide: { isProtected: blocks } });
  const range = calculate(gen, calcPokemon(gen, atkBody), calcPokemon(gen, defBody), calcMove(gen, scene.move, atkBody), field).range();
  return { loss, range: [range[0], range[1]], blocks };
}

await loadSimMods('gen9championsou');

describe('Protect reaches the calculator as the simulator plays it (decision 4)', () => {
  test('the engine names the move\'s Protect check: calc/move.ts exports protectBlocks', () => {
    expect(typeof (moveModule as unknown as { protectBlocks?: unknown }).protectBlocks).toBe('function');
  });

  for (const format of FORMATS) {
    test(`${format}: the simulator's loss of a Protecting target lies in the range of the engine's field`, () => {
      const hits = CASES.map(scene => ({ scene, ...play(format, scene) }));
      for (const { scene, loss, range, blocks } of hits) {
        expect(range, `${scene.label}: protectBlocks answered ${String(blocks)}`).not.toBeNull();
        const [min, max] = range!;
        expect(loss, `${scene.label}: simulator loss ${loss}, calc ${min}-${max}`).toBeGreaterThanOrEqual(min - 1);
        expect(loss, `${scene.label}: simulator loss ${loss}, calc ${min}-${max}`).toBeLessThanOrEqual(max + 1);
      }
      // Not vacuous: the move without contact is stopped, the two contact moves are not.
      expect(hits[1].loss).toBe(0);
      expect(hits[0].loss).toBeGreaterThan(0);
      expect(hits[2].loss).toBeGreaterThan(0);
    });
  }
});
