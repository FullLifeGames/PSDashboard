import { useCallback, useEffect } from 'react';
import type { BranchSimState, BranchSlotChoice, LiveHit } from '@fulllifegames/eval-engine';
import type { PickerSource } from '../../lib/picker-state';
import type { PlayedAtPosition } from '../../lib/played-pick';
import type { SeedChoices, SideChoices } from '../../lib/dock-seed';
import { useDockPreview } from '../../hooks/useDockPreview';
import { useDiceViews } from '../../hooks/useDiceView';
import { useDockHeight } from '../../hooks/useDockHeight';
import type { DockFillView } from '../../hooks/useDockFill';
import { engineHoldsForcedBeside, sameChoice } from '../../lib/dock-fill';
import { useTrayState, type TrayOpen } from '../../hooks/useTrayState';
import { buildDockModel, type DockSlotModel, type Side } from './dock-model';
import { DockRows } from './DockRows';
import { DockStatus, EndedNotice } from './DockStatus';
import type { MainLineEnd } from '../../lib/game-end';
import { ExecuteButton } from './ExecuteButton';
import { SlotTray } from './SlotTray';

type LiveBattle = LiveHit['battle'];

export interface TurnDockProps {
  simState: BranchSimState | null;
  /** The position is the end of a game's main line (the winner's name, null when the log names none): the dock says so instead of a turn. */
  endOfGame?: MainLineEnd;
  isGame?: boolean;
  /** The state shown is the last resolved position's while the viewed one resolves: the dock keeps its height and takes no input. */
  stale?: boolean;
  /** Where this position's choices come from: 'live' (the branch sim), 'stored' (rebuilt exact position) or 'snapshot' (approximated). */
  source?: PickerSource;
  /** The app is reconstructing this position's exact choices right now; the snapshot approximation upgrades in place when it lands. */
  acquiringExact?: boolean;
  executeError: string | null;
  executing: boolean;
  gen: number;
  format?: string;
  onSetChoice: (side: Side, choice: BranchSlotChoice, activeSlot?: number) => void;
  /** Stores a pick without sending anything (the live tip only). Without it every pick goes through `onSetChoice`. */
  onRecordChoice?: (side: Side, choice: BranchSlotChoice, activeSlot?: number) => void;
  onHypotheticalMove: (side: Side, activeSlot: number, params: { species: string; move: string; replace: string | null }) => void;
  onExecuteTurn: (choices: SideChoices) => void;
  played?: PlayedAtPosition | null;
  positionKey?: string;
  /** The live battle, handed over only while the viewed position is the branch tip: the preview prices hits the calc cannot. */
  getBattle?: () => LiveBattle | null;
  /** The replay's log with the battle of a stored position on the main line: the chips read the log's dice from its lines. */
  replayLog?: string;
  seed?: SeedChoices | null;
  /** The engine's fill at the live tip: a pending run holds the empty chips and queues an Execute; null off the tip. */
  fill?: DockFillView | null;
  nearSide?: Side;
  opponentReads?: boolean;
  onOpponentReadsChange?: (value: boolean) => void;
}

/**
 * A pick of the user takes the slot from the engine's fill first, then the choice is stored. A forced replacement normally goes out
 * at once; while another forced slot of the turn holds only the engine's pick the pick is recorded and Execute sends it.
 * `writeChoice` stores a choice without that first step: "Back to the engine's pick" gives the slot back to the fill and writes its choice.
 */
function useUserChoice(
  simState: TurnDockProps['simState'], fill: DockFillView | null | undefined, onSetChoice: TurnDockProps['onSetChoice'],
  onRecordChoice: TurnDockProps['onRecordChoice'],
) {
  const onUserChoice = fill?.onUserChoice;
  const engine = fill?.engine;
  const writeChoice = useCallback((side: Side, choice: BranchSlotChoice, slot?: number) => {
    const holdBack = !!onRecordChoice && !!simState && !!engine && engineHoldsForcedBeside(simState, engine, side, slot ?? 0);
    (holdBack ? onRecordChoice : onSetChoice)(side, choice, slot);
  }, [onSetChoice, onRecordChoice, simState, engine]);
  const setChoice = useCallback((side: Side, choice: BranchSlotChoice, slot?: number) => {
    onUserChoice?.(side, slot ?? 0, choice);
    writeChoice(side, choice, slot);
  }, [onUserChoice, writeChoice]);
  return { setChoice, writeChoice };
}

