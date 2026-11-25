import type { CSSProperties } from 'react';
import type { TrayOpen } from '../../hooks/useTrayState';
import type { DockModel, DockSlotModel, Side } from './dock-model';
import { SlotChip } from './SlotChip';

export function DockRows({ model, open, onToggle, nearSide = 'p1' }: {
  model: DockModel;
  open: TrayOpen | null;
  onToggle: (side: Side, slot: number) => void;
  nearSide?: Side;
}) {
  const singles = model.p1.length <= 1 && model.p2.length <= 1;
  const far: Side = nearSide === 'p1' ? 'p2' : 'p1';
  const rows: { key: string; slots: DockSlotModel[] }[] = singles
    ? [{ key: 'both', slots: [...model[nearSide], ...model[far]] }]
    : [{ key: nearSide, slots: model[nearSide] }, { key: far, slots: model[far] }];
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
