import type { AppController } from '../../hooks/useAppController';
import { ConfirmBanner } from '../ConfirmBanner';
import { replayFormatId } from '../../lib/replay-format-id';
import { gameEnd } from '../../lib/game-end';
import { RawLogToggle } from './RawLogToggle';
import type { Side } from './dock-model';
import { TurnDock, type TurnDockProps } from './TurnDock';

const isGame = (app: AppController): boolean => app.ctx.newGame.record !== null;

function dockProps(app: AppController, replayId: string): TurnDockProps {
  const { viewTurn, liveTip, evalViewKey } = app.board.timeline;
  const { simState, executing, executeError } = app.ctx.branch;
  const { branchPreparing, handleSetChoice, handleExecuteDraft } = app.board.deviation;
  const { positionPicker, dockSimState, pickerSeed, pickerStale, playedAtView, getPickerBattle, pickerReplayLog } = app.engine;
  return {
    simState: liveTip ? simState : dockSimState,
    isGame: isGame(app),
    endOfGame: gameEnd({
      isGame: isGame(app), viewingVariation: app.board.timeline.viewingVariation, liveTip, simState,
      atEndPosition: app.board.timeline.atEndPosition, log: app.ctx.replay.replayData?.log ?? '',
    }),
    stale: !liveTip && pickerStale,
    source: liveTip ? 'live' : positionPicker?.source,
    acquiringExact: !liveTip && app.engine.acquire.exactAcquiringTurn === viewTurn,
    executeError: liveTip ? executeError : null,
    executing: executing || branchPreparing,
    gen: app.ctx.meta.replayGen,
    format: replayFormatId(app.ctx.replay.replayData),
    onSetChoice: handleSetChoice,
    onRecordChoice: liveTip ? app.ctx.branch.recordChoice : undefined,
    onHypotheticalMove: app.handleHypotheticalMove,
    // The tip executes its own pending choices; off the tip the effective choices (the played seed under the picks) go along.
    onExecuteTurn: choices => (liveTip ? void app.handleExecuteTurn() : handleExecuteDraft(choices)),
    played: playedAtView,
    // A forced replacement and the choice after it share the turn, but not the tray and the armed gimmicks: the step within the turn counts.
    positionKey: `${replayId}:${evalViewKey}:${liveTip ? app.ctx.branch.history.length : 0}`,
    getBattle: liveTip ? app.ctx.branch.getBattle : getPickerBattle,
    replayLog: pickerReplayLog,
    seed: liveTip ? null : pickerSeed,
    fill: app.engine.dockFill,
    // The stored `hardMode` preference, called "Opponent reads my move" where the user sees it.
    opponentReads: !!app.ctx.evaluation.prefs.hardMode,
    onOpponentReadsChange: value => app.ctx.evaluation.setPrefs({ ...app.ctx.evaluation.prefs, hardMode: value }),
  };
}

/** A steady stand-in while the engine plays: the per-turn picker would keep switching, and a click mid-run would corrupt the loop. */
function PlayOutStandIn() {
  return (
    <div className="ps-panel" role="status" style={{ fontSize: 11, color: '#aabbcc' }}>
      <span className="ps-spinner" aria-hidden="true" />{' '}
      The engine is picking both sides&rsquo; moves. The pickers come back when it stops.
    </div>
  );
}

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
