import type { BranchMoveOption, BranchSwitchOption } from '../../hooks/useBranch';
import { switchOptionKey } from '@fulllifegames/eval-engine';
import { toId } from '@fulllifegames/replay-core';
import { ComboBox } from '../ComboBox';
import { displayName } from '../../lib/branch-history';
import { STAND_IN_MARK, useIsGuessed, type GuessedSide } from '../../lib/stand-in-mark';

/**
 * Round 84 (turn dock): "All choices" and "What if it had…", not restyled since the old panel. The dock's tray shows them
 * under "Dice · What if".
 */

export interface WhatIfState {
  whatIfMove: string;
  setWhatIfMove: (value: string) => void;
  whatIfReplace: string | null;
  setWhatIfReplace: (value: string | null) => void;
}

export function ChoicePicker({ side, label, moves, switches, blockedSwitchKeys, onPick }: {
  /** The side of the slot: its stand-ins carry the marker of the stats panel (round 88, #101). */
  side: GuessedSide;
  label: string; moves: BranchMoveOption[]; switches: BranchSwitchOption[]; blockedSwitchKeys: Set<string>; onPick: (value: string) => void;
}) {
  const isGuessed = useIsGuessed();
  return (
    <select
      className="ps-input"
      aria-label={`Choice picker for ${label}`}
      value=""
      onChange={event => onPick(event.target.value)}
    >
      <option value="" disabled>All choices…</option>
      <optgroup label="Moves">
        {moves.filter(move => !move.disabled).flatMap(move => (
          move.targetOptions.length > 0
            ? move.targetOptions.map(target => (
              <option key={`m-${move.slot}-${target.targetLoc}`} value={`move:${move.slot}:${target.targetLoc}`}>
                {move.name} → {target.label} {target.name}
              </option>
            ))
            : [
              <option key={`m-${move.slot}`} value={`move:${move.slot}`}>
                {move.name}
              </option>,
            ]
        ))}
      </optgroup>
      {switches.length > 0 && (
        <optgroup label="Switch to">
          {switches.map(sw => (
            <option
              key={`s-${sw.slot}`}
              value={`switch:${sw.slot}`}
              disabled={!!sw.trapped || blockedSwitchKeys.has(switchOptionKey(sw))}
            >
              Switch: {displayName(sw.name, sw.species)} ({sw.hpPercent}% HP){isGuessed(side, sw.species) ? ` · ${STAND_IN_MARK}` : ''}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

export function WhatIfRow({ label, moves, activeSpecies, movePool, whatIf, onHypotheticalMove }: {
  label: string; moves: BranchMoveOption[]; activeSpecies: string; movePool: string[]; whatIf: WhatIfState;
  onHypotheticalMove: (params: { species: string; move: string; replace: string | null }) => void;
}) {
  const { whatIfMove, setWhatIfMove, whatIfReplace, setWhatIfReplace } = whatIf;
  return (
    <>
      <ComboBox
        options={movePool.filter(name => !moves.some(known => toId(known.name) === toId(name)))}
        value={whatIfMove}
        onChange={setWhatIfMove}
        onSelect={setWhatIfMove}
        placeholder="What if it had…"
        ariaLabel={`Hypothetical move for ${label}`}
      />
      {moves.length >= 4 && (
        <select
          className="ps-input"
          aria-label={`Replaced move for ${label}`}
          value={whatIfReplace ?? moves[moves.length - 1].name}
          onChange={event => setWhatIfReplace(event.target.value)}
          style={{ flex: '0 1 110px' }}
        >
          {moves.map(known => <option key={known.slot} value={known.name}>{known.name}</option>)}
        </select>
      )}
      <button
        type="button"
        className="ps-btn"
        disabled={
          !whatIfMove.trim() ||
          !movePool.some(name => toId(name) === toId(whatIfMove))
        }
        onClick={() => {
          onHypotheticalMove({
            species: activeSpecies,
            move: movePool.find(name => toId(name) === toId(whatIfMove)) ?? whatIfMove.trim(),
            replace: moves.length >= 4 ? (whatIfReplace ?? moves[moves.length - 1].name) : null,
          });
          setWhatIfMove('');
        }}
      >
        Load move
      </button>
    </>
  );
}
