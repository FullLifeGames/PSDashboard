import type { CSSProperties } from 'react';
import { toId } from '@fulllifegames/replay-core';
import { typeTileVars } from '../../lib/type-colors';
import { chipKey } from '../../hooks/useTrayState';
import type { DockSlotModel } from './dock-model';

/**
 * Round 84 (turn dock): one slot's chip: its label, the body and its HP, and the slot's choice with where it came from. A click
 * opens the slot's tray. An empty chip says why it is empty. The chip keeps its box: the text clips, never wraps.
 */
export function SlotChip({ slot, open, onToggle }: { slot: DockSlotModel; open: boolean; onToggle: () => void }) {
  const { pending, origin } = slot;
  const picked = pending?.kind === 'move' ? slot.moves.find(move => toId(move.name) === pending.moveId) : undefined;
  return (
    <button
      type="button"
      className="ps-dock-chip"
      data-chip={chipKey(slot.side, slot.slot)}
      data-origin={origin ?? undefined}
      data-empty={pending ? undefined : 'true'}
      style={picked ? typeTileVars(picked.type) as CSSProperties : undefined}
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
      <span className="ps-dock-pick">
        {pending ? slot.pickText : slot.placeholder}
        {origin && ' '}
        {origin && <span className="ps-dock-origin">{origin}</span>}
      </span>
    </button>
  );
}
