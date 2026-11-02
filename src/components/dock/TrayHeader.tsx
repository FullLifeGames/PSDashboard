import { ModifierRow } from './GimmickRow';
import type { DockSlotModel } from './dock-model';

/**
 * Round 84 (turn dock): the head of an open tray: the slot, its body and HP, the gimmick toggles (they edit the slot's pending
 * move), the "Dice · What if" toggle and Done. A slot that must replace a body has neither gimmicks nor "Dice · What if".
 */
export function TrayHeader({ slot, moreOpen, onMore, onDone }: {
  slot: DockSlotModel;
  moreOpen: boolean;
  onMore: () => void;
  onDone: () => void;
}) {
  const { label, name, hpPercent, modifiers, gimmick, forceSwitch } = slot;
  return (
    <div className="ps-tray-head">
      <b className="ps-tray-title">{label} {name}</b>
      <span className="ps-tray-hp">{hpPercent}% HP</span>
      <span className="ps-tray-spacer" />
      {!forceSwitch && gimmick.hasAnyModifier && <ModifierRow label={label} modifiers={modifiers} gimmick={gimmick} />}
      {!forceSwitch && (
        <button type="button" className="ps-btn ps-tray-btn" aria-expanded={moreOpen} onClick={onMore}>
          Dice · What if {moreOpen ? '▴' : '▾'}
        </button>
      )}
      <button type="button" className="ps-btn ps-tray-btn" onClick={onDone}>Done</button>
    </div>
  );
}