/** Tells the fill which slot's tray is open, so a result that lands later never writes it. The effect only writes a ref. */
function useHeldTray(fill: DockFillView | null | undefined, open: TrayOpen | null) {
  const holdTray = fill?.holdTray;
  const side = open?.side;
  const slot = open?.slot;
  useEffect(() => {
    holdTray?.(side !== undefined && slot !== undefined ? { side, slot } : null);
    return () => holdTray?.(null);
  }, [holdTray, side, slot]);
}

function useDockElement(attachRoot: (element: HTMLElement | null) => void) {
  const reportHeight = useDockHeight();
  return useCallback((element: HTMLDivElement | null) => {
    attachRoot(element);
    reportHeight(element);
  }, [attachRoot, reportHeight]);
}

function DockExecute({ model, fill, executing, onRun, onClose }: {
  model: ReturnType<typeof buildDockModel>;
  fill: DockFillView | null | undefined;
  executing: boolean;
  onRun: () => void;
  onClose: () => void;
}) {
  const waitsForFill = !!fill?.pending && !model.flags.bothChosen;
  // A forced replacement shows Execute once the engine's pick stands (or its run is pending); with no pick a bench click sends the body in
  // at once.
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
 * The tray offers "Back to the engine's pick" where the slot holds a pick of the user's (the engine's mark is gone) that differs from what
 * the fill chose for it. A forced replacement goes out at once, so its tray has none.
 */
function backHandler(fill: DockFillView | null | undefined, slot: DockSlotModel | undefined, write: (side: Side, choice: BranchSlotChoice, slot: number) => void): (() => void) | undefined {
  if (!fill || !slot) return undefined;
  const own = fill.picks[slot.side][slot.slot];
  if (!own || !slot.pending || slot.forceSwitch || fill.engine[slot.side][slot.slot] || sameChoice(slot.pending, own)) return undefined;
  return () => {
    const restored = fill.restore(slot.side, slot.slot);
    if (restored) write(slot.side, restored, slot.slot);
  };
}

export function TurnDock(props: TurnDockProps) {
  const {
    simState, stale, source, acquiringExact, executeError, executing, gen, format = '', onSetChoice, onRecordChoice, onHypotheticalMove, onExecuteTurn,
    played, positionKey, getBattle, replayLog, seed, fill, nearSide, endOfGame, isGame, opponentReads, onOpponentReadsChange,
  } = props;
  const { setChoice, writeChoice } = useUserChoice(simState, fill, onSetChoice, onRecordChoice);
  const onEdit = useCallback((side: Side, slot: number, choice: BranchSlotChoice) => setChoice(side, choice, slot), [setChoice]);
  const { slots, gimmickFor, damageBySide } = useDockPreview(simState, gen, positionKey, getBattle, onEdit);
  const release = fill?.release;
  const onLeave = useCallback((left: TrayOpen) => release?.(left.side, left.slot), [release]);
  const { open, attachRoot, close, toggleChip, toggleMore, onKeyDown } = useTrayState(positionKey, onLeave);
  useHeldTray(fill, open);
  const attachDock = useDockElement(attachRoot);
  const diceViews = useDiceViews({ diceOpen: open?.more ?? false, stale, simState, getBattle, replayLog, onSetChoice: setChoice });
  if (endOfGame) return <div className="ps-dock" ref={attachDock}><EndedNotice winner={endOfGame.winner} game={!endOfGame.battle} battle={endOfGame.battle} /></div>;
  if (!simState) return null;
  if (simState.ended) return <div className="ps-dock" ref={attachDock}><EndedNotice winner={simState.winner} /></div>;

  const model = buildDockModel({ simState, slots, damageBySide, gimmickFor, played, seed, fill });
  const openSlot = open ? model[open.side][open.slot] : undefined;
  const backToEngine = backHandler(fill, openSlot, writeChoice);
  return (
    <div className="ps-dock" ref={attachDock} onKeyDown={onKeyDown} inert={stale} aria-busy={stale || undefined}>
      <DockStatus source={source} acquiringExact={acquiringExact} executeError={executeError} model={model} diceOpen={!!open?.more} game={isGame} opponentReads={opponentReads} onOpponentReadsChange={onOpponentReadsChange} />
      <div className="ps-dock-anchor">
        {open && openSlot && (
          <SlotTray
            key={`${open.side}${open.slot}`}
            slot={openSlot}
            hpByLabel={model.hpByLabel}
            gen={gen}
            format={format}
            moreOpen={open.more}
            diceViews={diceViews}
            onChoice={choice => setChoice(open.side, choice, open.slot)}
            onHypotheticalMove={params => {
              fill?.onUserChoice(open.side, open.slot);
              onHypotheticalMove(open.side, open.slot, params);
              close();
            }}
            onMore={toggleMore}
            onBackToEngine={backToEngine}
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
