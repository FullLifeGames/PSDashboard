import type { Battle, Pokemon } from '@pkmn/sim';
import { boostedFraction, usableSlots, type PairThreat } from './threat.ts';

/**
 * The field pair (round 69, T42 part 2): what two actives do together that a
 * 1v1 race does not see. Doubles only, every cell 0 in singles. A side's two
 * actives focus one foe (pairFocus) or one of them covers the other with a
 * redirection move (pairRedirect). Read from the threat cache like the sweep
 * cells; the weights are 0 until a fit prices them.
 */

interface FieldPairCells { focus: number; redirect: number }

interface RedirectDex {
  moves: { get(id: string): { target: string; volatileStatus?: string } };
  conditions: { get(id: string): object };
}

/**
 * A move that draws the foes' single-target hits to its user (Follow Me, Rage
 * Powder): a self-targeted move whose volatile condition redirects foe moves.
 * The sweep of test/field-pair.spec.ts plays every self-targeted move with a
 * volatile in the simulator against this reading.
 */
export function redirectsFoes(dex: Pick<RedirectDex, 'conditions'>, move: { target: string; volatileStatus?: string }): boolean {
  return move.target === 'self' && !!move.volatileStatus && 'onFoeRedirectTarget' in dex.conditions.get(move.volatileStatus);
}

/** The living actives of one side. */
const fieldOf = (battle: Battle, sideIndex: number): Pokemon[] =>
  battle.sides[sideIndex].active.filter((mon): mon is Pokemon => !!mon && !mon.fainted && mon.hp > 0);

const hpFraction = (mon: Pokemon): number => mon.hp / mon.maxhp;

/**
 * pairFocus: a foe on the field that neither active KOs alone and both KO
 * together contributes the second attacker's marginal share of the foe's HP
 * (the part of the foe the first attacker leaves), over the foes on the field.
 */
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

/**
 * pairRedirect: for each living active with a redirection move to click, its
 * partner's best share of a foe's current HP (capped at 1) at the redirector's
 * HP fraction: the damage the redirection keeps on the field.
 */
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

/** One side's field-pair cells (see EvalFeatures.pairFocus). */
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
