import { ModifierRow } from './GimmickRow';
import type { DockSlotModel } from './dock-model';

/** The head of an open tray; a slot that must replace a body has neither gimmick toggles nor "Dice · What if". */
export function TrayHeader({ slot, moreOpen, onMore, onBackToEngine, onDone }: {
  slot: DockSlotModel;
  moreOpen: boolean;
  onMore: () => void;
  onBackToEngine?: () => void;
  onDone: () => void;
}) {
  const { label, name, hpPercent, modifiers, gimmick, forceSwitch } = slot;
  return (
    <div className="ps-tray-head">
      <b className="ps-tray-title">{label} {name}</b>
      <span className="ps-tray-hp">{hpPercent}% HP</span>
      <span className="ps-tray-spacer" />
      {!forceSwitch && gimmick.hasAnyModifier && <ModifierRow label={label} modifiers={modifiers} gimmick={gimmick} />}
      {onBackToEngine && <button type="button" className="ps-btn ps-tray-btn" onClick={onBackToEngine}>Back to the engine's pick</button>}
      {!forceSwitch && (
        <button type="button" className="ps-btn ps-tray-btn" aria-expanded={moreOpen} onClick={onMore}>
          Dice · What if {moreOpen ? '▴' : '▾'}
        </button>
      )}
      <button type="button" className="ps-btn ps-tray-btn" onClick={onDone}>Done</button>
    </div>
  );
}
