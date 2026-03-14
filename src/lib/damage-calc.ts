import { Generations, Pokemon, Move, Field, calculate } from '@smogon/calc';
import type { SimPokemonInfo, BranchMoveOption } from '../hooks/useBranch';

const gen = Generations.get(9);

export interface DamageResult {
  moveName: string;
  minPercent: number;
  maxPercent: number;
  range: string;
  koChance: string;
}

/**
 * Calculate damage ranges for all available moves of an attacker against a defender.
 */
export function calcDamageRanges(
  attacker: SimPokemonInfo,
  defender: SimPokemonInfo,
  moves: BranchMoveOption[],
): DamageResult[] {
  try {
    const atkPoke = new Pokemon(gen, attacker.species, {
      level: attacker.level,
      ability: attacker.ability || undefined,
      item: attacker.item || undefined,
      boosts: attacker.boosts as any,
      curHP: attacker.hp,
      status: (attacker.status || undefined) as any,
    });

    const defPoke = new Pokemon(gen, defender.species, {
      level: defender.level,
      ability: defender.ability || undefined,
      item: defender.item || undefined,
      boosts: defender.boosts as any,
      curHP: defender.hp,
      status: (defender.status || undefined) as any,
    });

    const field = new Field();

    return moves.map(m => {
      try {
        const move = new Move(gen, m.name);
        const result = calculate(gen, atkPoke, defPoke, move, field);
        const dmg = result.damage;

        let minDmg = 0;
        let maxDmg = 0;
        if (Array.isArray(dmg)) {
          const flat = dmg.flat();
          minDmg = Math.min(...flat.map(Number));
          maxDmg = Math.max(...flat.map(Number));
        } else {
          minDmg = maxDmg = Number(dmg);
        }

        const minPct = defender.maxhp > 0 ? Math.round(minDmg / defender.maxhp * 1000) / 10 : 0;
        const maxPct = defender.maxhp > 0 ? Math.round(maxDmg / defender.maxhp * 1000) / 10 : 0;

        let koChance = '';
        if (maxPct >= 100) {
          if (minPct >= 100) {
            koChance = 'guaranteed OHKO';
          } else {
            const ohkoProb = estimateKoProb(dmg, defender.hp);
            koChance = `${ohkoProb}% OHKO`;
          }
        } else if (maxPct >= 50) {
          koChance = 'possible 2HKO';
        } else if (maxPct >= 33) {
          koChance = 'possible 3HKO';
        }

        return {
          moveName: m.name,
          minPercent: minPct,
          maxPercent: maxPct,
          range: `${minPct}% - ${maxPct}%`,
          koChance,
        };
      } catch {
        return {
          moveName: m.name,
          minPercent: 0,
          maxPercent: 0,
          range: '—',
          koChance: '',
        };
      }
    });
  } catch {
    return moves.map(m => ({
      moveName: m.name,
      minPercent: 0,
      maxPercent: 0,
      range: '—',
      koChance: '',
    }));
  }
}

function estimateKoProb(dmg: number | number[] | number[][], targetHp: number): number {
  if (!Array.isArray(dmg)) return Number(dmg) >= targetHp ? 100 : 0;
  const flat = dmg.flat().map(Number);
  const koCount = flat.filter(d => d >= targetHp).length;
  return Math.round(koCount / flat.length * 100);
}
