import type { BranchSlotChoice } from '@fulllifegames/eval-engine';
import type { DiceViews } from '../../hooks/useDiceView';
import type { DockSlotModel } from './dock-model';
import { MoveTiles } from './MoveTiles';
import { SwitchRow } from './SwitchRow';
import { TrayHeader } from './TrayHeader';
import { TrayMore } from './TrayMore';

export function SlotTray({ slot, hpByLabel, gen, format, moreOpen, diceViews, onChoice, onHypotheticalMove, onMore, onBackToEngine, onDone }: {
  slot: DockSlotModel;
  hpByLabel: Record<string, number>;
  gen: number;
  format: string;
  moreOpen: boolean;
  diceViews: DiceViews;
  onChoice: (choice: BranchSlotChoice) => void;
  onHypotheticalMove: (params: { species: string; move: string; replace: string | null }) => void;
  onMore: () => void;
  onBackToEngine?: () => void;
  onDone: () => void;
}) {
  return (
    <div className={`ps-tray${moreOpen ? ' ps-tray-roomy' : ''}`} role="region" aria-label={`Choices for ${slot.label} ${slot.name}`}>
      <TrayHeader slot={slot} moreOpen={moreOpen} onMore={onMore} onBackToEngine={onBackToEngine} onDone={onDone} />
      {!slot.forceSwitch && slot.moves.length > 0 && <MoveTiles slot={slot} hpByLabel={hpByLabel} onChoice={onChoice} />}
      {slot.switches.length > 0 && (
        <div className="ps-tray-line">
          <span className="ps-tray-label">Switch to</span>
          <SwitchRow
            side={slot.side}
            activeName={slot.name}
            switches={slot.switches}
            pending={slot.pending}
            blockedSwitchKeys={slot.blockedSwitchKeys}
            played={slot.played}
            deferred={slot.deferred}
            onPick={onChoice}
          />
        </div>
      )}
      {moreOpen && !slot.forceSwitch && (
        <TrayMore slot={slot} gen={gen} format={format} diceViews={diceViews} onChoice={onChoice} onHypotheticalMove={onHypotheticalMove} />
      )}
    </div>
  );
}
