import { switchChoiceKey, switchOptionKey, type BranchSlotChoice } from '@fulllifegames/eval-engine';
import { toId } from '@fulllifegames/replay-core';
import type { BranchSwitchOption } from '../../hooks/useBranch';
import { displayName } from '../../lib/branch-history';
import { hpBarClass } from '../../lib/hit-bar';
import { useReplayRules } from '../../lib/replay-rules';
import { spriteUrl } from '../../lib/sprite-url';
import type { PlayedPick } from '../../lib/played-pick';
import { useIsGuessed, type GuessedSide, type StandInMark } from '../../lib/stand-in-mark';

const PLAYED_TITLE = 'The action played at this position on the line you are viewing.';
const ENGINE_TITLE = "The engine's choice for this slot. It takes the slot when you close the tray, unless you pick something else.";

/**
 * Round 84 (A7b): the played and engine badges stand in the tile's flag row on its top edge (the move tile's place, `.ps-tile-flags`),
 * out of the tile's flow, so a badge that appears under an open tray never widens the tile or reflows the bench.
 */
function SwitchTile({ sw, selected, disabled, disabledReason, wasPlayed, engine, guessed, onPick }: {
  sw: BranchSwitchOption; selected: boolean; disabled: boolean; disabledReason: string; wasPlayed: boolean; engine: boolean; guessed: StandInMark | null; onPick: () => void;
}) {
  const label = displayName(sw.name, sw.species);
  const rules = useReplayRules();
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={sw.fainted || disabled}
      title={disabled ? disabledReason : undefined}
      aria-disabled={disabled || sw.fainted}
      aria-pressed={selected}
      className={`ps-switchbtn ${selected ? 'ps-switchbtn-selected' : ''}`}
    >
      <img src={spriteUrl(sw.species, rules)} alt={label} />
      {(wasPlayed || engine || guessed) && (
        <span className="ps-tile-flags">
          {guessed && <span className="ps-guess-badge" title={guessed.title}>{guessed.badge}</span>}
          {wasPlayed && <span className="ps-played-badge" title={PLAYED_TITLE}>played</span>}
          {engine && <span className="ps-engine-badge" title={ENGINE_TITLE}>engine</span>}
        </span>
      )}
      <span className="ps-switch-text">
        <span className="ps-switchbtn-name">{label}</span>
        <span className="ps-hpbar-track ps-switch-hp-track">
          <span className={`ps-hpbar-fill ${hpBarClass(sw.hpPercent)}`} style={{ width: `${sw.hpPercent}%` }} />
        </span>
      </span>
      <span className="ps-switchbtn-hp">{sw.hp}</span>
    </button>
  );
}

/** Round 84 (turn dock): the bench as switch tiles. A trapped body and a body the partner already takes stay disabled with their reason. */
export function SwitchRow({ side, activeName, switches, pending, blockedSwitchKeys, played, deferred = null, onPick }: {
  /** The side the bench belongs to: a stand-in (a body the log never showed) wears the stats panel's marker (round 88, #101). */
  side: GuessedSide;
  activeName: string;
  switches: BranchSwitchOption[];
  pending: BranchSlotChoice | null;
  blockedSwitchKeys: Set<string>;
  played: PlayedPick | null;
  /** Round 84 (A7a): the engine's pick for the open slot, held back until the tray closes. */
  deferred?: BranchSlotChoice | null;
  onPick: (choice: BranchSlotChoice) => void;
}) {
  const isGuessed = useIsGuessed();
  const playedKey = played?.kind === 'switch' ? toId(played.species || played.name) : null;
  return (
    <div className="ps-switch-row" role="group" aria-label="Switch to">
      {switches.map(sw => {
        const selected = switchChoiceKey(pending) === switchOptionKey(sw);
        return (
          <SwitchTile
            key={sw.slot}
            sw={sw}
            selected={selected}
            disabled={!!sw.trapped || (blockedSwitchKeys.has(switchOptionKey(sw)) && !selected)}
            disabledReason={sw.trapped
              ? `${activeName} is trapped and cannot switch out this turn.`
              : `${displayName(sw.name, sw.species)} is already chosen as the switch-in for your other slot.`}
            wasPlayed={playedKey !== null && (toId(sw.species) === playedKey || toId(sw.name) === playedKey)}
            engine={deferred?.kind === 'switch' && toId(sw.species) === deferred.speciesId}
            guessed={isGuessed(side, sw.species)}
            onPick={() => onPick({ kind: 'switch', speciesId: toId(sw.species), pokemonName: sw.name })}
          />
        );
      })}
    </div>
  );
}
