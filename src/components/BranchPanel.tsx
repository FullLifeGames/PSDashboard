import { useEffect, useState, useMemo } from 'react';
import type { BranchSimState, BranchMoveOption, BranchSwitchOption, SimPokemonInfo } from '../hooks/useBranch';
import type { BranchSlotModifiers } from '../lib/branch-engine';
import {
  branchSideChoicesReady,
  requiredChoicesForActiveSlots,
  switchChoiceKey,
  type BranchSlotChoice,
} from '../lib/branch-choices';
import type { PickerSource } from '../lib/picker-state';
import { computePreviewDamage, EMPTY_SIDE_DAMAGE, type DamagePreviewInputs, type SideDamage } from '../lib/branch-damage';
import { SideControls, type PlayedPick } from './branch/SideControls';
import { ExecuteRow, PickerSourceLine, RawLogToggle } from './branch/PanelStatus';

export type { PlayedPick } from './branch/SideControls';

interface Props {
  simState: BranchSimState | null;
  /**
   * Where this position's choices come from (unified timeline, variant B):
   * 'live' = the branch sim stands here; 'stored' = rebuilt from a recorded
   * or reconstructed exact position; 'snapshot' = approximated from replay
   * snapshot + guessed teams (the sim validates legality when the move
   * executes). Undefined renders like 'live' (legacy callers).
   */
  source?: PickerSource;
  /** The app is reconstructing this position's exact choices right now —
   *  the snapshot approximation upgrades in place when it lands. */
  acquiringExact?: boolean;
  executeError: string | null;
  /** True while a turn is being written to the sim — blocks double executes. */
  executing: boolean;
  /** Generation of the loaded replay — keeps the damage calc on the sim's gen (B5). */
  gen: number;
  onSetChoice: (side: 'p1' | 'p2', choice: BranchSlotChoice, activeSlot?: number) => void;
  /** "What if it had …": loads a legal move into the active set and rebuilds the branch. */
  onHypotheticalMove: (side: 'p1' | 'p2', activeSlot: number, params: { species: string; move: string; replace: string | null }) => void;
  onExecuteTurn: () => void;
  /** The action each side actually took at this position on the viewed line. */
  played?: { p1: PlayedPick | null; p2: PlayedPick | null } | null;
}

const EMPTY_MOVES: BranchMoveOption[] = [];
const EMPTY_SWITCHES: BranchSwitchOption[] = [];
const EMPTY_MODIFIERS: BranchSlotModifiers = {
  teraType: null,
  canMegaEvo: false,
  canUltraBurst: false,
  zMoves: [],
};

const ADVANCED_KEY = 'ps-replay-interceptor:picker-advanced';

/**
 * Compact by default: small action chips (moves + switches side by side)
 * and Execute. "Advanced" grows them into the full picker — type/damage
 * details, the Fight/Pokémon tabs, the free-choice dropdown and the
 * "What if it had…" tools (persisted).
 */
