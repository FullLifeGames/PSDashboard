import type { CSSProperties } from 'react';
import type { TrayOpen } from '../../hooks/useTrayState';
import type { DockModel, DockSlotModel, Side } from './dock-model';
import { SlotChip } from './SlotChip';

/**
 * Round 84 (turn dock): the chips in rows. Singles put both sides' chip in one row, doubles and VGC put P1's slots in the upper
 * row and P2's in the lower one, so a slot keeps its column.
 */
export function DockRows({ model, open, onToggle }: {
  model: DockModel;
  open: TrayOpen | null;
  onToggle: (side: Side, slot: number) => void;
}) {
  const singles = model.p1.length <= 1 && model.p2.length <= 1;
  const rows: { key: string; slots: DockSlotModel[] }[] = singles
    ? [{ key: 'both', slots: [...model.p1, ...model.p2] }]
    : [{ key: 'p1', slots: model.p1 }, { key: 'p2', slots: model.p2 }];
  return (
    <div className="ps-dock-rows">
      {rows.map(row => (
        <div key={row.key} className="ps-dock-row" style={{ '--ps-dock-cols': Math.max(row.slots.length, 1) } as CSSProperties}>
          {row.slots.map(slot => (
            <SlotChip
              key={`${slot.side}${slot.slot}`}
              slot={slot}
              open={open?.side === slot.side && open.slot === slot.slot}
              onToggle={() => onToggle(slot.side, slot.slot)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
