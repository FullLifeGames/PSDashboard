import type { Battle, Pokemon } from '@pkmn/sim';
import { boostedFraction, usableSlots, type PairThreat } from './threat.ts';

interface FieldPairCells { focus: number; redirect: number }

interface RedirectDex {
  moves: { get(id: string): { target: string; volatileStatus?: string } };
  conditions: { get(id: string): object };
}

/** A self-targeted move whose volatile redirects foe moves (Follow Me, Rage Powder); field-pair.spec.ts plays each. */
export function redirectsFoes(dex: Pick<RedirectDex, 'conditions'>, move: { target: string; volatileStatus?: string }): boolean {
  return move.target === 'self' && !!move.volatileStatus && 'onFoeRedirectTarget' in dex.conditions.get(move.volatileStatus);
}

const fieldOf = (battle: Battle, sideIndex: number): Pokemon[] =>
  battle.sides[sideIndex].active.filter((mon): mon is Pokemon => !!mon && !mon.fainted && mon.hp > 0);

const hpFraction = (mon: Pokemon): number => mon.hp / mon.maxhp;

// pairFocus: a foe that neither active KOs alone and both KO together adds the second attacker's marginal HP share.
function focusCell(mine: Pokemon[], foes: Pokemon[], threat: (attacker: Pokemon, defender: Pokemon) => PairThreat): number {
  let focus = 0;
  for (const foe of foes) {
    const foeHp = hpFraction(foe);
    const hits = mine.map(mon => boostedFraction(threat(mon, foe), mon, foe));
    const best = Math.max(...hits);
    const total = hits.reduce((sum, hit) => sum + hit, 0);
    if (best < foeHp && total >= foeHp) focus += (1 - best / foeHp) / foes.length;
  }
  return focus;
}

// pairRedirect: per redirector, its partner's best share of a foe's HP (capped at 1) at the redirector's HP fraction.
function redirectCell(mine: Pokemon[], foes: Pokemon[], battle: Battle, threat: (attacker: Pokemon, defender: Pokemon) => PairThreat): number {
  let redirect = 0;
  for (const redirector of mine) {
    const redirects = usableSlots(redirector).some(slot => redirectsFoes(battle.dex, battle.dex.moves.get(slot.id)));
    if (!redirects) continue;
    for (const partner of mine) {
      if (partner === redirector) continue;
      let share = 0;
      for (const foe of foes) {
        share = Math.max(share, Math.min(1, boostedFraction(threat(partner, foe), partner, foe) / hpFraction(foe)));
      }
      redirect += hpFraction(redirector) * share;
    }
  }
  return redirect;
}

export function fieldPairCells(
  sideIndex: 0 | 1,
  battle: Battle,
  threat: (attacker: Pokemon, defender: Pokemon) => PairThreat,
): FieldPairCells {
  const cells: FieldPairCells = { focus: 0, redirect: 0 };
  if (battle.gameType !== 'doubles') return cells;
  const mine = fieldOf(battle, sideIndex);
  const foes = fieldOf(battle, 1 - sideIndex);
  if (mine.length < 2 || foes.length === 0) return cells;
  cells.focus = focusCell(mine, foes, threat);
  cells.redirect = redirectCell(mine, foes, battle, threat);
  return cells;
}
