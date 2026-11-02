import type { BranchMoveOption } from '../../hooks/useBranch';
import type { DamageResult } from '@fulllifegames/eval-engine';
import { koVerdict, shortRange } from '../../lib/move-damage-text';
import { HitBar } from './HitBar';

/**
 * Round 84 (turn dock): the targets of the slot's pending move, each with the target's HP bar under one hit. A press moves the
 * pick onto that target; the pressed one is the pick's own.
 */
export function TargetRow({ move, selectedLoc, targets, onPick }: {
  move: BranchMoveOption;
  selectedLoc: number | undefined;
  targets: Record<string, DamageResult | undefined>;
  onPick: (targetLoc: number) => void;
}) {
  return (
    <div className="ps-target-row" role="group" aria-label={`Target for ${move.name}`}>
      {move.targetOptions.map(target => {
        const damage = targets[`${move.slot}:${target.targetLoc}`];
        const hit = damage && damage.maxPercent > 0 ? damage : null;
        const selected = selectedLoc === target.targetLoc;
        return (
          <button
            key={target.targetLoc}
            type="button"
            onClick={() => onPick(target.targetLoc)}
            disabled={move.disabled}
            className={`ps-target-btn ${selected ? 'ps-target-btn-selected' : ''}`}
            title={`${move.name} into ${target.name} (${target.hpPercent}%)`}
            aria-pressed={selected}
          >
            <span className="ps-target-main">
              <span className="ps-target-slot">{target.label}</span>
              {/* The spaces keep the button's text readable ("P2A Bulbasaur 61%"): flex items lay out without them. */}
              {' '}
              <span className="ps-target-name">{target.name}</span>
              {' '}
              <span className="ps-target-hp">{target.hpPercent}%</span>
            </span>
            <HitBar hp={target.hpPercent} min={hit?.minPercent ?? 0} max={hit?.maxPercent ?? 0} />
            <span className="ps-target-meta">
              {hit ? `${shortRange(hit.minPercent, hit.maxPercent)}${hit.koChance ? ` · ${koVerdict(hit.koChance)}` : ''}` : 'no damage'}
            </span>
          </button>
        );
      })}
    </div>
  );
}
