import type { Battle, Pokemon } from '@pkmn/sim';
import { rollsStall } from '../dex-facts/protect.ts';
import { randomCallMoves } from '../ko-odds.ts';


/** `tera`: the move part clicks Tera (its terastallize token), set only then. */
export type PairAction =
  | { kind: 'move'; slot: number; moveId: string; loc: number | null; tera?: true }
  | { kind: 'switch'; slot: number; to: number }
  | { kind: 'pass'; slot: number };

function parseAction(part: string, slot: number): PairAction {
  const tokens = part.split(/\s+/);
  if (tokens[0] === 'switch') return { kind: 'switch', slot, to: Number(tokens[1]) };
  if (tokens[0] !== 'move') return { kind: 'pass', slot };
  const loc = tokens.slice(2).find(token => /^-?\d+$/.test(token));
  return { kind: 'move', slot, moveId: tokens[1], loc: loc === undefined ? null : Number(loc), ...(tokens.includes('terastallize') ? { tera: true as const } : {}) };
}

/** The choice's slot actions, parts mapped onto the living actives in slot order; null for preview, wait or misfit. */
export function parsePairChoice(battle: Battle, sideIdx: 0 | 1, choice: string): PairAction[] | null {
  const head = choice.split(' > ')[0].trim();
  const first = head.split(/\s+/)[0];
  if (first === 'team' || first === 'wait' || first === 'default') return null;
  const parts = head.split(',').map(part => part.trim()).filter(Boolean);
  const living = [0, 1].filter(slot => {
    const mon = battle.sides[sideIdx].active[slot];
    return !!mon && !mon.fainted;
  });
  if (parts.length !== living.length) return null;
  return parts.map((part, index) => parseAction(part, living[index]));
}

function moverFallback(battle: Battle, mon: Pokemon, moveId: string, foes: number): string | null {
  const move = battle.dex.moves.get(moveId);
  if (mon.status === 'par' || mon.status === 'frz') return `prevented:${mon.status}`;
  if (mon.volatiles['confusion'] || mon.volatiles['attract']) return 'prevented:volatile';
  if (mon.item === 'quickclaw' || mon.ability === 'quickdraw') return 'quick';
  // The Protect family, Endure included, rolls against the stall counter; Wide Guard, Quick Guard, Mat Block do not
  // (test/pair-stall-guard.spec.ts plays every one).
  if (rollsStall(battle.dex, move) && mon.volatiles['stall']) return 'stall';
  if (move.multihit || mon.ability === 'parentalbond') return 'multi-hit';
  if (randomCallMoves(battle.dex).has(move.id)) return 'random-call';
  if (move.target === 'randomNormal' && foes > 1) return 'random-target';
  return null;
}

export function planTimeFallback(battle: Battle, actions: readonly [PairAction[], PairAction[]]): string | null {
  for (const sideIdx of [0, 1] as const) {
    const foes = battle.sides[sideIdx === 0 ? 1 : 0].active.filter(mon => mon && !mon.fainted).length;
    for (const action of actions[sideIdx]) {
      if (action.kind !== 'move') continue;
      const mon = battle.sides[sideIdx].active[action.slot];
      if (!mon || mon.fainted) continue;
      const reason = moverFallback(battle, mon, action.moveId, foes);
      if (reason) return reason;
    }
  }
  return null;
}
