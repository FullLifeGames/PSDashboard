import { useState, type CSSProperties } from 'react';
import type { BranchSimState, BranchMoveOption, BranchSwitchOption, SimPokemonInfo } from '../hooks/useBranch';
import { type BranchSlotChoice, type LiveHit } from '@fulllifegames/eval-engine';
import type { PickerSource } from '../lib/picker-state';
import type { SideDamage } from '../lib/branch-damage';
import { SideControls } from './branch/SideControls';
import type { PlayedAtPosition, PlayedPick } from '../lib/played-pick';
import type { Gimmick } from '../hooks/useSideControlsState';
import { ExecuteRow, PickerSourceLine, RawLogToggle } from './branch/PanelStatus';
import { DICE_WAIT_NOTE, TurnDice } from './branch/DiceChips';
import { useDiceViews, type DiceViews } from '../hooks/useDiceView';
import { EndedNotice } from './dock/DockStatus';
import { useDockPreview } from '../hooks/useDockPreview';
import { EMPTY_MODIFIERS, EMPTY_MOVES, EMPTY_SWITCHES, blockedSwitchKeys, panelFlags, playedOfSlot, slotIdentity } from '../lib/dock-panel';

export type { PlayedPick, PlayedAtPosition } from '../lib/played-pick';

interface Props {
  simState: BranchSimState | null;
  /** The state shown is the last resolved position's while the viewed one resolves: the panel keeps its height and takes no input. */
  stale?: boolean;
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
  played?: PlayedAtPosition | null;
  /** Names the viewed position: armed gimmick toggles belong to it and fall back on a new one (T124). */
  positionKey?: string;
  /**
   * The live battle of the branch, handed over only while the viewed position is its tip (round 73, T202): the preview prices a hit
   * the calc cannot price on a copy of it. Absent for a stored or reconstructed position, which has no live battle.
   */
  getBattle?: () => LiveBattle | null;
  /**
   * Round 82 (forced dice), step A7b: the replay's log, handed over with the battle of a stored position on the main line. The turn the
   * user views is the turn the log shows, so the chips read the log's dice from its lines.
   */
  replayLog?: string;
}

type LiveBattle = LiveHit['battle'];


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
  playedSlots: (PlayedPick | null)[] | undefined;
  /** The other side has to replace a Pokémon and this side has nothing to choose until it has (round 77, B5). */
  waitingFor: 'P1' | 'P2' | null;
  gimmickFor: (side: 'p1' | 'p2', slot: number) => Gimmick;
  diceViews: DiceViews;
  onSetChoice: Props['onSetChoice'];
  onHypotheticalMove: Props['onHypotheticalMove'];
}

/** The choice part of one slot's controls: options, pending state, gimmicks, damage. */
function slotChoiceProps(props: SideColumnProps, slot: number) {
  const { side, simState, movesBySlot, switchesBySlot, requiredChoices, damage, gimmickFor, diceViews } = props;
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
    gimmick: gimmickFor(side, slot),
    dmgResults: damage.default[slot] ?? [],
    spreadDamageResults: damage.spread[slot] ?? {},
    targetDamageResults: damage.targets[slot] ?? {},
    dice: diceViews.slot(side, slot),
  };
}

/** The panel grid's slot rows: the larger side's slot count (round 83, the slots of both sides line up row by row). */
const slotRows = (p1: readonly unknown[], p2: readonly unknown[]): CSSProperties =>
  ({ '--ps-slot-rows': Math.max(p1.length, p2.length, 1) } as CSSProperties);

function SideColumn(props: SideColumnProps) {
  const { side, activeSlots, gen, advanced, played, playedSlots, waitingFor, onSetChoice, onHypotheticalMove } = props;
  return (
    <div className="ps-branch-side-column" inert={waitingFor !== null} style={waitingFor ? { opacity: 0.6 } : undefined}>
      {waitingFor && <div className="ps-force-switch-note ps-side-note">Waiting for {waitingFor} to choose a replacement.</div>}
      {/* Round 83 (the user, 01.11.2026): each slot takes its own row of the panel's grid, so P1A stands beside P2A and P1B beside P2B at one height. */}
      {activeSlots.map((active, slot) => (
        <div key={`${side}-${slot}`} className="ps-side-slot" style={{ gridRow: slot + 2 }}>
          <SideControls
            {...slotIdentity(side, slot, activeSlots, active)}
            {...slotChoiceProps(props, slot)}
            gen={gen}
            advanced={advanced}
            played={playedOfSlot(playedSlots, played, slot)}
            onChoice={(choice) => onSetChoice(side, choice, slot)}
            onHypotheticalMove={(params) => onHypotheticalMove(side, slot, params)}
          />
        </div>
      ))}
    </div>
  );
}

/* ── Main BranchPanel (controls only, no iframe) ── */
export function BranchPanel({ simState, stale, source, acquiringExact, executeError, executing, gen, onSetChoice, onHypotheticalMove, onExecuteTurn, played, positionKey, getBattle, replayLog }: Props) {
  const { advanced, toggleAdvanced } = useAdvancedToggle();
  const { slots, gimmickFor, damageBySide } = useDockPreview(simState, gen, positionKey, getBattle);
  const diceViews = useDiceViews({ advanced, stale, simState, getBattle, replayLog, onSetChoice });
  const { p1ActiveSlots, p2ActiveSlots, p1MovesBySlot, p2MovesBySlot, p1SwitchesBySlot, p2SwitchesBySlot } = slots;

  if (!simState) return null;

  const { isForceSwitch, p1RequiredChoices, p2RequiredChoices, bothChosen, pendingLabel, p1Waits, p2Waits } = panelFlags(simState, p1ActiveSlots, p2ActiveSlots);
  const columnProps = { simState, gen, advanced, gimmickFor, diceViews, onSetChoice, onHypotheticalMove };

  return (
    <div inert={stale} aria-busy={stale || undefined}>
      <PickerSourceLine source={source} acquiringExact={acquiringExact} advanced={advanced} onToggleAdvanced={toggleAdvanced} />
      {advanced && source === 'snapshot' && <div className="ps-dice-note" role="note">{DICE_WAIT_NOTE}</div>}
      {simState.ended && <EndedNotice winner={simState.winner} />}
      {/* Controls — stacked vertically for P1 + P2 selection */}
      {!simState.ended && (
        <div className="ps-branch-controls-shell">
          <div className="ps-branch-controls-grid ps-slot-rows" style={slotRows(p1ActiveSlots, p2ActiveSlots)}>
            <SideColumn
              side="p1"
              activeSlots={p1ActiveSlots}
              movesBySlot={p1MovesBySlot}
              switchesBySlot={p1SwitchesBySlot}
              requiredChoices={p1RequiredChoices}
              damage={damageBySide.p1}
              played={played?.p1}
              playedSlots={played?.p1Slots}
              waitingFor={p1Waits ? 'P2' : null}
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
              playedSlots={played?.p2Slots}
              waitingFor={p2Waits ? 'P1' : null}
              {...columnProps}
            />
          </div>
          {advanced && diceViews.turn && <TurnDice {...diceViews.turn} />}
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
