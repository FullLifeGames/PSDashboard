import { useCallback, useEffect } from 'react';
import type { BranchSimState, BranchSlotChoice, LiveHit } from '@fulllifegames/eval-engine';
import type { PickerSource } from '../../lib/picker-state';
import type { PlayedAtPosition } from '../../lib/played-pick';
import type { SeedChoices, SideChoices } from '../../lib/dock-seed';
import { useDockPreview } from '../../hooks/useDockPreview';
import { useDiceViews } from '../../hooks/useDiceView';
import { useDockHeight } from '../../hooks/useDockHeight';
import type { DockFillView } from '../../hooks/useDockFill';
import { engineHoldsForcedBeside } from '../../lib/dock-fill';
import { useTrayState, type TrayOpen } from '../../hooks/useTrayState';
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
  /** Round 84 (A7c, ruling 16a): stores a pick without sending anything (the live tip only). Without it every pick goes through `onSetChoice`. */
  onRecordChoice?: (side: Side, choice: BranchSlotChoice, activeSlot?: number) => void;
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
  /** The engine's fill at the live tip: a pending run holds the empty chips and queues an Execute; null off the tip. */
  fill?: DockFillView | null;
  /** Round 88 (T316): the side the replay frame shows near; its chips come first. Default P1. */
  nearSide?: Side;
}

/**
 * A pick of the user takes the slot from the engine's fill first, then the choice is stored. A forced replacement normally goes out
 * at once; while another forced slot of the turn holds only the engine's pick (ruling 16a) the pick is recorded and Execute sends it.
 */
function useUserChoice(
  simState: TurnDockProps['simState'], fill: DockFillView | null | undefined, onSetChoice: TurnDockProps['onSetChoice'],
  onRecordChoice: TurnDockProps['onRecordChoice'],
) {
  const onUserChoice = fill?.onUserChoice;
  const engine = fill?.engine;
  return useCallback((side: Side, choice: BranchSlotChoice, slot?: number) => {
    onUserChoice?.(side, slot ?? 0);
    const holdBack = !!onRecordChoice && !!simState && !!engine && engineHoldsForcedBeside(simState, engine, side, slot ?? 0);
    (holdBack ? onRecordChoice : onSetChoice)(side, choice, slot);
  }, [onUserChoice, onSetChoice, onRecordChoice, simState, engine]);
}

/** Round 84: tells the fill which slot's tray is open, so a result that lands later never writes it. The effect only writes a ref. */
function useHeldTray(fill: DockFillView | null | undefined, open: TrayOpen | null) {
  const holdTray = fill?.holdTray;
  const side = open?.side;
  const slot = open?.slot;
  useEffect(() => {
    holdTray?.(side !== undefined && slot !== undefined ? { side, slot } : null);
    return () => holdTray?.(null);
  }, [holdTray, side, slot]);
}

/** One callback ref for the dock's element: the tray state finds its chips through it, and the page learns the dock's height (narrow windows). */
function useDockElement(attachRoot: (element: HTMLElement | null) => void) {
  const reportHeight = useDockHeight();
  return useCallback((element: HTMLDivElement | null) => {
    attachRoot(element);
    reportHeight(element);
  }, [attachRoot, reportHeight]);
}

/** Execute: locked until every slot holds a choice, except while the engine's fill is pending: then a press queues behind it. A forced replacement shows it only with a pick or a pending run. */
function DockExecute({ model, fill, executing, onRun, onClose }: {
  model: ReturnType<typeof buildDockModel>;
  fill: DockFillView | null | undefined;
  executing: boolean;
  onRun: () => void;
  onClose: () => void;
}) {
  const waitsForFill = !!fill?.pending && !model.flags.bothChosen;
  // Round 84 (A7a): a forced replacement shows Execute once the engine's pick stands (or its run is pending); with no pick a bench
  // click sends the body in at once, as before.
  if (model.flags.isForceSwitch && !model.flags.bothChosen && !waitsForFill) return null;
  return (
    <ExecuteButton
      ready={model.flags.bothChosen || waitsForFill}
      executing={executing}
      waits={waitsForFill && !!fill?.waits}
      label={waitsForFill ? 'Execute Turn' : model.flags.pendingLabel}
      onClick={() => {
        onClose();
        if (waitsForFill) fill.queueExecute();
        else onRun();
      }}
    />
  );
}

/**
 * Round 84 (turn dock): the dock at the foot of the replay column. One chip per active slot with its choice, a tray above it for
 * the open slot, and Execute at the right. The picker state it reads already holds the seed under the user's picks.
 */
export function TurnDock(props: TurnDockProps) {
  const {
    simState, stale, source, acquiringExact, executeError, executing, gen, onSetChoice, onRecordChoice, onHypotheticalMove, onExecuteTurn,
    played, positionKey, getBattle, replayLog, seed, fill, nearSide,
  } = props;
  const setChoice = useUserChoice(simState, fill, onSetChoice, onRecordChoice);
  const onEdit = useCallback((side: Side, slot: number, choice: BranchSlotChoice) => setChoice(side, choice, slot), [setChoice]);
  const { slots, gimmickFor, damageBySide } = useDockPreview(simState, gen, positionKey, getBattle, onEdit);
  const release = fill?.release;
  const onLeave = useCallback((left: TrayOpen) => release?.(left.side, left.slot), [release]);
  const { open, attachRoot, close, toggleChip, toggleMore, onKeyDown } = useTrayState(positionKey, onLeave);
  useHeldTray(fill, open);
  const attachDock = useDockElement(attachRoot);
  const diceViews = useDiceViews({ diceOpen: open?.more ?? false, stale, simState, getBattle, replayLog, onSetChoice: setChoice });
  if (!simState) return null;
  if (simState.ended) return <div className="ps-dock" ref={attachDock}><EndedNotice winner={simState.winner} /></div>;

  const model = buildDockModel({ simState, slots, damageBySide, gimmickFor, played, seed, fill });
  const openSlot = open ? model[open.side][open.slot] : undefined;
  return (
    <div className="ps-dock" ref={attachDock} onKeyDown={onKeyDown} inert={stale} aria-busy={stale || undefined}>
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
            onChoice={choice => setChoice(open.side, choice, open.slot)}
            onHypotheticalMove={params => {
              // The loaded move becomes the slot's choice: the engine's held-back pick is no longer wanted.
              fill?.onUserChoice(open.side, open.slot);
              onHypotheticalMove(open.side, open.slot, params);
              close();
            }}
            onMore={toggleMore}
            onDone={() => close(true)}
          />
        )}
        <div className="ps-dock-bar">
          <DockRows model={model} open={open} nearSide={nearSide} onToggle={(side, slot) => { fill?.arm(); toggleChip(side, slot); }} />
          <DockExecute
            model={model}
            fill={fill}
            executing={executing}
            onClose={close}
            onRun={() => onExecuteTurn(model.sendChoices)}
          />
        </div>
      </div>
    </div>
  );
}
