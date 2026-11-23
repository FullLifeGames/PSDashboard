import type { LoggedAction, LoggedOptions } from './logged-results.ts';
import type { ForcedDie } from './types.ts';

/** The two draws that sample a body, read from the log: the aimed foe (`getRandomTarget`) and the dragged-in body (`getRandomSwitchable`). PURE. */

/**
 * The foe the draw gave: the slot the `|move|` line names as the aim (the line of a spread move names the drawn foe first). A game with
 * one active per side draws none (`options.randomTargets`), and a click that named its target draws nothing, so forcing its die changes nothing.
 */
export function aimDice(action: LoggedAction, options: LoggedOptions): ForcedDie[] {
  const aimed = action.aim ?? '';
  if (!options.randomTargets || !aimed || aimed === action.slot) return [];
  return [{ name: { slot: action.slot, moveId: action.moveId, kind: 'random-target' }, result: { option: aimed } }];
}

/** The body each `|drag|` line brought in, answered by the body's name; a slot dragged twice in one turn takes one answer (the die has one key). */
export function dragDice(actions: readonly LoggedAction[]): ForcedDie[] {
  return actions.flatMap(action => {
    const [slot, ...rest] = (action.dragged ?? '').split(':');
    const name = rest.join(':').trim();
    return slot && name ? [{ name: { slot: slot.trim(), moveId: '', kind: 'drag' as const }, result: { option: name } }] : [];
  });
}
