import type { BranchMoveModifier, BranchSlotModifiers } from '@fulllifegames/eval-engine';
import type { Gimmick } from '../../hooks/useSideControlsState';

/** What the partner holding a gimmick does this turn, for the blocked toggle's title. */
const HELD_ACTION: Record<BranchMoveModifier, string> = {
  terastallize: 'terastallizes',
  mega: 'mega evolves',
  ultra: 'ultra bursts',
  zmove: 'uses a Z-Move',
};

function ModifierToggle({ label, kind, gimmick }: { label: string; kind: BranchMoveModifier; gimmick: Gimmick }) {
  const active = gimmick.modifier === kind;
  // A side takes each gimmick once per turn: a partner that holds it blocks this toggle (T124).
  const holder = active ? undefined : gimmick.heldBy[kind];
  return (
    <button
      type="button"
      className={`ps-modifier-toggle ${active ? 'ps-modifier-toggle-active' : ''}`}
      aria-pressed={active}
      disabled={!!holder}
      title={holder ? `${holder} already ${HELD_ACTION[kind]} this turn.` : undefined}
      onClick={() => gimmick.toggle(kind)}
    >
      {label}
    </button>
  );
}

/**
 * Round 84 (turn dock): the gimmick toggles of a slot, in the dock's tray header. A toggle edits the slot's pending move
 * (`gimmick.toggle`, wired through `edit`); a slot with no move pick arms the next pick instead.
 */
export function ModifierRow({ label, modifiers, gimmick }: { label: string; modifiers: BranchSlotModifiers; gimmick: Gimmick }) {
  return (
    <div className="ps-modifier-row" role="group" aria-label={`Battle gimmicks for ${label}`}>
      {modifiers.teraType && <ModifierToggle label={`Tera (${modifiers.teraType})`} kind="terastallize" gimmick={gimmick} />}
      {modifiers.canMegaEvo && <ModifierToggle label="Mega Evolve" kind="mega" gimmick={gimmick} />}
      {modifiers.canUltraBurst && <ModifierToggle label="Ultra Burst" kind="ultra" gimmick={gimmick} />}
      {gimmick.hasZMoves && <ModifierToggle label="Z-Move" kind="zmove" gimmick={gimmick} />}
    </div>
  );
}
