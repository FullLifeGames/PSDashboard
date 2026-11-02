import { toId } from '@fulllifegames/replay-core';
import type { BranchSlotChoice } from '@fulllifegames/eval-engine';
import { moveChoiceFor, type ChoiceContext } from '../branch/choice-context';
import { tileBars, tileTarget } from '../../lib/dock-tile';
import { fullMoveTitle, shownType } from '../../lib/move-damage-text';
import type { DockSlotModel } from './dock-model';
import { MoveTile } from './MoveTile';
import { TargetRow } from './TargetRow';

/** The line under the tiles that says what the bars mean. */
function BarLegend() {
  return (
    <div className="ps-tile-legend">
      <span><i className="ps-legend-swatch ps-legend-solid" />HP left after the highest roll</span>
      <span><i className="ps-legend-swatch ps-legend-striped" />the roll decides</span>
      <span><i className="ps-legend-swatch ps-legend-ghost" />HP even the lowest roll takes</span>
    </div>
  );
}

/**
 * Round 84 (turn dock): the move tiles of an open tray, the targets of the pending move below them, and the legend of the bars.
 * A tile click picks its move on the preselected target, with the gimmick the slot's pending move holds (`ctx.modifier`).
 */
export function MoveTiles({ slot, hpByLabel, onChoice }: {
  slot: DockSlotModel;
  hpByLabel: Record<string, number>;
  onChoice: (choice: BranchSlotChoice) => void;
}) {
  const { moves, pending, gimmick, modifiers, side, played, deferred } = slot;
  const ctx: ChoiceContext = { modifier: gimmick.modifier, modifierAvailable: gimmick.modifierAvailable, moves, modifiers };
  const pendingMove = pending?.kind === 'move' ? pending : null;
  const playedMove = played?.kind === 'move' ? played : null;
  const engineMove = deferred?.kind === 'move' ? deferred : null;
  const picked = pendingMove ? moves.find(move => toId(move.name) === pendingMove.moveId) : undefined;
  const entries = moves.map((move, index) => {
    const selected = pendingMove?.moveId === toId(move.name);
    const playedLoc = playedMove && toId(playedMove.name) === toId(move.name) ? playedMove.targetLoc : null;
    const chosenLoc = selected ? pendingMove.targetLoc : undefined;
    const bars = tileBars({
      move, side, dmg: slot.dmg[index], spread: slot.spread[move.slot], targets: slot.targets, hpByLabel, foeHp: slot.foeHp, chosenLoc, playedLoc,
    });
    return { move, index, selected, playedLoc, chosenLoc, bars };
  });
  const tiles = entries.map(({ move, index, selected, playedLoc, chosenLoc, bars }) => (
    <MoveTile
      key={move.slot}
      move={move}
      type={shownType(move, ctx.modifier === 'terastallize')}
      bars={bars}
      selected={selected}
      wasPlayed={playedMove !== null && toId(move.name) === toId(playedMove.name)}
      engine={engineMove !== null && toId(move.name) === engineMove.moveId}
      forced={selected && (pendingMove?.dice?.length ?? 0) > 0}
      zMoveName={ctx.modifier === 'zmove' ? modifiers.zMoves[move.slot - 1] ?? null : null}
      title={bars.length > 0 ? bars.map(bar => bar.title).join(' · ') : fullMoveTitle(slot.dmg[index])}
      onPick={() => onChoice(moveChoiceFor(move, chosenLoc ?? tileTarget(move, side, slot.targets, playedLoc), ctx))}
    />
  ));
  return (
    <>
      <div className="ps-tile-grid">{tiles}</div>
      {picked && picked.targetOptions.length > 0 && pendingMove && (
        <TargetRow
          move={picked}
          selectedLoc={pendingMove.targetLoc}
          targets={slot.targets}
          onPick={targetLoc => onChoice(moveChoiceFor(picked, targetLoc, ctx))}
        />
      )}
      {entries.some(entry => entry.bars.length > 0) && <BarLegend />}
    </>
  );
}
