import type { AppController } from '../../hooks/useAppController';
import { ConfirmBanner } from '../ConfirmBanner';
import { RawLogToggle } from './RawLogToggle';
import { TurnDock, type TurnDockProps } from './TurnDock';

/** What the dock reads from the app: the live branch at its tip, the resolved picker (with its seed) at every other position. */
function dockProps(app: AppController, replayId: string): TurnDockProps {
  const { viewTurn, liveTip, evalViewKey } = app.board.timeline;
  const { simState, executing, executeError } = app.ctx.branch;
  const { branchPreparing, handleSetChoice, handleExecuteDraft } = app.board.deviation;
  const { positionPicker, pickerSimState, pickerSeed, pickerStale, playedAtView, getPickerBattle, pickerReplayLog } = app.engine;
  return {
    simState: liveTip ? simState : pickerSimState,
    stale: !liveTip && pickerStale,
    source: liveTip ? 'live' : positionPicker?.source,
    acquiringExact: !liveTip && app.engine.acquire.exactAcquiringTurn === viewTurn,
    executeError: liveTip ? executeError : null,
    executing: executing || branchPreparing,
    gen: app.ctx.meta.replayGen,
    onSetChoice: handleSetChoice,
    onHypotheticalMove: app.handleHypotheticalMove,
    // The tip executes its own pending choices; off the tip the effective choices (the played seed under the picks) go along.
    onExecuteTurn: choices => (liveTip ? void app.handleExecuteTurn() : handleExecuteDraft(choices)),
    played: playedAtView,
    positionKey: `${replayId}:${evalViewKey}`,
    getBattle: liveTip ? app.ctx.branch.getBattle : getPickerBattle,
    replayLog: pickerReplayLog,
    seed: liveTip ? null : pickerSeed,
    // Q19 (open): a replay turn's empty slots take no fill; a second trigger can call the same fill for that position.
    fill: liveTip ? app.engine.dockFill : null,
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
 * region renders nothing.
 */
export function DockRegion({ app, replayId }: { app: AppController; replayId: string }) {
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
      <TurnDock {...props} />
    </>
  );
}
