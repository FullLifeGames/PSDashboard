import type { AppController } from '../../hooks/useAppController';
import { ConfirmBanner } from '../ConfirmBanner';
import { gameEnd } from '../../lib/game-end';
import { RawLogToggle } from './RawLogToggle';
import type { Side } from './dock-model';
import { TurnDock, type TurnDockProps } from './TurnDock';

const isGame = (app: AppController): boolean => app.ctx.newGame.record !== null;

/** What the dock reads from the app: the live branch at its tip, the resolved picker (with its seed) at every other position. */
function dockProps(app: AppController, replayId: string): TurnDockProps {
  const { viewTurn, liveTip, evalViewKey } = app.board.timeline;
  const { simState, executing, executeError } = app.ctx.branch;
  const { branchPreparing, handleSetChoice, handleExecuteDraft } = app.board.deviation;
  const { positionPicker, dockSimState, pickerSeed, pickerStale, playedAtView, getPickerBattle, pickerReplayLog } = app.engine;
  return {
    // A replay turn shows the picker's state with the engine's fill laid over its empty slots (Q19 b).
    simState: liveTip ? simState : dockSimState,
    isGame: isGame(app),
    endOfGame: gameEnd({
      isGame: isGame(app), viewingVariation: app.board.timeline.viewingVariation, liveTip, simState,
      atEndPosition: app.board.timeline.atEndPosition, log: isGame(app) ? app.ctx.replay.replayData?.log ?? '' : '',
    }),
    stale: !liveTip && pickerStale,
    source: liveTip ? 'live' : positionPicker?.source,
    acquiringExact: !liveTip && app.engine.acquire.exactAcquiringTurn === viewTurn,
    executeError: liveTip ? executeError : null,
    executing: executing || branchPreparing,
    gen: app.ctx.meta.replayGen,
    onSetChoice: handleSetChoice,
    // The live tip can hold a forced replacement back for Execute (ruling 16a); a replay turn has none.
    onRecordChoice: liveTip ? app.ctx.branch.recordChoice : undefined,
    onHypotheticalMove: app.handleHypotheticalMove,
    // The tip executes its own pending choices; off the tip the effective choices (the played seed under the picks) go along.
    onExecuteTurn: choices => (liveTip ? void app.handleExecuteTurn() : handleExecuteDraft(choices)),
    played: playedAtView,
    // The step within the turn counts: a forced replacement and the choice after it share the turn, and the tray and the armed gimmicks of the one are not the other's.
    positionKey: `${replayId}:${evalViewKey}:${liveTip ? app.ctx.branch.history.length : 0}`,
    getBattle: liveTip ? app.ctx.branch.getBattle : getPickerBattle,
    replayLog: pickerReplayLog,
    seed: liveTip ? null : pickerSeed,
    // The first chip click at a replay turn starts the fill for its empty slots; the tip fills at once.
    fill: app.engine.dockFill,
  };
}

/** A steady stand-in while the engine plays: the per-turn picker churn was the "everything keeps switching" complaint, and a click mid-run would corrupt the loop. */
function PlayOutStandIn() {
  return (
    <div className="ps-panel" role="status" style={{ fontSize: 11, color: '#aabbcc' }}>
      <span className="ps-spinner" aria-hidden="true" />{' '}
      The engine is picking both sides&rsquo; moves. The pickers come back when it stops.
    </div>
  );
}

/**
 * Round 84 (turn dock): the last child of the replay column: the confirm banner, the Raw Protocol Log toggle directly above the
 * dock, and the dock. While the engine plays out, the stand-in takes the dock's place. At turn 0 the lead picker takes it, so the
 * region renders nothing. Round 88 (T316): `nearSide` is the side the replay frame shows near; the dock puts its chips first.
 */
export function DockRegion({ app, replayId, nearSide }: { app: AppController; replayId: string; nearSide?: Side }) {
  const { playOut, pendingConfirm, setPendingConfirm } = app.transients;
  if (app.board.timeline.viewT0 && !playOut?.active) return null;
  const banner = pendingConfirm && (
    <ConfirmBanner
      message={pendingConfirm.message}
      onProceed={pendingConfirm.proceed}
      onCancel={() => { setPendingConfirm(null); app.engine.walk.clearPendingPick(); }}
    />
  );
  if (playOut?.active) return <>{banner}<PlayOutStandIn /></>;
  const props = dockProps(app, replayId);
  return (
    <>
      {banner}
      {props.simState && <div className="ps-dock-log"><RawLogToggle log={props.simState.log} /></div>}
      <TurnDock {...props} nearSide={nearSide} />
    </>
  );
}
