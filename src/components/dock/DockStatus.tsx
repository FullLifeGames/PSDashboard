import type { PickerSource } from '../../lib/picker-state';
import { DICE_WAIT_NOTE } from '../branch/DiceChips';
import type { DockModel, DockSlotModel } from './dock-model';

/** Round 77 (user request 28.10.2026): the winner left the top bar for the place of the pickers. */
export function EndedNotice({ winner }: { winner: string | null }) {
  return (
    <div className="ps-branch-ended" role="status">
      {winner ? `${winner} wins this variation.` : 'The variation ended without a winner.'} Go back a turn to play it another way.
    </div>
  );
}

/** What a forced replacement asks of its slot. */
function forcePrompt(slot: DockSlotModel): string {
  return slot.fainted ? `${slot.name} fainted! Choose who to send in:` : `${slot.name} is switching out. Choose who to send in:`;
}

/**
 * Round 84 (turn dock): the strip above the chips: where the choices come from, what a forced replacement asks, which side
 * waits for the other's replacement, the note that dice need the exact position, and the error of the last Execute.
 */
export function DockStatus({ source, acquiringExact, executeError, model, diceOpen }: {
  source?: PickerSource;
  acquiringExact?: boolean;
  executeError: string | null;
  model: DockModel;
  /** The tray's "Dice · What if" section is open. */
  diceOpen: boolean;
}) {
  const slots = [...model.p1, ...model.p2];
  // The side that does not replace waits; the note names the side that does.
  const waitingFor = [...(model.flags.p1Waits ? ['P2'] : []), ...(model.flags.p2Waits ? ['P1'] : [])];
  return (
    <div className="ps-dock-status">
      {source === 'stored' && <span className="ps-dock-source">Choices from the reconstructed position</span>}
      {source === 'snapshot' && (
        <span className="ps-dock-source">
          {acquiringExact
            ? 'Choices approximated · reconstructing the exact position…'
            : 'Choices approximated from the replay; the sim checks legality when you play a move'}
        </span>
      )}
      {diceOpen && source === 'snapshot' && <span className="ps-dice-note" role="note">{DICE_WAIT_NOTE}</span>}
      {slots.filter(slot => slot.forceSwitch).map(slot => (
        <span key={`${slot.side}${slot.slot}`} className="ps-force-switch-note">{forcePrompt(slot)}</span>
      ))}
      {waitingFor.map(side => (
        <span key={side} className="ps-force-switch-note">Waiting for {side} to choose a replacement.</span>
      ))}
      {executeError && <div className="ps-choice-error ps-execute-error" role="alert">{executeError}</div>}
    </div>
  );
}
