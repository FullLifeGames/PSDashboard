import { switchChoiceKey, switchOptionKey, type BranchSlotChoice } from '@fulllifegames/eval-engine';
import { toId } from '@fulllifegames/replay-core';
import type { BranchSwitchOption } from '../../hooks/useBranch';
import { displayName } from '../../lib/branch-history';
import { hpBarClass } from '../../lib/hit-bar';
import { useReplayRules } from '../../lib/replay-rules';
import { spriteUrl } from '../../lib/sprite-url';
import type { PlayedPick } from '../../lib/played-pick';

const PLAYED_TITLE = 'The action played at this position on the line you are viewing.';

function SwitchTile({ sw, selected, disabled, disabledReason, wasPlayed, onPick }: {
  sw: BranchSwitchOption; selected: boolean; disabled: boolean; disabledReason: string; wasPlayed: boolean; onPick: () => void;
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
      <span className="ps-switch-text">
        <span className="ps-switchbtn-name">
          {label}
          {wasPlayed && <span className="ps-played-badge" title={PLAYED_TITLE}>played</span>}
        </span>
        <span className="ps-hpbar-track ps-switch-hp-track">
          <span className={`ps-hpbar-fill ${hpBarClass(sw.hpPercent)}`} style={{ width: `${sw.hpPercent}%` }} />
        </span>
      </span>
      <span className="ps-switchbtn-hp">{sw.hp}</span>
    </button>
  );
}

/** Round 84 (turn dock): the bench as switch tiles. A trapped body and a body the partner already takes stay disabled with their reason. */
export function SwitchRow({ activeName, switches, pending, blockedSwitchKeys, played, onPick }: {
  activeName: string;
  switches: BranchSwitchOption[];
  pending: BranchSlotChoice | null;
  blockedSwitchKeys: Set<string>;
  played: PlayedPick | null;
  onPick: (choice: BranchSlotChoice) => void;
}) {
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
            onPick={() => onPick({ kind: 'switch', speciesId: toId(sw.species), pokemonName: sw.name })}
          />
        );
      })}
    </div>
  );
}
