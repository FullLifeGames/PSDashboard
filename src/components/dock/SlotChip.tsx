import type { CSSProperties } from 'react';
import { chipAside } from '../../lib/dock-chip';
import { useReplayRules } from '../../lib/replay-rules';
import { spriteUrl } from '../../lib/sprite-url';
import { typeTileVars } from '../../lib/type-colors';
import { chipKey } from '../../hooks/useTrayState';
import type { DockSlotModel } from './dock-model';
import { TypeTag } from './TypeTag';

/**
 * Round 84 (turn dock): one slot's chip: its label, the body and its HP, and the slot's choice with where it came from. A click
 * opens the slot's tray. An empty chip says why it is empty. The chip keeps its box: the text clips, never wraps.
 * Round 84 (A7b, ruling 8a): the chip takes the tile's type edge on the left (`typeTileVars` of the type the tile shows) and, at its
 * right across both lines, the move's type tag or the sprite of the body that comes in. An empty chip has neither.
 */
export function SlotChip({ slot, open, onToggle }: { slot: DockSlotModel; open: boolean; onToggle: () => void }) {
  const { pending, origin } = slot;
  const rules = useReplayRules();
  const aside = chipAside(pending, slot.moves, slot.switches, slot.gimmick.modifier === 'terastallize');
  return (
    <button
      type="button"
      className="ps-dock-chip"
      data-chip={chipKey(slot.side, slot.slot)}
      data-origin={origin ?? undefined}
      data-empty={pending ? undefined : 'true'}
      data-aside={aside ? 'true' : undefined}
      data-forced={slot.forceSwitch ? 'true' : undefined}
      style={aside?.kind === 'type' ? typeTileVars(aside.type) as CSSProperties : undefined}
      aria-expanded={open}
      disabled={slot.nobodyLeft}
      inert={slot.waits}
      onClick={onToggle}
    >
      <span className="ps-dock-label">{slot.label}</span>
      {/* The spaces keep the chip's accessible name readable: grid items lay out without them. */}
      {' '}
      <span className="ps-dock-mon">{slot.name} · {slot.hpPercent}%</span>
      {' '}
      <span className="ps-dock-pick" data-wait={!pending ? slot.wait ?? undefined : undefined}>
        {pending ? slot.pickText : slot.placeholder}
        {origin && ' '}
        {origin && <span className="ps-dock-origin">{origin}</span>}
      </span>
      {aside && (
        <span className="ps-dock-aside" aria-hidden="true">
          {aside.kind === 'type' ? <TypeTag type={aside.type} /> : <img className="ps-dock-sprite" src={spriteUrl(aside.species, rules)} alt="" />}
        </span>
      )}
    </button>
  );
}
