import { useState } from 'react';
import type { BranchMoveOption, BranchSwitchOption } from '../../hooks/useBranch';
import {
  type BranchSlotModifiers, type DamageResult, notationSlotChoice, switchChoiceKey, switchOptionKey,
  type BranchSlotChoice,
} from '@fulllifegames/eval-engine';
import type { SpreadTargetDamage } from '../../lib/branch-damage';
import { useGimmick, useMovePool } from '../../hooks/useSideControlsState';
import { SwitchBtn } from './ChoiceButtons';
import { FightSection, type WhatIfState } from './FightSection';
import { toId } from '@fulllifegames/replay-core';

/** What the viewed line actually played at this position (badge on the
 *  matching button + header note): the replay's action on the main line,
 *  the variation's recorded choice on variation positions. */
export interface PlayedPick {
  kind: 'move' | 'switch';
  name: string;
  species?: string;
}

export interface SideControlsProps {
  label: string;
  activeName: string;
  activeSpecies: string;
  activeFainted: boolean;
  moves: BranchMoveOption[];
  switches: BranchSwitchOption[];
  forceSwitch: boolean;
  pending: BranchSlotChoice | null;
  blockedSwitchKeys: Set<string>;
  modifiers: BranchSlotModifiers;
  dmgResults: DamageResult[];
  spreadDamageResults: Record<number, SpreadTargetDamage[]>;
  targetDamageResults: Record<string, DamageResult | undefined>;
  gen: number;
  /** Shows the power tools (free choice dropdown, "What if it had…"). */
  advanced: boolean;
  played?: PlayedPick | null;
  onChoice: (choice: BranchSlotChoice) => void;
  onHypotheticalMove: (params: { species: string; move: string; replace: string | null }) => void;
}

function SideHeader({ label, activeName, activeFainted, forceSwitch, pending, played }: Pick<SideControlsProps,
  'label' | 'activeName' | 'activeFainted' | 'forceSwitch' | 'pending' | 'played'>) {
  const playedText = played
    ? (played.kind === 'move' ? played.name : `→ ${played.name}`)
    : null;
  return (
    <div className="ps-whatdo">
      <span className="ps-side-label">{label}</span>
      {' '}
      {forceSwitch ? (
        <>Choose a replacement{activeFainted ? <> for <strong>{activeName}</strong></> : null}</>
      ) : (
        <>What will <strong>{activeName}</strong> do?</>
      )}
      {pending && (
        <span className="ps-pending-choice">
          [{notationSlotChoice(pending)}]
        </span>
      )}
      {playedText && !pending && (
        <span
          style={{ marginLeft: 6, fontSize: 10, color: '#b8c9e0' }}
          title="What this side played at this position on the line you are viewing."
        >
          played: <strong>{playedText}</strong>
        </span>
      )}
    </div>
  );
}

function TabRow({ tab, setTab }: { tab: 'fight' | 'switch'; setTab: (tab: 'fight' | 'switch') => void }) {
  return (
    <div className="ps-tab-row">
      <button
        type="button"
        className={`ps-controls-tab ${tab === 'fight' ? 'ps-controls-tab-active' : ''}`}
        onClick={() => setTab('fight')}
      >
        Fight
      </button>
      <button
        type="button"
        className={`ps-controls-tab ${tab === 'switch' ? 'ps-controls-tab-active' : ''}`}
        onClick={() => setTab('switch')}
      >
        Pokémon
      </button>
    </div>
  );
}

function SwitchGrid({ switches, advanced, forceSwitch, pending, blockedSwitchKeys, played, onChoice }: Pick<SideControlsProps,
  'switches' | 'advanced' | 'forceSwitch' | 'pending' | 'blockedSwitchKeys' | 'played' | 'onChoice'>) {
  const playedSwitchKey = played?.kind === 'switch' ? toId(played.species || played.name) : null;
  return (
    <div className={`ps-switchgrid${!advanced && !forceSwitch ? ' ps-switchgrid-compact' : ''}`}>
      {switches.map(sw => {
        const selected = switchChoiceKey(pending) === switchOptionKey(sw);
        return (
          <SwitchBtn
            key={sw.slot}
            sw={sw}
            selected={selected}
            disabled={blockedSwitchKeys.has(switchOptionKey(sw)) && !selected}
            disabledReason={`${sw.name} is already chosen as the switch-in for your other slot.`}
            wasPlayed={playedSwitchKey !== null && (toId(sw.species) === playedSwitchKey || toId(sw.name) === playedSwitchKey)}
            compact={!advanced && !forceSwitch}
            onClick={() => onChoice({ kind: 'switch', speciesId: toId(sw.species), pokemonName: sw.name })}
          />
        );
      })}
    </div>
  );
}

/* ── Controls for one side (moves/switches) ── */
export function SideControls(props: SideControlsProps) {
  const { label, activeName, activeSpecies, activeFainted, moves, switches, forceSwitch, pending, blockedSwitchKeys, modifiers, gen, advanced, played, onChoice } = props;
  const [tab, setTab] = useState<'fight' | 'switch'>(forceSwitch ? 'switch' : 'fight');
  const gimmick = useGimmick(modifiers);
  const [whatIfMove, setWhatIfMove] = useState('');
  const [whatIfReplace, setWhatIfReplace] = useState<string | null>(null);
  const movePool = useMovePool(activeSpecies, gen);
  const whatIf: WhatIfState = { whatIfMove, setWhatIfMove, whatIfReplace, setWhatIfReplace };

  return (
    <div className="ps-controls ps-side-controls">
      <SideHeader label={label} activeName={activeName} activeFainted={activeFainted} forceSwitch={forceSwitch} pending={pending} played={played} />

      {forceSwitch && (
        <div className="ps-force-switch-note">
          {activeFainted
            ? `${activeName} fainted! Choose who to send in:`
            : `${activeName} is switching out. Choose who to send in:`}
        </div>
      )}

      {/* Basic view: no tabs — moves and switches sit together as small
          chips. Advanced grows them into the full tabbed picker. */}
      {!forceSwitch && advanced && <TabRow tab={tab} setTab={setTab} />}

      {!forceSwitch && (!advanced || tab === 'fight') && moves.length > 0 && (
        <FightSection {...props} gimmick={gimmick} movePool={movePool} whatIf={whatIf} />
      )}

      {(forceSwitch || !advanced || tab === 'switch') && switches.length > 0 && (
        <SwitchGrid
          switches={switches}
          advanced={advanced}
          forceSwitch={forceSwitch}
          pending={pending}
          blockedSwitchKeys={blockedSwitchKeys}
          played={played}
          onChoice={onChoice}
        />
      )}
    </div>
  );
}
