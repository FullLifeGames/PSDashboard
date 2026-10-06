import { describe, expect, test } from 'vitest';
import { Field, Generations, Move, Pokemon, calculate } from '@smogon/calc';
import { calcSingleDamageRange } from '../src/damage-calc';
import type { BranchMoveOption, SimPokemonInfo } from '../src/branch-engine';

/**
 * The preview's KO text is the calc's own verdict against the defender's
 * current HP (Result.kochance), not a guess from the share of max HP: a
 * damaged Snorlax that a 36–43 % Earthquake finishes reads as a KO.
 */
const gen9 = Generations.get(9);
const STATS = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

function mon(species: string, overrides: Partial<SimPokemonInfo> = {}): SimPokemonInfo {
  const evs = overrides.evs ?? { ...STATS, hp: 252, atk: 252 };
  const maxhp = new Pokemon(gen9, species, { level: overrides.level ?? 100, evs }).maxHP();
  return {
    name: species, species, hp: maxhp, maxhp, hpPercent: 100, status: '', fainted: false, isActive: true, activeSlot: 0,
    moves: [], ability: '', item: '', stats: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, nature: 'Hardy', evs,
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, gender: '', teraType: '', boosts: {}, level: 100,
    types: [], ...overrides,
  };
}

const move = (name: string, targetType = 'normal'): BranchMoveOption =>
  ({ name, activeSlot: 0, slot: 1, pp: 16, maxpp: 16, disabled: false, type: '', targetType, requiresTarget: false, targetOptions: [] });

/** The calc's own KO verdict for the same two Pokémon at the defender's current HP. */
function calcVerdict(attacker: SimPokemonInfo, defender: SimPokemonInfo, name: string, gameType: 'Singles' | 'Doubles' = 'Singles') {
  const poke = (info: SimPokemonInfo) => new Pokemon(gen9, info.species, {
    level: info.level, ability: info.ability || undefined, item: info.item || undefined, nature: info.nature,
    evs: info.evs, ivs: info.ivs, curHP: info.hp,
  });
  return calculate(gen9, poke(attacker), poke(defender), new Move(gen9, name), new Field({ gameType })).kochance(false);
}

describe('the KO text reads the defender\'s current HP', () => {
  const garchomp = mon('Garchomp');
  const snorlax = mon('Snorlax', { evs: { ...STATS, hp: 252, def: 252 } });

  test('a damaged target the hit finishes reads as a guaranteed KO, as the calc says', () => {
    const full = calcSingleDamageRange(garchomp, snorlax, move('Earthquake', 'allAdjacent'));
    expect(full.maxPercent).toBeLessThan(50);
    const lowHp = Math.floor(snorlax.maxhp * full.minPercent / 100) - 1;
    const damaged = { ...snorlax, hp: lowHp };
    expect(calcVerdict(garchomp, damaged, 'Earthquake')).toMatchObject({ n: 1, chance: 1 });
    expect(calcSingleDamageRange(garchomp, damaged, move('Earthquake', 'allAdjacent')).koChance).toBe(calcVerdict(garchomp, damaged, 'Earthquake').text);
  });

  test('every HP the target can stand at reads the calc\'s verdict, up to a 4HKO', () => {
    for (const share of [1, 0.9, 0.75, 0.6, 0.45, 0.4, 0.35, 0.2]) {
      const damaged = { ...snorlax, hp: Math.max(1, Math.round(snorlax.maxhp * share)) };
      const verdict = calcVerdict(garchomp, damaged, 'Earthquake');
      const expected = verdict.n >= 1 && verdict.n <= 4 ? verdict.text : '';
      expect(calcSingleDamageRange(garchomp, damaged, move('Earthquake', 'allAdjacent')).koChance).toBe(expected);
    }
  });

  test('doubles: a spread hit into a damaged target reads the calc\'s verdict for the spread damage', () => {
    const blissey = mon('Blissey');
    const damaged = { ...snorlax, hp: Math.round(snorlax.maxhp * 0.2) };
    const verdict = calcVerdict(garchomp, damaged, 'Earthquake', 'Doubles');
    expect(verdict.n).toBe(1);
    const result = calcSingleDamageRange(garchomp, damaged, move('Earthquake', 'allAdjacent'),
      { gameType: 'Doubles', defenderPartner: blissey, attackerPartnerAlive: true });
    expect(result.koChance).toBe(verdict.text);
  });

  test('a status move has no KO text', () => {
    expect(calcSingleDamageRange(garchomp, snorlax, move('Swords Dance', 'self')).koChance).toBe('');
  });
});