function useAdvancedToggle() {
  const [advanced, setAdvanced] = useState(() => {
    try {
      return localStorage.getItem(ADVANCED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggleAdvanced = () => {
    setAdvanced(current => {
      try {
        localStorage.setItem(ADVANCED_KEY, current ? '0' : '1');
      } catch {
        // Storage blocked — the toggle still works for this session.
      }
      return !current;
    });
  };
  return { advanced, toggleAdvanced };
}

/** Per-slot views of the sim state (singles fall back to the single-active fields). */
function useSlots(simState: BranchSimState | null) {
  const p1ActiveSlots = useMemo(
    () => simState?.p1ActiveSlots ?? (simState?.p1Active ? [simState.p1Active] : []),
    [simState],
  );
  const p2ActiveSlots = useMemo(
    () => simState?.p2ActiveSlots ?? (simState?.p2Active ? [simState.p2Active] : []),
    [simState],
  );
  const p1MovesBySlot = useMemo(
    () => simState?.p1MovesBySlot ?? [simState?.p1Moves ?? EMPTY_MOVES],
    [simState],
  );
  const p2MovesBySlot = useMemo(
    () => simState?.p2MovesBySlot ?? [simState?.p2Moves ?? EMPTY_MOVES],
    [simState],
  );
  const p1SwitchesBySlot = simState?.p1SwitchesBySlot ?? [simState?.p1Switches ?? EMPTY_SWITCHES];
  const p2SwitchesBySlot = simState?.p2SwitchesBySlot ?? [simState?.p2Switches ?? EMPTY_SWITCHES];
  return { p1ActiveSlots, p2ActiveSlots, p1MovesBySlot, p2MovesBySlot, p1SwitchesBySlot, p2SwitchesBySlot };
}

/** The damage preview per side, recomputed whenever the actives, moves, field, or gen change. */
function usePreviewDamage(inputs: DamagePreviewInputs) {
  const { p1ActiveSlots, p2ActiveSlots, p1MovesBySlot, p2MovesBySlot, fieldState, gen } = inputs;
  const [damageBySide, setDamageBySide] = useState<{ p1: SideDamage; p2: SideDamage }>({
    p1: EMPTY_SIDE_DAMAGE,
    p2: EMPTY_SIDE_DAMAGE,
  });
  useEffect(() => {
    let cancelled = false;

    async function calculatePreviewDamage() {
      const { calcSingleDamageRange } = await import('../lib/damage-calc');
      if (cancelled) return;
      if (!cancelled) {
        setDamageBySide(computePreviewDamage(
          { p1ActiveSlots, p2ActiveSlots, p1MovesBySlot, p2MovesBySlot, fieldState, gen },
          calcSingleDamageRange,
        ));
      }
    }

    void calculatePreviewDamage();
    return () => {
      cancelled = true;
    };
  }, [p1ActiveSlots, p2ActiveSlots, p1MovesBySlot, p2MovesBySlot, fieldState, gen]);
  return damageBySide;
}

function blockedSwitchKeys(choices: (BranchSlotChoice | null)[], required: boolean[], activeSlot: number): Set<string> {
  const blocked = new Set<string>();
  choices.forEach((choice, index) => {
    if (index === activeSlot) return;
    // A pending choice on a slot the request does not let act (a stale
    // pick during the other slot's forced replacement) must not reserve
    // a species — it locked the forced slot's only legal switch-in.
    if (!required[index]) return;
    const target = switchChoiceKey(choice);
    if (target !== null) blocked.add(target);
  });
  return blocked;
}

function pendingLabelFor(simState: BranchSimState, bothChosen: boolean, isMultiActive: boolean): string {
  return bothChosen
    ? 'Execute Turn'
    : isMultiActive
      ? 'Select all active choices'
      : `Select ${!simState.p1Choice ? 'P1' : ''}${!simState.p1Choice && !simState.p2Choice ? ' & ' : ''}${!simState.p2Choice ? 'P2' : ''} choice`;
}

interface SideColumnProps {
  side: 'p1' | 'p2';
  simState: BranchSimState;
  activeSlots: (SimPokemonInfo | null)[];
  movesBySlot: BranchMoveOption[][];
  switchesBySlot: BranchSwitchOption[][];
  requiredChoices: boolean[];
  damage: SideDamage;
  gen: number;
  advanced: boolean;
  played: PlayedPick | null | undefined;
  onSetChoice: Props['onSetChoice'];
  onHypotheticalMove: Props['onHypotheticalMove'];
}

/** The identity part of one slot's controls: label and the active Pokémon. */
function slotIdentity(side: 'p1' | 'p2', slot: number, activeSlots: (SimPokemonInfo | null)[], active: SimPokemonInfo | null) {
  const prefix = side === 'p1' ? 'P1' : 'P2';
  return {
    label: activeSlots.length > 1 ? `${prefix}${String.fromCharCode(65 + slot)}` : prefix,
    activeName: active?.name || '???',
    activeSpecies: active?.species || '',
    activeFainted: active?.fainted ?? true,
  };
}

/** The choice part of one slot's controls: options, pending state, gimmicks, damage. */
function slotChoiceProps(props: SideColumnProps, slot: number) {
  const { side, simState, movesBySlot, switchesBySlot, requiredChoices, damage } = props;
  const forceSwitches = side === 'p1' ? simState.p1ForceSwitches : simState.p2ForceSwitches;
  const choices = side === 'p1' ? simState.p1Choices : simState.p2Choices;
  const modifiersBySlot = side === 'p1' ? simState.p1ModifiersBySlot : simState.p2ModifiersBySlot;
  return {
    moves: movesBySlot[slot] ?? EMPTY_MOVES,
    switches: switchesBySlot[slot] ?? EMPTY_SWITCHES,
    forceSwitch: forceSwitches[slot] ?? false,
    pending: choices[slot] ?? null,
    blockedSwitchKeys: blockedSwitchKeys(choices, requiredChoices, slot),
    modifiers: modifiersBySlot[slot] ?? EMPTY_MODIFIERS,
    dmgResults: damage.default[slot] ?? [],
    spreadDamageResults: damage.spread[slot] ?? {},
    targetDamageResults: damage.targets[slot] ?? {},
  };
}

function SideColumn(props: SideColumnProps) {
  const { side, activeSlots, gen, advanced, played, onSetChoice, onHypotheticalMove } = props;
  return (
    <div className="ps-branch-side-column">
      {activeSlots.map((active, slot) => (
        <SideControls
          key={`${side}-${slot}`}
          {...slotIdentity(side, slot, activeSlots, active)}
          {...slotChoiceProps(props, slot)}
          gen={gen}
          advanced={advanced}
          played={slot === 0 ? played ?? null : null}
          onChoice={(choice) => onSetChoice(side, choice, slot)}
          onHypotheticalMove={(params) => onHypotheticalMove(side, slot, params)}
        />
      ))}
    </div>
  );
}

/* ── Main BranchPanel (controls only, no iframe) ── */
export function BranchPanel({ simState, source, acquiringExact, executeError, executing, gen, onSetChoice, onHypotheticalMove, onExecuteTurn, played }: Props) {
  const { advanced, toggleAdvanced } = useAdvancedToggle();
  const slots = useSlots(simState);
  const { p1ActiveSlots, p2ActiveSlots, p1MovesBySlot, p2MovesBySlot, p1SwitchesBySlot, p2SwitchesBySlot } = slots;
  const fieldState = simState?.field ?? null;
  const damageBySide = usePreviewDamage({ p1ActiveSlots, p2ActiveSlots, p1MovesBySlot, p2MovesBySlot, fieldState, gen });

  if (!simState) return null;

  const isForceSwitch = simState.p1ForceSwitch || simState.p2ForceSwitch;
  const isMultiActive = p1ActiveSlots.length > 1 || p2ActiveSlots.length > 1;
  const p1RequiredChoices = requiredChoicesForActiveSlots(p1ActiveSlots, simState.p1ForceSwitches);
  const p2RequiredChoices = requiredChoicesForActiveSlots(p2ActiveSlots, simState.p2ForceSwitches);
  const bothChosen = branchSideChoicesReady(simState.p1Choices, p1RequiredChoices) &&
    branchSideChoicesReady(simState.p2Choices, p2RequiredChoices);
  const pendingLabel = pendingLabelFor(simState, bothChosen, isMultiActive);
  const columnProps = { simState, gen, advanced, onSetChoice, onHypotheticalMove };

  return (
    <div>
      <PickerSourceLine source={source} acquiringExact={acquiringExact} advanced={advanced} onToggleAdvanced={toggleAdvanced} />
      {/* Controls — stacked vertically for P1 + P2 selection */}
      {!simState.ended && (
        <div className="ps-branch-controls-shell">
          <div className="ps-branch-controls-grid">
            <SideColumn
              side="p1"
              activeSlots={p1ActiveSlots}
              movesBySlot={p1MovesBySlot}
              switchesBySlot={p1SwitchesBySlot}
              requiredChoices={p1RequiredChoices}
              damage={damageBySide.p1}
              played={played?.p1}
              {...columnProps}
            />
            <div className="ps-side-divider" />
            <SideColumn
              side="p2"
              activeSlots={p2ActiveSlots}
              movesBySlot={p2MovesBySlot}
              switchesBySlot={p2SwitchesBySlot}
              requiredChoices={p2RequiredChoices}
              damage={damageBySide.p2}
              played={played?.p2}
              {...columnProps}
            />
          </div>
          <ExecuteRow
            executeError={executeError}
            isForceSwitch={isForceSwitch}
            bothChosen={bothChosen}
            executing={executing}
            pendingLabel={pendingLabel}
            onExecuteTurn={onExecuteTurn}
          />
        </div>
      )}
      <RawLogToggle log={simState.log} />
    </div>
  );
}
