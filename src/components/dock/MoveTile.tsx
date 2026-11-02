import type { CSSProperties } from 'react';
import type { BranchMoveOption } from '../../hooks/useBranch';
import { typeTileVars } from '../../lib/type-colors';
import { ppTextFor } from '../../lib/move-damage-text';
import type { TileBar } from '../../lib/dock-tile';
import { HitBar } from './HitBar';
import { TypeTag } from './TypeTag';

const PLAYED_TITLE = 'The action played at this position on the line you are viewing.';
const ENGINE_TITLE = "The engine's choice for this slot. It takes the slot when you close the tray, unless you pick something else.";
const FORCED_TITLE = 'This move carries forced dice. Open "Dice · What if" to see them.';

export interface MoveTileProps {
  move: BranchMoveOption;
  /** The type the tile shows (the Tera type under a pressed Tera toggle). */
  type: string;
  bars: TileBar[];
  selected: boolean;
  /** This is the move the viewed line played at this position. */
  wasPlayed: boolean;
  /** Round 84 (A7a): the engine's choice for the open slot, held back until the tray closes. */
  engine?: boolean;
  /** The move is the slot's pick and carries forced dice (round 82). */
  forced: boolean;
  /** The Z-Move the pressed Z toggle turns this move into. */
  zMoveName?: string | null;
  title?: string;
  onPick: () => void;
}

function BarRow({ bar }: { bar: TileBar }) {
  return (
    <span className="ps-tile-bar" title={bar.title}>
      <span className="ps-tile-bar-label">{bar.label}</span>
      <HitBar hp={bar.hp} min={bar.min} max={bar.max} />
      <span className={`ps-tile-bar-value${bar.ko ? ' ps-tile-bar-ko' : ''}`}>{bar.ko || bar.range}</span>
    </span>
  );
}

/** Round 84 (turn dock), style 5: name, type tag and PP, then one hit bar per body the move reaches. A click picks the move on its preselected target. */
export function MoveTile({ move, type, bars, selected, wasPlayed, engine = false, forced, zMoveName, title, onPick }: MoveTileProps) {
  return (
    <button
      type="button"
      className={`ps-movebtn${selected ? ' ps-movebtn-selected' : ''}`}
      style={typeTileVars(type) as CSSProperties}
      aria-pressed={selected}
      disabled={move.disabled || (move.requiresTarget && move.targetOptions.length === 0)}
      title={title}
      onClick={onPick}
    >
      {(wasPlayed || forced || engine) && (
        <span className="ps-tile-flags">
          {wasPlayed && <span className="ps-played-badge" title={PLAYED_TITLE}>played</span>}
          {forced && <span className="ps-forced-badge" title={FORCED_TITLE}>forced</span>}
          {engine && <span className="ps-engine-badge" title={ENGINE_TITLE}>engine</span>}
        </span>
      )}
      <span className="ps-movebtn-name">{move.name}</span>
      <span className="ps-tile-row">
        <TypeTag type={type} />
        <span className="ps-movebtn-pp">{ppTextFor(move)}</span>
      </span>
      {zMoveName && <span className="ps-movebtn-zmove">→ {zMoveName}</span>}
      <span className="ps-tile-bars">
        {bars.length > 0 ? bars.map(bar => <BarRow key={bar.label || 'foe'} bar={bar} />) : <span className="ps-tile-none">No damage</span>}
      </span>
    </button>
  );
}
