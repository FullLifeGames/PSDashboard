import type { BranchSlotChoice } from '@fulllifegames/eval-engine';
import type { DiceViews } from '../../hooks/useDiceView';
import type { DockSlotModel } from './dock-model';
import { MoveTiles } from './MoveTiles';
import { SwitchRow } from './SwitchRow';
import { TrayHeader } from './TrayHeader';
import { TrayMore } from './TrayMore';

/**
 * Round 84 (turn dock): the tray of one slot, above the dock: header, move tiles with their targets, the bench, and behind
 * "Dice · What if" the dice, the What-if loader and all choices. A slot that must replace a body shows only the bench.
 */
export function SlotTray({ slot, hpByLabel, gen, moreOpen, diceViews, onChoice, onHypotheticalMove, onMore, onDone }: {
  slot: DockSlotModel;
  hpByLabel: Record<string, number>;
  gen: number;
  moreOpen: boolean;
  diceViews: DiceViews;
  onChoice: (choice: BranchSlotChoice) => void;
  onHypotheticalMove: (params: { species: string; move: string; replace: string | null }) => void;
  onMore: () => void;
  onDone: () => void;
}) {
  return (
    <div className="ps-tray" role="region" aria-label={`Choices for ${slot.label} ${slot.name}`}>
      <TrayHeader slot={slot} moreOpen={moreOpen} onMore={onMore} onDone={onDone} />
      {!slot.forceSwitch && slot.moves.length > 0 && <MoveTiles slot={slot} hpByLabel={hpByLabel} onChoice={onChoice} />}
      {slot.switches.length > 0 && (
        <div className="ps-tray-line">
          <span className="ps-tray-label">Switch to</span>
          <SwitchRow
            activeName={slot.name}
            switches={slot.switches}
            pending={slot.pending}
            blockedSwitchKeys={slot.blockedSwitchKeys}
            played={slot.played}
            onPick={onChoice}
          />
        </div>
      )}
      {moreOpen && !slot.forceSwitch && (
        <TrayMore slot={slot} gen={gen} diceViews={diceViews} onChoice={onChoice} onHypotheticalMove={onHypotheticalMove} />
      )}
    </div>
  );
}
