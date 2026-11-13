import type { LoggedAction, LoggedOptions } from './logged-results.ts';
import type { ForcedDie } from './types.ts';

/**
 * Round 89 (#137): the two draws that sample a body, read from the log. The simulator picks the foe a move is aimed at (`getRandomTarget`)
 * and the bench body a drag brings in (`getRandomSwitchable`) with a `sample`; the log shows both. PURE, like `logged-results.ts`,
 * whose actions it reads.
 */

/**
 * The foe the draw gave: the slot the `|move|` line names as the aim (the line of a spread move names the drawn foe first). A game with
 * one active per side draws none (`options.randomTargets`), and a click that named its target draws nothing: its die is never drawn, so
 * forcing it changes nothing.
 */
export function aimDice(action: LoggedAction, options: LoggedOptions): ForcedDie[] {
  const aimed = action.aim ?? '';
  if (!options.randomTargets || !aimed || aimed === action.slot) return [];
  return [{ name: { slot: action.slot, moveId: action.moveId, kind: 'random-target' }, result: { option: aimed } }];
}

/**
 * The body each `|drag|` line brought in: a die of the slot dragged out, answered by the body's name (the item of the simulator's
 * `sample` over the bench is the body). A slot dragged twice in one turn takes one answer (the die has one key).
 */
export function dragDice(actions: readonly LoggedAction[]): ForcedDie[] {
  return actions.flatMap(action => {
    const [slot, ...rest] = (action.dragged ?? '').split(':');
    const name = rest.join(':').trim();
    return slot && name ? [{ name: { slot: slot.trim(), moveId: '', kind: 'drag' as const }, result: { option: name } }] : [];
  });
}
