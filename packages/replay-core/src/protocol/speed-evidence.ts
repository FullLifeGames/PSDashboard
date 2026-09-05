import type { ParserState } from './parser-state.ts';

/**
 * Cleanliness of speed evidence: everything that explains a move order
 * without Speed (round 37). A |move| line another effect produced (Dancer,
 * Instruct, a bounced or snatched status move) is not the mover's own
 * action, a Pursuit on a switching target fires at the switch, and After
 * You or Quash rearrange a target's slot for the turn.
 */

const NOT_A_RACE = /\[from\]\s?(?:ability: |move: )?(?:Dancer|Instruct|Magic Bounce|Magic Coat|Snatch|Pursuit)/;

/** A move line that was not this mover's own place in the turn order. */
export function foreignAction(line: string): boolean {
  return NOT_A_RACE.test(line);
}

/**
 * After You and Quash mark their target as rearranged for the turn; a
 * Quick Claw, Quick Draw, or Custap Berry activation marks the holder as
 * having acted early.
 */
export function noteActivation(state: ParserState, line: string): void {
  const parts = line.split('|');
  const ident = parts[2] ?? '';
  const effect = parts[3] ?? '';
  if (!ident) return;
  if (line.startsWith('|-activate|') && /^move: (?:After You|Quash)$/.test(effect)) state.reordered.add(ident);
  if (line.startsWith('|-activate|') && /^(?:item: Quick Claw|ability: Quick Draw)$/.test(effect)) state.quickActed.add(ident);
  if (line.startsWith('|-enditem|') && effect === 'Custap Berry') state.quickActed.add(ident);
}
