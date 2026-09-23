import type { Battle, Pokemon } from '@pkmn/sim';

/**
 * Round 56: a doubles pair choice as slot actions, and the rules that send
 * a cell to the fallback before anything is drawn (spec rule F1): a status
 * that may cancel the action, random priority, a Protect whose success is
 * rolled, a move whose hits or target are random, a move that calls a
 * random move.
 */

export type PairAction =
  | { kind: 'move'; slot: number; moveId: string; loc: number | null }
  | { kind: 'switch'; slot: number; to: number }
  | { kind: 'pass'; slot: number };

const STALL_MOVES = new Set([
  'protect', 'detect', 'endure', 'spikyshield', 'banefulbunker', 'silktrap', 'burningbulwark',
  'kingsshield', 'obstruct', 'maxguard', 'wideguard', 'quickguard',
]);
const RANDOM_CALL_MOVES = new Set(['metronome', 'sleeptalk', 'assist', 'copycat']);

function parseAction(part: string, slot: number): PairAction {
  const tokens = part.split(/\s+/);
  if (tokens[0] === 'switch') return { kind: 'switch', slot, to: Number(tokens[1]) };
  if (tokens[0] !== 'move') return { kind: 'pass', slot };
  const loc = tokens.slice(2).find(token => /^-?\d+$/.test(token));
  return { kind: 'move', slot, moveId: tokens[1], loc: loc === undefined ? null : Number(loc) };
}

/** The slot actions of a choice (its parts map onto the living actives in slot order), or null for team preview, wait or a part count that does not fit. */
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

/** The reason one acting body's dice go beyond the plan, or null. */
function moverFallback(battle: Battle, mon: Pokemon, moveId: string, foes: number): string | null {
  const move = battle.dex.moves.get(moveId);
  if (mon.status === 'par' || mon.status === 'frz') return `prevented:${mon.status}`;
  if (mon.volatiles['confusion'] || mon.volatiles['attract']) return 'prevented:volatile';
  if (mon.item === 'quickclaw' || mon.ability === 'quickdraw') return 'quick';
  if (STALL_MOVES.has(move.id) && mon.volatiles['stall']) return 'stall';
  if (move.multihit || mon.ability === 'parentalbond') return 'multi-hit';
  if (RANDOM_CALL_MOVES.has(move.id)) return 'random-call';
  if (move.target === 'randomNormal' && foes > 1) return 'random-target';
  return null;
}

/** Rule F1: a reason the pair's dice go beyond the plan before anything is drawn, or null. */
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
