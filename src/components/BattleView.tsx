import type { TurnSnapshot } from '../types';
import { SideView } from './SideView';
import { FieldView } from './FieldView';

interface Props {
  snapshot: TurnSnapshot;
}

export function BattleView({ snapshot }: Props) {
  return (
    <div className="bg-[#16213e] rounded-xl p-6">
      {/* Opponent (p2) at top */}
      <SideView side={snapshot.p2} isOpponent />

      {/* Field conditions in the middle */}
      <FieldView field={snapshot.field} />

      {/* Divider */}
      <div className="border-t border-[#1a1a5e] my-2" />

      {/* Player (p1) at bottom */}
      <SideView side={snapshot.p1} />
    </div>
  );
}
