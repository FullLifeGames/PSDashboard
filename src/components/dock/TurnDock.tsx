import { useCallback } from 'react';
import type { BranchSimState, BranchSlotChoice, LiveHit } from '@fulllifegames/eval-engine';
import type { PickerSource } from '../../lib/picker-state';
import type { PlayedAtPosition } from '../../lib/played-pick';
import type { SeedChoices, SideChoices } from '../../lib/dock-seed';
import { useDockPreview } from '../../hooks/useDockPreview';
import { useDiceViews } from '../../hooks/useDiceView';
import { useTrayState } from '../../hooks/useTrayState';
import { buildDockModel, type Side } from './dock-model';
import { DockRows } from './DockRows';
import { DockStatus, EndedNotice } from './DockStatus';
import { ExecuteButton } from './ExecuteButton';
import { SlotTray } from './SlotTray';

type LiveBattle = LiveHit['battle'];

export interface TurnDockProps {
  simState: BranchSimState | null;
  /** The state shown is the last resolved position's while the viewed one resolves: the dock keeps its height and takes no input. */
  stale?: boolean;
  /** Where this position's choices come from: 'live' (the branch sim), 'stored' (rebuilt exact position) or 'snapshot' (approximated). */
  source?: PickerSource;
  /** The app is reconstructing this position's exact choices right now; the snapshot approximation upgrades in place when it lands. */
  acquiringExact?: boolean;
  executeError: string | null;
  /** True while a turn is being written to the sim: blocks double executes. */
  executing: boolean;
  /** Generation of the loaded replay: keeps the damage calc on the sim's generation. */
  gen: number;
  onSetChoice: (side: Side, choice: BranchSlotChoice, activeSlot?: number) => void;
  /** "What if it had …": loads a legal move into the active set and rebuilds the branch. */
  onHypotheticalMove: (side: Side, activeSlot: number, params: { species: string; move: string; replace: string | null }) => void;
  /** Execute sends the effective choices: the played seed under the user's picks. */
  onExecuteTurn: (choices: SideChoices) => void;
  /** The action each side actually took at this position on the viewed line. */
  played?: PlayedAtPosition | null;
  /** Names the viewed position: the open tray and the armed gimmick toggles belong to it. */
  positionKey?: string;
  /** The live battle, handed over only while the viewed position is the branch tip: the preview prices hits the calc cannot. */
  getBattle?: () => LiveBattle | null;
  /** The replay's log with the battle of a stored position on the main line: the chips read the log's dice from its lines. */
  replayLog?: string;
  /** The played choice of each slot, validated against the picker; an untouched slot shows it. */
  seed?: SeedChoices | null;
}

/**
 * Round 84 (turn dock): the dock at the foot of the replay column. One chip per active slot with its choice, a tray above it for
 * the open slot, and Execute at the right. The picker state it reads already holds the seed under the user's picks.
 */
export function TurnDock(props: TurnDockProps) {
  const {
    simState, stale, source, acquiringExact, executeError, executing, gen, onSetChoice, onHypotheticalMove, onExecuteTurn, played,
    positionKey, getBattle, replayLog, seed,
  } = props;
  const onEdit = useCallback((side: Side, slot: number, choice: BranchSlotChoice) => onSetChoice(side, choice, slot), [onSetChoice]);
  const { slots, gimmickFor, damageBySide } = useDockPreview(simState, gen, positionKey, getBattle, onEdit);
  const { open, attachRoot, close, toggleChip, toggleMore, onKeyDown } = useTrayState(positionKey);
  const diceViews = useDiceViews({ diceOpen: open?.more ?? false, stale, simState, getBattle, replayLog, onSetChoice });
  if (!simState) return null;
  if (simState.ended) return <div className="ps-dock"><EndedNotice winner={simState.winner} /></div>;

  const model = buildDockModel({ simState, slots, damageBySide, gimmickFor, played, seed });
  const openSlot = open ? model[open.side][open.slot] : undefined;
  const execute = () => {
    close();
    onExecuteTurn({ p1: simState.p1Choices, p2: simState.p2Choices });
  };
  return (
    <div className="ps-dock" ref={attachRoot} onKeyDown={onKeyDown} inert={stale} aria-busy={stale || undefined}>
      <DockStatus source={source} acquiringExact={acquiringExact} executeError={executeError} model={model} diceOpen={!!open?.more} />
      <div className="ps-dock-anchor">
        {open && openSlot && (
          <SlotTray
            key={`${open.side}${open.slot}`}
            slot={openSlot}
            hpByLabel={model.hpByLabel}
            gen={gen}
            moreOpen={open.more}
            diceViews={diceViews}
            onChoice={choice => onSetChoice(open.side, choice, open.slot)}
            onHypotheticalMove={params => {
              onHypotheticalMove(open.side, open.slot, params);
              close();
            }}
            onMore={toggleMore}
            onDone={() => close(true)}
          />
        )}
        <div className="ps-dock-bar">
          <DockRows model={model} open={open} onToggle={toggleChip} />
          {!model.flags.isForceSwitch && (
            <ExecuteButton ready={model.flags.bothChosen} executing={executing} label={model.flags.pendingLabel} onClick={execute} />
          )}
        </div>
      </div>
    </div>
  );
}
