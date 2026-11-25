import type { LoggedAction, LoggedOptions } from './logged-results.ts';
import type { ForcedDie } from './types.ts';

/** The aimed foe (`getRandomTarget`) and the dragged-in body (`getRandomSwitchable`), read from the log. PURE. */

/** A game with one active per side draws none (`options.randomTargets`); a click that named its target draws none. */
export function aimDice(action: LoggedAction, options: LoggedOptions): ForcedDie[] {
  const aimed = action.aim ?? '';
  if (!options.randomTargets || !aimed || aimed === action.slot) return [];
  return [{ name: { slot: action.slot, moveId: action.moveId, kind: 'random-target' }, result: { option: aimed } }];
}

/** A slot dragged twice in one turn takes one answer (the die has one key). */
export function dragDice(actions: readonly LoggedAction[]): ForcedDie[] {
  return actions.flatMap(action => {
    const [slot, ...rest] = (action.dragged ?? '').split(':');
    const name = rest.join(':').trim();
    return slot && name ? [{ name: { slot: slot.trim(), moveId: '', kind: 'drag' as const }, result: { option: name } }] : [];
  });
}
